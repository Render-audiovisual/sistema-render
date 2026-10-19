import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_ESCALATIONS_SQL, parseEscalationPage, readHomeEscalations } from '../src/personal-home.js';

test('escalation pagination is closed, bounded and never accepts identity filters', () => {
  assert.deepEqual(parseEscalationPage(), { offset: 0, limit: 20 });
  assert.deepEqual(parseEscalationPage({ offset: '40', limit: '50' }), { offset: 40, limit: 50 });
  for (const query of [{ user_id: '1' }, { role: 'admin' }, { limit: '0' }, { limit: '51' },
    { offset: '1000001' }, { offset: '-1' }, { offset: '01' }, { limit: ['20'] }, { limit: 20 }]) {
    assert.throws(() => parseEscalationPage(query), { status: 400 });
  }
});

test('escalation selection is independent of review and projects only operational fields', () => {
  assert.match(HOME_ESCALATIONS_SQL, /jsonb_typeof\(t.propiedades_extra->'escalada_a'\)='string'/);
  assert.match(HOME_ESCALATIONS_SQL, /estado NOT IN \('finalizada','publicada'\)/);
  assert.match(HOME_ESCALATIONS_SQL, /IN \('Líder','Agustín','Franco'\)/);
  assert.match(HOME_ESCALATIONS_SQL, /OFFSET \$1 LIMIT \$2/);
  assert.doesNotMatch(HOME_ESCALATIONS_SQL, /motivo|feedback|importe|abono|to_jsonb|t\.\*|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
});

test('current server role gates queue before SQL, with rollback and release on denial', async () => {
  for (const rol of ['admin', 'diseno']) {
    const calls = [];
    let released = false;
    const db = { release() { released = true; }, async query(sql, params) {
      calls.push(sql);
      if (sql.startsWith('SELECT id,nombre')) return { rows: [{ id: 3, nombre: 'Franco', rol, activo: true, session_version: 1 }] };
      if (sql === HOME_ESCALATIONS_SQL) {
        assert.deepEqual(params, [0, 20]);
        return { rows: [{ queue: { version: 1, offset: 0, limit: 20, total: 0, has_more: false, items: [] } }] };
      }
      return { rows: [] };
    } };
    const action = readHomeEscalations({ connect: async () => db }, { id: 3, rol: rol === 'admin' ? 'diseno' : 'admin', session_version: 1 });
    if (rol === 'admin') assert.equal((await action).total, 0);
    else await assert.rejects(action, { status: 403 });
    assert.equal(calls.includes(HOME_ESCALATIONS_SQL), rol === 'admin');
    assert.equal(calls.at(-1), rol === 'admin' ? 'COMMIT' : 'ROLLBACK');
    assert.equal(released, true);
  }
});
