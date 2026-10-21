import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';
import { createProductionCreateIntent } from '../../frontend/src/pages/productionCreateIntent.js';
import { verifiedProductionDraftVisit } from '../../frontend/src/pages/productionDraft.js';
import { createCapturedRequest } from '../../frontend/src/shared/session/captured-request.js';

test('actual creation client recovers a committed lost response and migration preserves populated history', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startLocalHarness({ port: 55720, deferProductionCreateReceiptsMigration: true });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), { code: 'ENOENT' }); });
  const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
  const login = async usuario => ok(await request(f.base, '/api/login', { method: 'POST', body: { usuario, password: fixturePassword } })).token;
  const token = await login('qa_franco'), otherToken = await login('qa_agustin');
  const [client] = await f.query("INSERT INTO clientes(nombre,activo) VALUES('QA96 client recovery',true) RETURNING id");
  const data = { cliente_id: client.id, fecha: '2026-11-03', titulo: 'QA96 durable recording', participante_ids: [91001, 91002],
    tarea_origen_id: null, observaciones: 'QA96 held input', drive_url: '' };
  const api = (path, method = 'GET', body) => request(f.base, `/api${path}`, { token, method, body });
  const tables = ['usuarios', 'clientes', 'tareas', 'tarea_asignaciones', 'historias', 'publicaciones',
    'produccion_visitas', 'produccion_visita_participantes', 'produccion_videos', 'produccion_fotos'];
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table,
    await f.query(`SELECT row_to_json(r) AS row FROM ${table} r ORDER BY row_to_json(r)::text`)])));
  await t.test('075 adds an empty receipt table without changing populated business history', async () => {
    ok(await api('/producciones', 'POST', { ...data, titulo: 'QA96 legacy preserved visit' }), 201);
    const before = await snapshot();
    assert.equal((await f.query("SELECT nombre FROM _migrations WHERE nombre='075_production_create_receipts.sql'")).length, 0);
    await f.query(await readFile(new URL('../migrations/075_production_create_receipts.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await f.query('SELECT * FROM production_create_receipts'), []);
    await f.query("INSERT INTO _migrations(nombre) VALUES('075_production_create_receipts.sql')");
  });
  const source = await readFile(new URL('../../frontend/src/pages/Productions.jsx', import.meta.url), 'utf8');
  const begin = source.indexOf('  const createVisit ='), end = source.indexOf('  const navigateMonth =', begin);
  assert.ok(begin >= 0 && end > begin);
  function clientModel({ lose = false, malformed = false } = {}) {
    let live = { token, usuario: { id: 91001, rol: 'admin', activo: true } }, active = true, first = true, captured;
    const session = live, calls = [], effects = [], writeLock = { current: false };
    const deps = { writeLock, verifiedProductionDraftVisit,
      setBusy: value => effects.push(['busy', value]), setCreating: value => effects.push(['creating', value]),
      setSelected: value => effects.push(['selected', value.id]), setMonth() {}, setDay() {}, setReload() {},
      setNotice: value => effects.push(['notice', value]), writeProductionLocation: value => effects.push(['location', value.id]) };
    const callbacks = new Function('deps', `const {writeLock,verifiedProductionDraftVisit,setBusy,setCreating,setSelected,setMonth,setDay,setReload,setNotice,writeProductionLocation}=deps;${source.slice(begin, end)};return {createVisit,createdVisit};`)(deps);
    const capture = () => (captured = createCapturedRequest({ session, readSession: () => live, isActive: () => active,
      request: async (path, options) => {
        assert.equal(options.headers.Authorization, `Bearer ${token}`, 'Original actor is retained');
        const r = await request(f.base, path, { token, method: options.method, body: JSON.parse(options.body) });
        calls.push({ body: options.body, status: r.status });
        if (r.status >= 400) throw Object.assign(new Error('Synthetic API rejected request'), { status: r.status });
        if (first) { first = false; if (lose) throw new TypeError('Synthetic lost committed response'); if (malformed) return { visita: { id: r.body.visita.id, revision: 1 } }; }
        return r.body;
      } }));
    const model = createProductionCreateIntent({ capture, request: callbacks.createVisit, randomUUID });
    return { model, calls, effects, accept: value => callbacks.createdVisit(value, captured),
      switchUser: () => { live = { token: otherToken, usuario: { id: 91002, rol: 'admin', activo: true } }; },
      unmount: () => { active = false; } };
  }
  await t.test('lost or malformed real response retains exact request; explicit verification creates nothing else', async () => {
    for (const mode of [{ lose: true }, { malformed: true }]) {
      const c = clientModel(mode), input = { ...data, titulo: mode.lose ? 'QA96 lost response' : 'QA96 partial response' };
      const before = (await f.query('SELECT id FROM produccion_visitas')).length;
      await assert.rejects(c.model.submit(input));
      assert.equal(c.model.snapshot.uncertain, true); assert.equal(c.calls.length, 1);
      assert.ok(!c.effects.some(([name]) => ['selected', 'location', 'creating'].includes(name)), 'No successful UI exit on unconfirmed result');
      input.titulo = 'Must never replace frozen intent';
      await assert.rejects(c.model.submit(input)); assert.equal(c.calls.length, 1, 'No new intent while uncertain');
      const value = await c.model.verify(); c.accept(value);
      assert.equal(c.calls[0].body, c.calls[1].body); assert.deepEqual(c.calls.map(row => row.status), [201, 200]);
      assert.equal(value.titulo, mode.lose ? 'QA96 lost response' : 'QA96 partial response');
      assert.equal((await f.query('SELECT id FROM produccion_visitas')).length, before + 1);
      assert.equal((await f.query('SELECT visit_id FROM production_create_receipts WHERE visit_id=$1', [value.id])).length, 1);
      const freshToken = await login('qa_agustin');
      const fresh = ok(await request(f.base, `/api/producciones/${value.id}`, { token: freshToken })).visita;
      assert.equal(fresh.id, value.id); assert.equal(fresh.titulo, value.titulo);
      assert.equal(c.model.snapshot.locked, false);
    }
  });
  await t.test('old recovery is not dispatched after unmount or account replacement', async () => {
    for (const boundary of ['unmount', 'switchUser']) {
      const c = clientModel({ lose: true });
      await assert.rejects(c.model.submit({ ...data, titulo: `QA96 ${boundary}` }));
      const before = await snapshot(); c[boundary]();
      await assert.rejects(c.model.verify(), { code: 'session_binding_obsolete' });
      assert.equal(c.calls.length, 1); assert.deepEqual(await snapshot(), before);
      assert.ok(!c.effects.some(([name]) => ['selected', 'location'].includes(name)));
    }
  });
});
