import test from 'node:test';
import assert from 'node:assert/strict';
import { productionVisitMembersSql } from '../src/production-visit-membership.js';

const normalized = value => value.replace(/\s+/g, ' ').trim();

test('membership is the deduplicated union of explicit participants, source assignees and current editing assignees', () => {
  const sql = normalized(productionVisitMembersSql('pv', alias => `${alias}.live_scope = TRUE`));
  const branches = sql.split(' UNION ');
  assert.equal(branches.length, 3);
  assert.equal(branches[0], 'SELECT visit_participant.usuario_id FROM produccion_visita_participantes visit_participant WHERE visit_participant.visita_id=pv.id');
  assert.equal(branches[1], 'SELECT visit_assignment.usuario_id FROM tarea_asignaciones visit_assignment JOIN tareas visit_source ON visit_source.id=visit_assignment.tarea_id WHERE visit_source.id=pv.tarea_origen_id AND (visit_source.live_scope = TRUE)');
  assert.equal(branches[2], 'SELECT editing_assignment.usuario_id FROM produccion_videos visit_video JOIN tareas visit_editing ON visit_editing.id=COALESCE(visit_video.tarea_entrega_id,visit_video.tarea_edicion_id) JOIN tarea_asignaciones editing_assignment ON editing_assignment.tarea_id=visit_editing.id WHERE visit_video.visita_id=pv.id AND (visit_editing.live_scope = TRUE)');
  assert.doesNotMatch(sql, /UNION ALL/);
});

test('both task aliases receive the original caller scope exactly once, preserving its predicates and binding placeholders', () => {
  const aliases = [], scopes = new Map();
  const sql = productionVisitMembersSql('visita', alias => {
    aliases.push(alias);
    const scope = `${alias}.cliente_id=$7 AND (${alias}.archived=false OR ${alias}.special=$8) AND ${alias}.deleted_at IS NULL`;
    scopes.set(alias, scope); return scope;
  });
  assert.deepEqual(aliases, ['visit_source', 'visit_editing']);
  for (const scope of scopes.values()) assert.equal(sql.split(`(${scope})`).length - 1, 1);
  assert.match(sql, /visit_source\.id=visita\.tarea_origen_id/);
  assert.match(sql, /visit_video\.visita_id=visita\.id/);
});

test('editing authority follows delivery task first and legacy editing fallback only, never denormalized editor or names', () => {
  const sql = productionVisitMembersSql('p', alias => `${alias}.activo=true`);
  assert.match(sql, /visit_editing\.id=COALESCE\(visit_video\.tarea_entrega_id,visit_video\.tarea_edicion_id\)/);
  assert.equal((sql.match(/JOIN tareas visit_editing/g) || []).length, 1);
  assert.doesNotMatch(sql, /editor_id|asignado_a\b|nombre|usuario\s*=|ILIKE|LOWER\(/i);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|GRANT|SELECT \*/i);
});

test('aliases reject SQL injection, qualification, whitespace, empty values and nonstrings before calling any scope', () => {
  for (const alias of ['', 'p.id', 'p;DROP TABLE tareas', 'p--', 'p x', ' p', 'p\n', '1p', 'p[0]', null, undefined, 1, {}, ['p']]) {
    let calls = 0;
    assert.throws(() => productionVisitMembersSql(alias, () => { calls++; return 'TRUE'; }), TypeError);
    assert.equal(calls, 0);
  }
  for (const alias of ['p', 'Visit_2', '_visit']) assert.ok(productionVisitMembersSql(alias, () => 'TRUE').includes(`=${alias}.id`));
});

test('missing or nonfunction caller scope is rejected and callback failure cannot silently broaden membership', () => {
  for (const scope of [undefined, null, 'TRUE', {}, []]) assert.throws(() => productionVisitMembersSql('p', scope), TypeError);
  const failure = new Error('synthetic caller scope failed');
  assert.throws(() => productionVisitMembersSql('p', () => { throw failure; }), error => error === failure);
});
