import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nextReminderDate, resolveListItem, createMiaPersonalListsRouter } from "../src/mia-personal-lists.js";

const migration = readFileSync(new URL("../migrations/042_mia_listas_personales.sql", import.meta.url), "utf8");
const integration = readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
const francoFix = readFileSync(new URL("../migrations/043_corregir_identidad_francos_whatsapp.sql", import.meta.url), "utf8");
const client = readFileSync(new URL("../scripts/mia_render_os_task.py", import.meta.url), "utf8");

const rows = [{
  id: 7, lista_id: 2, lista_titulo: "Semana", version: 4,
  contenido: { titulo: "Lunes", items: [
    { id: "uno", texto: "Terminar carrusel de Búnker", completado: false },
    { id: "dos", texto: "Terminar carrusel de Bendita", completado: false },
  ] },
}];

test("Mía resuelve un pendiente exacto y no adivina coincidencias ambiguas", () => {
  assert.equal(resolveListItem("Búnker", rows).status, "resolved");
  assert.equal(resolveListItem("terminar carrusel", rows).status, "ambiguous");
  assert.equal(resolveListItem("presupuesto", rows).status, "not_found");
});

test("los recordatorios calculan recurrencias sin repetir fines de semana", () => {
  assert.equal(nextReminderDate("2026-10-02T11:00:00.000Z", "dias_habiles").toISOString(), "2026-10-05T11:00:00.000Z");
  assert.equal(nextReminderDate("2026-10-02T11:00:00.000Z", "semanal").toISOString(), "2026-10-09T11:00:00.000Z");
  assert.equal(nextReminderDate("2026-10-02T11:00:00.000Z", "una_vez"), null);
});

test("la identidad se vincula por hash y las propuestas no tienen vencimiento", () => {
  assert.match(migration, /whatsapp_id_hash CHAR\(64\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mia_lista_propuestas/);
  assert.doesNotMatch(migration, /mia_lista_propuestas[\s\S]*expires_at/);
  assert.match(integration, /unlinked_or_ambiguous_identity/);
  assert.match(integration, /alertUnlinkedWhatsapp/);
  assert.doesNotMatch(integration, /ORDER BY CASE WHEN lower\(usuario\)='lider'/);
  assert.match(integration, /user\.activo !== true/);
  assert.match(francoFix, /lower\(usuario\) <> 'lider'/);
});

test("el cliente firmado expone consulta, propuesta y confirmación de Lista", () => {
  assert.match(client, /commands\.add_parser\("personal-list"\)/);
  assert.match(client, /commands\.add_parser\("propose-list"\)/);
  assert.match(client, /commands\.add_parser\("confirm-list"\)/);
});

// Actual handlers with injected DB responses, not physical SQL/HTTP coverage.
function harness(checklists, proposal = null, { actor = { id: 7, activo: true, rol: 'diseno' }, targetActive = true, missingLock = false } = {}) {
  const routes = new Map(), calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM usuarios')) return { rows: [{ id: params[0], nombre: 'Usuario', activo: targetActive }] };
    if (sql.includes('FROM lista_bloques b')) return { rows: typeof checklists === 'function' ? checklists() : checklists };
    if (sql.includes('FROM mia_lista_propuestas')) return { rows: [proposal] };
    if (sql.startsWith('SELECT id FROM listas_personales')) return { rows: [{ id: '9223372036854775806' }] };
    if (sql.includes('INSERT INTO lista_bloques')) return { rows: [{ id: '9223372036854775807', lista_id: '9223372036854775806', version: 1, contenido: { items: [] } }] };
    return { rows: [], rowCount: 1 };
  };
  const client = { query, release() {} };
  createMiaPersonalListsRouter({ express: { Router: () => ({ use() {}, get() {}, post(path, fn) { routes.set(path, fn); } }) }, pool: { query, connect: async () => client },
    lockActor: missingLock ? undefined : async () => { calls.push({ sql: 'INJECTED_ACTOR_LOCK' }); return actor; } });
  return { calls, async call(path, body) {
    let status = 200, data;
    const res = { status(code) { status = code; return this; }, json(value) { data = value; return this; } };
    await routes.get(path)({ body, wilson: { userId: 7, actorId: 'synthetic', privateChat: true } }, res, error => { throw error; });
    return { status, data };
  } };
}
const exactRows = () => [
  { ...rows[0], id: '9007199254740992', lista_id: '9223372036854775806' },
  { ...rows[0], id: '9007199254740993', lista_id: '9223372036854775807', contenido: { items: [{ id: 'exact-item', texto: 'Exacto' }] } },
];
test('BIGSERIAL checklist IDs stay distinct exact strings; legacy safe numbers remain supported', () => {
  const resolved = resolveListItem('exact-item', exactRows()).matches[0];
  assert.equal(resolved.bloque_id, '9007199254740993'); assert.equal(resolved.lista_id, '9223372036854775807');
  assert.equal(resolveListItem('uno', rows).matches[0].bloque_id, '7');
  assert.throws(() => resolveListItem('uno', [{ ...rows[0], id: 9007199254740992 }]));
});
test('proposal pins exact destination and numeric recorded version', async () => {
  const f = harness(exactRows());
  assert.equal((await f.call('/propuestas', { operacion: 'crear', payload: { texto: 'Nuevo', bloque_id: '9007199254740993' } })).status, 201);
  const payload = JSON.parse(f.calls.find(c => c.sql.includes('INSERT INTO mia_lista_propuestas')).params[5]);
  assert.equal(payload.bloque_id, '9007199254740993'); assert.equal(payload.lista_id, '9223372036854775807'); assert.equal(payload.bloque_version, 4);
});
test('explicit invalid, absent, mismatched or unknown destinations never fall back or create a proposal', async () => {
  for (const destination of [{ bloque_id: null }, { bloque_id: '' }, { bloque_id: 9007199254740992 }, { lista_id: 0 },
    { bloque_id: '9007199254740994' }, { lista_id: '8' }, { lista: 'inexistente' }, { lista: '' },
    { bloque_id: '9007199254740993', lista_id: '9223372036854775806' }]) {
    const f = harness(exactRows());
    assert.ok([400, 404].includes((await f.call('/propuestas', { operacion: 'crear', payload: { texto: 'Nuevo', ...destination } })).status));
    assert.equal(f.calls.some(c => c.sql.includes('INSERT INTO mia_lista_propuestas')), false);
  }
});
test('confirmation never redirects a disappeared destination and validates recorded version', async () => {
  for (const patch of [{ bloque_id: '9007199254740994' }, { lista_id: '9' }, { bloque_id: 9007199254740992 },
    { bloque_version: null }, { bloque_version: undefined }, { bloque_version: 0 }, { bloque_version: 2147483648 }, { bloque_version: 3 }]) {
    const proposal = { operacion: 'crear', objetivo_usuario_id: 7, solicitante_usuario_id: 7, payload: { texto: 'Nuevo', bloque_id: '9007199254740993', lista_id: '9223372036854775807', bloque_version: 4, ...patch } };
    const f = harness(exactRows(), proposal), response = await f.call('/confirmar', { confirmacion_token: 'synthetic' });
    assert.ok([400, 409].includes(response.status));
    assert.equal(f.calls.some(c => /INSERT INTO lista_bloques|UPDATE lista_bloques|SET used_at/.test(c.sql)), false);
    assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
  }
});
test('confirmation updates only exact BIGSERIAL target and preserves default creation for original empty destination', async () => {
  for (const empty of [false, true]) {
    const proposal = { operacion: 'crear', objetivo_usuario_id: 7, solicitante_usuario_id: 7, resumen: 'Voy a agregar',
      payload: { texto: 'Nuevo', bloque_id: empty ? null : '9007199254740993', lista_id: empty ? null : '9223372036854775807', bloque_version: empty ? null : 4 } };
    const f = harness(empty ? [] : exactRows(), proposal);
    assert.equal((await f.call('/confirmar', { confirmacion_token: 'synthetic' })).status, 200);
    const update = f.calls.find(c => c.sql.startsWith('UPDATE lista_bloques'));
    assert.equal(update.params[1], empty ? '9223372036854775807' : '9007199254740993');
    assert.equal(f.calls.some(c => c.sql.includes('INSERT INTO lista_bloques')), empty);
  }
});
test('confirmation requires recorded requester, current actor, active target and persisted admin for cross-user', async () => {
  const proposal = { operacion: 'crear', solicitante_usuario_id: 7, objetivo_usuario_id: 8, resumen: 'Voy a agregar',
    payload: { texto: 'Nuevo', bloque_id: '9007199254740993', lista_id: '9223372036854775807', bloque_version: 4 } };
  for (const options of [{}, { actor: { id: 7, activo: false, rol: 'admin' } }, { actor: { id: 9, activo: true, rol: 'admin' } },
    { actor: { id: 7, activo: true, rol: 'admin' }, targetActive: false }, { missingLock: true }]) {
    const f = harness(exactRows(), proposal, options);
    assert.ok([403, 503].includes((await f.call('/confirmar', { confirmacion_token: 'synthetic' })).status));
    assert.equal(f.calls.some(c => /UPDATE lista_bloques|SET used_at|INSERT INTO mia_lista_auditoria/.test(c.sql)), false);
    assert.ok(f.calls.some(c => c.sql === 'ROLLBACK'));
  }
  const changed = harness(exactRows(), { ...proposal, solicitante_usuario_id: 8 }, { actor: { id: 7, activo: true, rol: 'admin' } });
  assert.equal((await changed.call('/confirmar', { confirmacion_token: 'synthetic' })).status, 403);
  const allowed = harness(exactRows(), proposal, { actor: { id: 7, activo: true, rol: 'admin' } });
  assert.equal((await allowed.call('/confirmar', { confirmacion_token: 'synthetic' })).status, 200);
  const sql = allowed.calls.map(c => c.sql);
  assert.ok(sql.findIndex(s => s.includes('FROM mia_lista_propuestas')) < sql.indexOf('INJECTED_ACTOR_LOCK'));
  assert.ok(sql.indexOf('INJECTED_ACTOR_LOCK') < sql.findIndex(s => s.includes('SELECT id,activo FROM usuarios')));
  assert.ok(sql.findIndex(s => s.includes('SELECT id,activo FROM usuarios')) < sql.findIndex(s => s.includes('FROM lista_bloques b')));
  assert.match(sql.find(s => s.includes('SELECT id,activo FROM usuarios')), /FOR SHARE/);
});
test('proposal mutation fails closed without injected identity and cannot trust transport leader flag', async () => {
  const missing = harness(exactRows(), null, { missingLock: true });
  assert.equal((await missing.call('/propuestas', { operacion: 'crear', payload: { texto: 'Nuevo' } })).status, 503);
  assert.equal(missing.calls.length, 0);
  const ordinary = harness(exactRows());
  assert.equal((await ordinary.call('/propuestas', { operacion: 'crear', usuario_id: 8, payload: { texto: 'Nuevo' } })).status, 403);
  assert.equal(ordinary.calls.some(c => c.sql.includes('INSERT INTO mia_lista_propuestas')), false);
});
test('original empty destination serializes before block reads and rejects newly existing checklists without writes or consumption', async () => {
  const proposal = { operacion: 'crear', solicitante_usuario_id: 7, objetivo_usuario_id: 7, resumen: 'Voy a agregar',
    payload: { texto: 'Nuevo', bloque_id: null, lista_id: null, bloque_version: null } };
  for (const late of [false, true]) {
    let reads = 0;
    const f = harness(() => (++reads === 1 && late) ? [] : exactRows(), proposal);
    assert.equal((await f.call('/confirmar', { confirmacion_token: 'synthetic' })).status, 409);
    const sql = f.calls.map(c => c.sql);
    const advisory = sql.findIndex(s => s.includes('pg_advisory_xact_lock'));
    const blockRead = sql.findIndex(s => s.includes('FROM lista_bloques b'));
    assert.ok(advisory >= 0 && advisory < blockRead);
    assert.deepEqual(f.calls[advisory].params, [JSON.stringify(['personal-default', 7])]);
    assert.doesNotMatch(sql[blockRead], /FOR UPDATE/);
    assert.equal(sql.some(s => /INSERT INTO lista_bloques|UPDATE lista_bloques|SET used_at|INSERT INTO mia_lista_auditoria/.test(s)), false);
    const listLock = sql.findIndex(s => s.startsWith('SELECT id FROM listas_personales'));
    if (late) {
      assert.ok(listLock > blockRead);
      assert.ok(sql.findIndex((s, index) => index > listLock && s.includes('FROM lista_bloques b')) > listLock);
    } else assert.equal(listLock, -1);
    assert.ok(sql.includes('ROLLBACK'));
  }
});
