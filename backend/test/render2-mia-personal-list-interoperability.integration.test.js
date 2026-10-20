import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword, assertFixtureIdentity } from '../scripts/render2-local-test.js';

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

// Explicit opt-in only: the real principal mounts MIA with its production
// current-actor lock closure. No injected req.wilson, mock SQL or configured DB.
test('UI/MIA private checklist interoperability: CAS, exact BIGSERIAL destinations and current actor authority', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const actors = { own: 'qa-mia-list-owner-55674', admin: 'qa-mia-list-admin-55674',
    foreign: 'qa-mia-list-foreign-55674', empty: 'qa-mia-list-empty-55674' };
  const fixture = await startLocalHarness({ port: 55674, wilson: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }), allowedWhatsappIds: Object.values(actors).join(','),
  } });
  t.after(async () => {
    await fixture.cleanup();
    await assert.rejects(access(fixture.root), error => error.code === 'ENOENT');
    t.diagnostic(`Own MIA/list interoperability fixture stopped and removed: ${fixture.root}`);
  });
  const [identity] = await fixture.query(`SELECT current_database() AS database,current_user AS username,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory`);
  assertFixtureIdentity({ root: fixture.root, cwd: fixture.root, port: 55674,
    url: 'postgresql://render2_fixture@127.0.0.1:55674/render2_local_test', identity });
  for (const [actor, id] of [['own', 91003], ['admin', 91001], ['foreign', 91004]])
    await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1,whatsapp_habilitado=true WHERE id=$2', [hash(actors[actor]), id]);
  await fixture.query(`INSERT INTO usuarios(id,usuario,nombre,rol,password_hash,activo,session_version,whatsapp_id_hash,whatsapp_habilitado)
    SELECT 91801,'qa_mia_empty_55674','QA empty checklist account','edicion',password_hash,true,1,$1,true
    FROM usuarios WHERE id=91003`, [hash(actors.empty)]);
  const checked = (response, status = 200) => {
    assert.equal(response.status, status, 'HTTP status (no credentials or confirmation tokens in diagnostic)'); return response.body;
  };
  const api = (route, token, method = 'GET', body) => request(fixture.base, `/api${route}`, { token, method, body });
  const login = async usuario => checked(await api('/login', undefined, 'POST', { usuario, password: fixturePassword })).token;
  const owner = await login('qa_luciano'), outsider = await login('qa_designer'), emptyOwner = await login('qa_mia_empty_55674');
  const signed = async (route, body, { actor = 'own', method = 'POST', group = '' } = {}) => {
    const url = new URL(`/api/integraciones/wilson/lista-personal${route}`, fixture.base);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomUUID();
    const displayName = 'UNTRUSTED QA admin display name';
    const message = ['v2', timestamp, nonce, 'whatsapp', actors[actor], group, displayName, method,
      `${url.pathname}${url.search}`, hash(body === undefined ? '' : canonical(body))].join('\n');
    const response = await fetch(url, { method, signal: AbortSignal.timeout(5000), headers: {
      'x-wilson-signature-version': '2', 'x-wilson-timestamp': timestamp, 'x-wilson-nonce': nonce,
      'x-wilson-channel': 'whatsapp', 'x-wilson-actor-id': actors[actor], 'x-wilson-actor-name': displayName,
      'x-wilson-signature': crypto.sign('sha256', Buffer.from(message), privateKey).toString('base64'),
      ...(group ? { 'x-wilson-group-id': group } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const tables = ['listas_personales', 'lista_secciones', 'lista_items', 'lista_bloques',
    'lista_plantillas_personales', 'lista_recordatorios_personales', 'mia_lista_auditoria', 'mia_lista_propuestas'];
  const snapshot = async () => {
    const result = {};
    for (const table of tables) result[table] = await fixture.query(`SELECT * FROM ${table} r ORDER BY to_jsonb(r)::text`);
    return result;
  };
  const unchanged = async before => {
    const after = await snapshot();
    // Hash diagnostics avoid dumping private content or proposal tokens on failure.
    for (const table of tables) assert.equal(hash(JSON.stringify(after[table])), hash(JSON.stringify(before[table])), `${table} unchanged`);
  };
  let serial = 0;
  const create = async (token = owner) => {
    const itemId = crypto.randomUUID();
    const list = checked(await api('/listas-personales', token, 'POST', {
      titulo: `QA MIA private page ${++serial}`, bloques: [{ tipo: 'checklist', contenido: {
        titulo: 'QA checklist', items: [{ id: itemId, texto: `Original QA item ${serial}`, completado: false }],
      } }],
    }), 201);
    const block = list.bloques[0]; assert.equal(typeof list.id, 'string'); assert.equal(typeof block.id, 'string');
    await fixture.query(`INSERT INTO lista_recordatorios_personales(usuario_id,lista_id,bloque_id,item_uid,texto,proximo_envio_at,repeticion)
      SELECT usuario_id,$1,$2,$3,$4,'2100-01-01T12:00:00Z','una_vez' FROM listas_personales WHERE id=$1`,
    [list.id, block.id, itemId, block.contenido.items[0].texto]);
    return { list, block, itemId };
  };
  const readBlock = async id => (await fixture.query('SELECT * FROM lista_bloques WHERE id=$1', [id]))[0];
  const uiWrite = (block, content, token = owner) => api(`/listas-personales/bloques/${block.id}`, token, 'PATCH', {
    tipo: 'checklist', contenido: content, expected_version: block.version,
  });
  const propose = async (operation, payload, options = {}) => {
    const body = checked(await signed('/propuestas', { operacion: operation, payload,
      ...(options.target === undefined ? {} : { usuario_id: options.target }) }, options), 201);
    assert.match(body.confirmacion_token, /^[a-f0-9-]{36}$/i); return body.confirmacion_token;
  };
  const confirm = (token, options) => signed('/confirmar', { confirmacion_token: token }, options);
  const assertUnconsumed = async token => {
    const [row] = await fixture.query('SELECT used_at,cancelled_at FROM mia_lista_propuestas WHERE token=$1', [token]);
    assert.deepEqual(row, { used_at: null, cancelled_at: null });
  };

  await t.test('UI edit after proposal makes MIA confirmation stale; complete proposal/audit/reminder rollback; fresh proposal works', async () => {
    const context = await create();
    const proposal = await propose('editar', { item_id: context.itemId, texto: 'MIA stale desired text' });
    const content = { ...context.block.contenido, items: [{ id: context.itemId, texto: 'UI wins exact text', completado: false }] };
    const saved = checked(await uiWrite(context.block, content));
    assert.equal(saved.version, context.block.version + 1);
    const before = await snapshot(); checked(await confirm(proposal), 409); await unchanged(before); await assertUnconsumed(proposal);
    assert.deepEqual((await readBlock(context.block.id)).contenido, content);
    const fresh = await propose('editar', { item_id: context.itemId, texto: 'MIA fresh explicit text' });
    checked(await confirm(fresh));
    const block = await readBlock(context.block.id);
    assert.equal(block.version, saved.version + 1); assert.equal(block.contenido.items[0].texto, 'MIA fresh explicit text');
    assert.deepEqual(await fixture.query('SELECT texto,activo FROM lista_recordatorios_personales WHERE bloque_id=$1', [block.id]),
      [{ texto: 'MIA fresh explicit text', activo: true }]);
    assert.ok((await fixture.query('SELECT used_at FROM mia_lista_propuestas WHERE token=$1', [fresh]))[0].used_at);
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM mia_lista_auditoria WHERE bloque_id=$1', [block.id]))[0].n, 1);
  });

  await t.test('MIA confirmation first increments the UI block CAS; stale UI preserves MIA content and fresh UI works', async () => {
    const context = await create();
    const proposal = await propose('completar', { item_id: context.itemId }); checked(await confirm(proposal));
    const afterMia = await readBlock(context.block.id);
    assert.equal(afterMia.version, context.block.version + 1); assert.equal(afterMia.contenido.items[0].completado, true);
    const desired = { ...context.block.contenido, items: [{ id: context.itemId, texto: 'UI fresh after MIA', completado: true }] };
    const before = await snapshot(); checked(await uiWrite(context.block, desired), 409); await unchanged(before);
    const saved = checked(await uiWrite(afterMia, desired)); assert.equal(saved.version, afterMia.version + 1);
    assert.deepEqual((await readBlock(context.block.id)).contenido, desired);
  });

  await t.test('adjacent BIGSERIAL IDs above MAX_SAFE remain distinct through signed inventory, item selection and explicit create destination', async () => {
    const ids = ['9007199254740992', '9007199254740993'], contexts = [];
    for (const [index, id] of ids.entries()) {
      const itemId = crypto.randomUUID(), content = { titulo: `BIG QA ${index}`, items: [{ id: itemId, texto: `BIG exact item ${index}`, completado: false }] };
      await fixture.query('INSERT INTO listas_personales(id,usuario_id,titulo,emoji,posicion) VALUES ($1,91003,$2,$3,$4)',
        [id, `BIG exact page ${index}`, '📝', 100 + index]);
      await fixture.query("INSERT INTO lista_bloques(id,lista_id,tipo,contenido,posicion) VALUES ($1,$2,'checklist',$3::jsonb,0)", [id, id, JSON.stringify(content)]);
      contexts.push({ id, itemId, content });
    }
    const inventory = checked(await signed('/', undefined, { method: 'GET' }));
    for (const context of contexts) {
      const item = inventory.items.find(row => row.id === context.itemId);
      assert.ok(item); assert.equal(item.bloque_id, context.id); assert.equal(item.lista_id, context.id);
    }
    const untouched = await readBlock(ids[0]);
    const edit = await propose('editar', { item_id: contexts[1].itemId, texto: 'Only exact BIG B changes' });
    checked(await confirm(edit));
    assert.deepEqual(await readBlock(ids[0]), untouched);
    assert.equal((await readBlock(ids[1])).contenido.items[0].texto, 'Only exact BIG B changes');
    const add = await propose('crear', { lista_id: ids[1], bloque_id: ids[1], texto: 'BIG explicit B addition' });
    const [proposal] = await fixture.query('SELECT payload FROM mia_lista_propuestas WHERE token=$1', [add]);
    assert.equal(proposal.payload.lista_id, ids[1]); assert.equal(proposal.payload.bloque_id, ids[1]);
    checked(await confirm(add)); assert.deepEqual(await readBlock(ids[0]), untouched);
    assert.equal((await readBlock(ids[1])).contenido.items.filter(row => row.texto === 'BIG explicit B addition').length, 1);
  });

  await t.test('missing explicit list/block and foreign destination never fall back or insert/cancel a proposal', async () => {
    const own = await create(), foreign = await create(outsider);
    for (const payload of [
      { lista_id: '9223372036854775806' }, { bloque_id: '9223372036854775806' },
      { lista_id: own.list.id, bloque_id: '9223372036854775806' },
      { lista_id: own.list.id, bloque_id: foreign.block.id }, { lista: 'QA missing named destination 55674' },
      { lista_id: foreign.list.id }, { bloque_id: foreign.block.id },
    ]) {
      const before = await snapshot();
      checked(await signed('/propuestas', { operacion: 'crear', payload: { ...payload, texto: 'Must never fall back' } }), 404);
      await unchanged(before);
    }
    const before = await snapshot();
    checked(await signed('/propuestas', { usuario_id: 91004, operacion: 'crear', payload: { texto: 'No cross-user authority' } }), 403);
    checked(await uiWrite(own.block, own.block.contenido, outsider), 404); await unchanged(before);
  });

  await t.test('explicit destination deleted after create proposal rejects atomically without replacement block/page', async () => {
    for (const removeList of [false, true]) {
      const context = await create();
      const proposal = await propose('crear', { lista_id: context.list.id, bloque_id: context.block.id, texto: 'Never recreate missing destination' });
      checked(await api(removeList ? `/listas-personales/${context.list.id}` : `/listas-personales/bloques/${context.block.id}`, owner, 'DELETE'));
      const before = await snapshot(); checked(await confirm(proposal), 409); await unchanged(before); await assertUnconsumed(proposal);
    }
  });

  await t.test('empty-default proposal cannot create another default after UI creates a checklist; genuinely empty default still works', async () => {
    assert.deepEqual(checked(await signed('/', undefined, { actor: 'empty', method: 'GET' })).items, []);
    const proposal = await propose('crear', { texto: 'Default proposed before UI checklist exists' }, { actor: 'empty' });
    const [observed] = await fixture.query('SELECT payload FROM mia_lista_propuestas WHERE token=$1', [proposal]);
    for (const key of ['lista_id', 'bloque_id', 'bloque_version']) assert.equal(observed.payload[key], null);
    const context = await create(emptyOwner);
    const before = await snapshot();
    checked(await confirm(proposal, { actor: 'empty' }), 409); await unchanged(before); await assertUnconsumed(proposal);
    assert.equal((await fixture.query(`SELECT count(*)::int AS n FROM lista_bloques b
      JOIN listas_personales l ON l.id=b.lista_id WHERE l.usuario_id=91801`))[0].n, 1);
    checked(await api(`/listas-personales/${context.list.id}`, emptyOwner, 'DELETE'));
    const fresh = await propose('crear', { texto: 'Genuinely empty default succeeds' }, { actor: 'empty' });
    const prior = await snapshot(); checked(await confirm(fresh, { actor: 'empty' }));
    const after = await snapshot();
    assert.equal(after.listas_personales.length, prior.listas_personales.length + 1);
    assert.equal(after.lista_bloques.length, prior.lista_bloques.length + 1);
    const rows = await fixture.query(`SELECT b.id,b.contenido FROM lista_bloques b
      JOIN listas_personales l ON l.id=b.lista_id WHERE l.usuario_id=91801`);
    assert.equal(rows.length, 1); assert.equal(rows[0].contenido.items.length, 1);
    assert.equal(rows[0].contenido.items[0].texto, 'Genuinely empty default succeeds');
    assert.ok((await fixture.query('SELECT used_at FROM mia_lista_propuestas WHERE token=$1', [fresh]))[0].used_at);
  });

  await t.test('currently linked admin may explicitly propose and confirm cross-user changes', async () => {
    const context = await create();
    const proposal = await propose('editar', { item_id: context.itemId, texto: 'Current admin permitted explicit cross-user edit' }, { actor: 'admin', target: 91003 });
    checked(await confirm(proposal, { actor: 'admin' }));
    const current = await readBlock(context.block.id);
    assert.equal(current.version, context.block.version + 1);
    assert.equal(current.contenido.items[0].texto, 'Current admin permitted explicit cross-user edit');
    const audit = await fixture.query('SELECT usuario_id,actor_usuario_id,bloque_id FROM mia_lista_auditoria WHERE bloque_id=$1', [context.block.id]);
    assert.deepEqual(audit, [{ usuario_id: 91003, actor_usuario_id: 91001, bloque_id: context.block.id }]);
  });

  await t.test('admin role downgrade after cross-user proposal denies confirmation without consuming or changing private data', async () => {
    const context = await create();
    const proposal = await propose('editar', { item_id: context.itemId, texto: 'Must reject downgraded administrator' }, { actor: 'admin', target: 91003 });
    await fixture.query("UPDATE usuarios SET rol='diseno',session_version=session_version+1 WHERE id=91001");
    try {
      const before = await snapshot(); checked(await confirm(proposal, { actor: 'admin' }), 403); await unchanged(before); await assertUnconsumed(proposal);
    } finally { await fixture.query("UPDATE usuarios SET rol='admin',session_version=session_version+1 WHERE id=91001"); }
  });

  await t.test('confirmation waits for an in-flight actor revocation and checks the committed role before changing content', async () => {
    const context = await create();
    const proposal = await propose('editar', { item_id: context.itemId, texto: 'Must not bypass concurrent downgrade' }, { actor: 'admin', target: 91003 });
    const before = await snapshot();
    const barrier = new pg.Client({ connectionString: 'postgresql://render2_fixture@127.0.0.1:55674/render2_local_test' });
    await barrier.connect();
    let pending;
    try {
      await barrier.query('BEGIN');
      await barrier.query("UPDATE usuarios SET rol='diseno',session_version=session_version+1 WHERE id=91001");
      const pid = (await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = confirm(proposal, { actor: 'admin' }).then(result => ({ result }), error => ({ error }));
      let observed = false;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        // pg_stat_activity snapshots are cached within this explicit barrier
        // transaction; refresh before observing the independently running HTTP.
        await barrier.query('SELECT pg_stat_clear_snapshot()');
        if ((await barrier.query(`SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))
          AND query LIKE '%FROM usuarios WHERE id=$1 FOR SHARE%'`, [pid])).rowCount) { observed = true; break; }
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(observed, true, 'Actual transactional identity lock must wait behind the actor update');
      await barrier.query('COMMIT');
      const outcome = await pending;
      assert.equal(outcome.error, undefined); checked(outcome.result, 403);
      await unchanged(before); await assertUnconsumed(proposal);
    } finally {
      await barrier.query('ROLLBACK');
      await barrier.end();
      if (pending) await pending;
      await fixture.query("UPDATE usuarios SET rol='admin',session_version=session_version+1 WHERE id=91001");
    }
  });

  await t.test('same signed external actor relinked to another active ID cannot consume the original requester proposal', async () => {
    const context = await create();
    const proposal = await propose('editar', { item_id: context.itemId, texto: 'Original requester only' });
    await fixture.query('UPDATE usuarios SET whatsapp_id_hash=NULL WHERE id=91003');
    await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1 WHERE id=91004', [hash(actors.own)]);
    try {
      const before = await snapshot(); checked(await confirm(proposal), 403); await unchanged(before); await assertUnconsumed(proposal);
    } finally {
      await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1 WHERE id=91004', [hash(actors.foreign)]);
      await fixture.query('UPDATE usuarios SET whatsapp_id_hash=$1 WHERE id=91003', [hash(actors.own)]);
    }
  });

  await t.test('inactive target after current-admin proposal denies confirmation and preserves reminders/audit/unused proposal', async () => {
    const context = await create();
    const proposal = await propose('editar', { item_id: context.itemId, texto: 'Inactive target must remain untouched' }, { actor: 'admin', target: 91003 });
    await fixture.query('UPDATE usuarios SET activo=false WHERE id=91003');
    try {
      const before = await snapshot(); checked(await confirm(proposal, { actor: 'admin' }), 403); await unchanged(before); await assertUnconsumed(proposal);
    } finally { await fixture.query('UPDATE usuarios SET activo=true WHERE id=91003'); }
  });
});
