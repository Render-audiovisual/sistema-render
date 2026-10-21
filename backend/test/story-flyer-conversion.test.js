import test from 'node:test';
import assert from 'node:assert/strict';
import { convertUnlinkedFlyer } from '../src/story-flyer-conversion.js';

// Unit transaction protocol tests against the actual helper, not HTTP/PG proof.
// The fake stages writes until COMMIT so rollback/release ordering is observable.
const source = () => ({ id: 41, cliente_id: 12, tipo: 'flyer', estado: 'en_revision',
  fecha_programada: '2026-10-20', responsable: 'Original owner', responsable_diseño: 'Original designer',
  responsable_revisión: 'Original reviewer', responsable_publicacion: 'Original publisher',
  idea: '  Original idea\nsecond line  ', copy: 'Exact copy\nwith whitespace ', material_referencia: 'https://example.test/original',
  aclaraciones: 'Original notes', prioridad: 'alta', fecha_diseño_entrega: '2026-10-19', fecha_revisión_aprobación: null,
  fecha_publicación_real: null, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-19T12:00:00Z',
  metadata: { hora: '09:15', tipo: 'Original type', nested: { preserve: ['all', 'values'] }, original_marker: 'fixture-only' },
  duracion_segundos: 19, num_imagenes: 3, extra_original_column: 'preserve in historical snapshot' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function fixture({ piece = source(), missing = false, linkedTable, failAt, rollbackFails = false, commitGate } = {}) {
  const calls = [], failure = new Error(`Synthetic ${failAt} failure`);
  const state = { connected: 0, released: 0, publications: [structuredClone(piece)], stories: [], committed: false };
  let staged;
  const db = {
    async query(sql, values) {
      const text = sql.replace(/\s+/g, ' ').trim();
      const kind = text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' ? text
        : text.startsWith('SELECT * FROM publicaciones') ? 'LOCK' : text.startsWith('SELECT EXISTS') ? 'LINKS'
          : text.startsWith('INSERT INTO historias') ? 'INSERT' : text.startsWith('DELETE FROM publicaciones') ? 'DELETE' : 'UNKNOWN';
      calls.push({ kind, sql: text, values });
      assert.notEqual(kind, 'UNKNOWN', 'Unexpected SQL must not be silently accepted by fixture');
      if (kind === failAt) throw failure;
      if (kind === 'BEGIN') { staged = { publications: structuredClone(state.publications), stories: [] }; return {}; }
      if (kind === 'LOCK') return { rowCount: missing ? 0 : 1, rows: missing ? [] : [structuredClone(piece)] };
      if (kind === 'LINKS') {
        if (linkedTable) assert.match(text, new RegExp(`FROM ${linkedTable} WHERE publicacion_id=\\$1`));
        return { rows: [{ linked: Boolean(linkedTable) }] };
      }
      if (kind === 'INSERT') {
        const returning = text.slice(text.indexOf('RETURNING'));
        assert.doesNotMatch(returning, /\bmetadata\b|flyer_origen|SELECT\s+\*/i, 'ACK must not project the private historical snapshot');
        const row = { id: 92, cliente_id: values[0], estado: values[1], fecha_programada: values[2],
          idea: values[7], copy: values[8], material_referencia: values[9], aclaraciones: values[10], prioridad: values[11],
          metadata: JSON.parse(values[12]), created_at: '2026-10-20T13:00:00Z' };
        staged.stories.push(row);
        const { metadata: _privateSnapshot, ...ack } = row;
        return { rowCount: 1, rows: [ack] };
      }
      if (kind === 'DELETE') { staged.publications = []; return { rowCount: 1 }; }
      if (kind === 'COMMIT') {
        if (commitGate) { commitGate.entered.resolve(); await commitGate.release.promise; }
        state.publications = staged.publications; state.stories = staged.stories; state.committed = true; return {};
      }
      if (kind === 'ROLLBACK') { staged = null; if (rollbackFails) throw new Error('Synthetic rollback failure'); return {}; }
      return {};
    },
    release() { state.released++; calls.push({ kind: 'RELEASE' }); },
  };
  return { pool: { async connect() { state.connected++; return db; } }, calls, state, failure };
}

test('noncanonical and out-of-range IDs reject before pool.connect or any SQL', async () => {
  const h = fixture();
  for (const id of [undefined, null, 41, 0, 1n, {}, [], '', '0', '-1', '+1', '01', ' 1', '1 ', '1.0', '1e2',
    '2147483648', '9007199254740992', '99999999999999999999999']) {
    await assert.rejects(convertUnlinkedFlyer(h.pool, id), error => error.status === 400 && error.code === 'FLYER_INVALID');
  }
  assert.equal(h.state.connected, 0); assert.deepEqual(h.calls, []);
});

test('canonical positive PG maximum is accepted without losing parameter identity', async () => {
  const h = fixture({ piece: { ...source(), id: 2147483647 } }); await convertUnlinkedFlyer(h.pool, '2147483647');
  assert.deepEqual(h.calls.find(call => call.kind === 'LOCK').values, ['2147483647']);
});

test('missing/non-flyer lookup returns404 and rolls back without checking links or DML', async () => {
  const h = fixture({ missing: true });
  await assert.rejects(convertUnlinkedFlyer(h.pool, '41'), error => error.status === 404 && error.code === 'FLYER_NOT_FOUND');
  assert.deepEqual(h.calls.map(call => call.kind), ['BEGIN', 'LOCK', 'ROLLBACK', 'RELEASE']);
  assert.match(h.calls[1].sql, /tipo='flyer' FOR UPDATE$/); assert.equal(h.state.released, 1);
});

for (const linkedTable of ['tareas', 'cliente_objetivo_piezas', 'produccion_videos', 'publicacion_envios', 'editorial_publicacion_eventos', 'editorial_archive_events'])
test(`${linkedTable} attachment is checked only after source FOR UPDATE; conflict does no DML`, async () => {
  const h = fixture({ linkedTable }), before = structuredClone(h.state.publications);
  await assert.rejects(convertUnlinkedFlyer(h.pool, '41'), error => error.status === 409 && error.code === 'FLYER_REQUIRES_REVIEW');
  assert.deepEqual(h.calls.map(call => call.kind), ['BEGIN', 'LOCK', 'LINKS', 'ROLLBACK', 'RELEASE']);
  assert.match(h.calls[1].sql, /FOR UPDATE$/); assert.deepEqual(h.calls[2].values, ['41']);
  assert.deepEqual(h.state.publications, before); assert.deepEqual(h.state.stories, []); assert.equal(h.state.released, 1);
});

for (const historical of [{ estado: 'publicada' }, { fecha_publicación_real: '2026-10-19T12:00:00Z' }, { fecha_publicación_real: '' },
  {metadata:{archivado_tablero:true}}, {metadata:{archivado_tablero:'true'}}])
test(`historical/actual publication ${JSON.stringify(historical)} remains unchanged with409`, async () => {
  const h = fixture({ piece: { ...source(), ...historical } });
  await assert.rejects(convertUnlinkedFlyer(h.pool, '41'), error => error.status === 409 && error.code === 'FLYER_REQUIRES_REVIEW');
  assert.equal(h.calls.some(call => ['INSERT', 'DELETE', 'COMMIT'].includes(call.kind)), false);
  assert.deepEqual(h.state.stories, []); assert.equal(h.state.publications.length, 1); assert.equal(h.state.released, 1);
});

for (const estado of ['pendiente', 'en_diseño', 'en_edición', 'en_revision', 'en_revisión', 'lista', 'bloqueada'])
test(`unlinked ${estado} conversion preserves state, exact common fields and complete original snapshot`, async () => {
  const piece = { ...source(), estado }, before = structuredClone(piece), h = fixture({ piece });
  const saved = await convertUnlinkedFlyer(h.pool, '41');
  assert.deepEqual(h.calls.map(call => call.kind), ['BEGIN', 'LOCK', 'LINKS', 'INSERT', 'DELETE', 'COMMIT', 'RELEASE']);
  const insert = h.calls.find(call => call.kind === 'INSERT');
  assert.deepEqual(insert.values.slice(0, 12), [piece.cliente_id, estado, piece.fecha_programada, piece.responsable,
    piece.responsable_diseño, piece.responsable_revisión, piece.responsable_publicacion, piece.idea, piece.copy,
    piece.material_referencia, piece.aclaraciones, piece.prioridad]);
  assert.deepEqual(insert.values.slice(13), [piece.fecha_diseño_entrega, piece.fecha_revisión_aprobación]);
  const metadata = JSON.parse(insert.values[12]);
  assert.deepEqual(metadata, { ...piece.metadata, migrada_desde_flyer_id: piece.id, flyer_origen: piece });
  assert.deepEqual(metadata.flyer_origen, before); assert.deepEqual(piece, before, 'Helper never mutates input source objects');
  assert.equal(saved.estado, estado); assert.equal(saved.id, 92); assert.equal(saved.copy, piece.copy);
  assert.equal(Object.hasOwn(saved, 'metadata'), false); assert.equal(Object.hasOwn(saved, 'flyer_origen'), false);
  assert.deepEqual(h.state.stories[0].metadata.flyer_origen, before, 'Snapshot remains in DB only');
  assert.deepEqual(h.calls.find(call => call.kind === 'DELETE').values, ['41']);
  assert.equal(h.state.publications.length, 0); assert.equal(h.state.stories.length, 1);
  assert.equal(h.state.committed, true); assert.equal(h.state.released, 1);
});

test('preexisting snapshot markers cannot replace actual source snapshot and null metadata retains provenance', async () => {
  for (const metadata of [null, { migrada_desde_flyer_id: 999, flyer_origen: { id: 999 }, hora: '12:30' }]) {
    const piece = { ...source(), metadata }, h = fixture({ piece });
    const saved = await convertUnlinkedFlyer(h.pool, '41');
    assert.equal(Object.hasOwn(saved, 'metadata'), false);
    assert.equal(h.state.stories[0].metadata.migrada_desde_flyer_id, 41);
    assert.deepEqual(h.state.stories[0].metadata.flyer_origen, piece);
  }
});

for (const failAt of ['BEGIN', 'LOCK', 'LINKS', 'INSERT', 'DELETE', 'COMMIT']) test(`${failAt} failure rolls back, releases and never reports successful conversion`, async () => {
  const h = fixture({ failAt }), before = structuredClone(h.state.publications);
  await assert.rejects(convertUnlinkedFlyer(h.pool, '41'), error => error === h.failure);
  const sequence = h.calls.map(call => call.kind);
  assert.equal(sequence.at(-2), 'ROLLBACK'); assert.equal(sequence.at(-1), 'RELEASE');
  assert.equal(h.state.committed, false); assert.equal(h.state.released, 1);
  assert.deepEqual(h.state.publications, before); assert.deepEqual(h.state.stories, []);
  assert.equal(sequence.filter(kind => kind === failAt).length, 1);
});

test('rollback failure never replaces original failure and release still occurs', async () => {
  const h = fixture({ failAt: 'DELETE', rollbackFails: true });
  await assert.rejects(convertUnlinkedFlyer(h.pool, '41'), error => error === h.failure);
  assert.equal(h.state.released, 1); assert.equal(h.state.committed, false);
});

test('conversion cannot resolve or release before COMMIT has completed', async () => {
  const commitGate = { entered: deferred(), release: deferred() }, h = fixture({ commitGate });
  let resolved = false;
  const pending = convertUnlinkedFlyer(h.pool, '41').then(result => { resolved = true; return result; });
  await commitGate.entered.promise; await settle();
  assert.equal(resolved, false); assert.equal(h.state.released, 0); assert.equal(h.state.committed, false);
  assert.equal(h.state.publications.length, 1); assert.equal(h.state.stories.length, 0);
  commitGate.release.resolve(); const result = await pending;
  assert.equal(result.id, 92); assert.equal(resolved, true); assert.equal(h.state.released, 1); assert.equal(h.state.committed, true);
});

test('pool connect failure propagates without claiming a transaction or releasing an unowned connection', async () => {
  const failure = new Error('Synthetic connect failure'); let calls = 0;
  await assert.rejects(convertUnlinkedFlyer({ async connect() { calls++; throw failure; } }, '41'), error => error === failure);
  assert.equal(calls, 1);
});
