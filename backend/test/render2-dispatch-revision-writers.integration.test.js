import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

test('actual PostgreSQL dispatch row writers invalidate the shared API revision', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const f = await startLocalHarness({ port: 55692 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), error => error.code === 'ENOENT'); });
  const api = (route, options) => request(f.base, `/api${route}`, options);
  const login = await api('/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const [client] = await f.query("INSERT INTO clientes(nombre) VALUES('QA79 version writers') RETURNING id");
  let sequence = 0;
  const create = async () => {
    const [piece] = await f.query("INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada) VALUES($1,'video','pendiente','2026-10-22') RETURNING *", [client.id]);
    const body = { clientId: client.id, publicationId: piece.id, type: 'reel', caption: 'QA79 original',
      platforms: { instagram: true }, materials: ['https://drive.google.com/file/d/qa79/view'],
      mode: 'draft', requestKey: `qa79-writers-${++sequence}` };
    const response = await api('/publicacion-envios', { token, method: 'POST', body });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return { piece, body, draft: response.body };
  };
  const read = async id => {
    const response = await api('/publicacion-envios?estado=borrador', { token });
    assert.equal(response.status, 200);
    const row = response.body.find(item => String(item.id) === String(id));
    assert.ok(row); return row;
  };
  await t.test('installation preserves populated historical rows byte-for-byte', async () => {
    const { draft } = await create();
    await f.query('DROP TRIGGER publicacion_envios_monotonic_revision ON publicacion_envios');
    await f.query('DROP FUNCTION publicacion_envios_monotonic_revision()');
    const before = await f.query('SELECT * FROM publicacion_envios ORDER BY id');
    await f.query(await readFile(new URL('../migrations/071_dispatch_monotonic_revision.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await f.query('SELECT * FROM publicacion_envios ORDER BY id'), before);
    assert.equal((await read(draft.id)).revision, draft.revision);
  });
  await t.test('direct writer cannot retain or backdate the revision; stale HTTP write has no DML', async () => {
    const { piece, body, draft } = await create();
    await f.query("UPDATE publicacion_envios SET copy='QA79 external',updated_at='2000-01-01' WHERE id=$1", [draft.id]);
    const current = await read(draft.id);
    assert.ok(current.revision > draft.revision); assert.equal(current.caption, 'QA79 external');
    const before = await f.query('SELECT * FROM publicacion_envios WHERE id=$1', [draft.id]);
    const stale = await api(`/publicacion-envios/${draft.id}`, { token, method: 'PATCH', body: { ...body, expectedRevision: draft.revision } });
    assert.equal(stale.status, 409); assert.equal(stale.body.code, 'DISPATCH_REVISION_CONFLICT');
    assert.deepEqual(await f.query('SELECT * FROM publicacion_envios WHERE id=$1', [draft.id]), before);
    assert.deepEqual((await f.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]))[0], piece);
    const replay = await api('/publicacion-envios', { token, method: 'POST', body });
    assert.equal(replay.status, 409); assert.equal(replay.body.code, 'DISPATCH_REPLAY_CHANGED');
  });
  await t.test('retired parent API preserves history; fixture-only parent deletion still advances dispatch FK revision', async () => {
    const { piece, body, draft } = await create();
    const materials = await f.query('SELECT * FROM publicacion_envio_materiales WHERE envio_id=$1', [draft.id]);
    const targets = await f.query('SELECT * FROM publicacion_envio_destinos WHERE envio_id=$1', [draft.id]);
    const deleted = await api(`/publicaciones/${piece.id}`, { token, method: 'DELETE' });
    assert.equal(deleted.status, 410);
    assert.deepEqual((await f.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]))[0], piece);
    assert.deepEqual(await read(draft.id), draft);
    // Verify071's physical FK writer separately on synthetic fixture data. The
    // retired HTTP endpoint is never used as permission for a hard deletion.
    await f.query('DELETE FROM publicaciones WHERE id=$1', [piece.id]);
    const current = await read(draft.id);
    assert.equal(current.publicationId, null); assert.ok(current.revision > draft.revision);
    assert.equal(current.caption, draft.caption); assert.equal(current.status, 'borrador'); assert.equal(current.previewOnly, true);
    assert.deepEqual(await f.query('SELECT * FROM publicacion_envio_materiales WHERE envio_id=$1', [draft.id]), materials);
    assert.deepEqual(await f.query('SELECT * FROM publicacion_envio_destinos WHERE envio_id=$1', [draft.id]), targets);
    const stale = await api(`/publicacion-envios/${draft.id}`, { token, method: 'PATCH', body: { ...body, publicationId: null, expectedRevision: draft.revision } });
    assert.equal(stale.status, 409); assert.equal(stale.body.code, 'DISPATCH_REVISION_CONFLICT');
    const saved = await api(`/publicacion-envios/${draft.id}`, { token, method: 'PATCH', body: { ...body, publicationId: null, expectedRevision: current.revision, caption: 'QA79 explicit unlinked recovery' } });
    assert.equal(saved.status, 200); assert.ok(saved.body.revision > current.revision);
  });
  await t.test('same-clock and no-op writers advance one microsecond; failed statements leave revision intact', async () => {
    const { draft } = await create();
    // A future persisted observation proves OLD+1us, not only clock_timestamp().
    await f.query("ALTER TABLE publicacion_envios DISABLE TRIGGER publicacion_envios_monotonic_revision");
    try {
      await f.query("UPDATE publicacion_envios SET updated_at='2099-01-01T00:00:00.000001Z' WHERE id=$1", [draft.id]);
    } finally {
      await f.query("ALTER TABLE publicacion_envios ENABLE TRIGGER publicacion_envios_monotonic_revision");
    }
    await f.query('UPDATE publicacion_envios SET copy=copy WHERE id=$1', [draft.id]);
    assert.equal((await read(draft.id)).revision, '2099-01-01T00:00:00.000002Z');
    const before = await f.query('SELECT * FROM publicacion_envios WHERE id=$1', [draft.id]);
    await assert.rejects(f.query('UPDATE publicacion_envios SET cliente_id=2147483647 WHERE id=$1', [draft.id]));
    assert.deepEqual(await f.query('SELECT * FROM publicacion_envios WHERE id=$1', [draft.id]), before);
    await f.query(`DO $$ DECLARE first_revision timestamptz; second_revision timestamptz;
      BEGIN
        UPDATE publicacion_envios SET copy=copy WHERE id=${Number(draft.id)} RETURNING updated_at INTO first_revision;
        UPDATE publicacion_envios SET copy=copy WHERE id=${Number(draft.id)} RETURNING updated_at INTO second_revision;
        IF second_revision <= first_revision THEN RAISE EXCEPTION 'non-monotonic dispatch revision'; END IF;
      END $$`);
    assert.equal((await read(draft.id)).revision, '2099-01-01T00:00:00.000004Z');
  });
  await t.test('editorial reconciliation preserves a dispatch-linked automatic piece even when quota becomes zero', async () => {
    const { piece, draft, body } = await create();
    await f.query("UPDATE clientes SET cuota_reels=0,cuota_carruseles=0 WHERE id=$1", [client.id]);
    await f.query("UPDATE publicaciones SET origen_calendario='automatico',fecha_bloqueada=false,calendario_clave=$2 WHERE id=$1", [piece.id, `2026-10:${client.id}:video:999`]);
    const beforePiece=await f.query('SELECT * FROM publicaciones WHERE id=$1',[piece.id]);
    const beforeDraft=await read(draft.id);
    const response = await api('/calendario-editorial/generar', { token, method: 'POST', body: { periodo: '2026-10' } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(await f.query('SELECT * FROM publicaciones WHERE id=$1', [piece.id]),beforePiece);
    const current = await read(draft.id);
    assert.deepEqual(current,beforeDraft);assert.equal(current.publicationId,piece.id);
    const saved=await api(`/publicacion-envios/${draft.id}`,{token,method:'PATCH',body:{...body,
      expectedRevision:current.revision,caption:'QA79 preserved linked work'}});
    assert.equal(saved.status,200);assert.equal(saved.body.publicationId,piece.id);
    assert.ok(saved.body.revision>current.revision);
  });
});
