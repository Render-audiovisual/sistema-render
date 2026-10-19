import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCoordinationPatch, canEditTaskCoordination, coordinateSnapshot } from './taskCoordination.js';

const task = (metadata = {}) => ({ id: 7, revision: 4, updated_at: 'legacy timestamp',
  asignado_a_id: 8, colaborador_ids: [9], propiedades_extra: metadata });
const session = (id, rol) => ({ token: 'test-token', usuario: { id, rol } });

test('ACL allows positive-ID admin or assigned production owner/collaborator only', () => {
  assert.equal(canEditTaskCoordination(task(), session(1, 'admin')), true);
  assert.equal(canEditTaskCoordination(task(), session(8, 'produccion')), true);
  assert.equal(canEditTaskCoordination(task(), session(9, 'produccion')), true);
  for (const id of [0, -1, '8', NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.equal(canEditTaskCoordination(task(), session(id, 'admin')), false);
    assert.equal(canEditTaskCoordination(task(), session(id, 'produccion')), false);
  }
  for (const role of ['community', 'edicion', 'diseno', undefined]) {
    assert.equal(canEditTaskCoordination(task(), session(8, role)), false);
  }
  assert.equal(canEditTaskCoordination(task(), session(10, 'produccion')), false);
  assert.equal(canEditTaskCoordination({ ...task(), asignado_a_id: '8', colaborador_ids: ['8'] }, session(8, 'produccion')), false);
  assert.equal(canEditTaskCoordination({ ...task(), asignado_a: 'German', colaborador_ids: [], asignado_a_id: null },
    { usuario: { id: 8, rol: 'produccion', nombre: 'German' } }), false);
  assert.equal(canEditTaskCoordination(null, session(1, 'admin')), false);
});

test('snapshot captures scalar baseline and version without coercion, preserving unset', () => {
  assert.deepEqual(coordinateSnapshot(task()), {
    id: 7, revision: 4, updated_at: 'legacy timestamp', horario: undefined, coordinada: undefined, valid: true,
  });
  for (const coordinada of [true, false]) {
    const snapshot = coordinateSnapshot(task({ horario: ' después del almuerzo / no es fecha ', coordinada }));
    assert.equal(snapshot.horario, ' después del almuerzo / no es fecha ');
    assert.equal(snapshot.coordinada, coordinada);
    assert.equal(snapshot.valid, true);
  }
  assert.equal(coordinateSnapshot({ ...task(), propiedades_extra: undefined }).valid, true);
});

test('malformed historical values and missing revisions stay read-only', () => {
  const noCoercion = { toString() { throw new Error('must not stringify'); } };
  for (const horario of [null, [], ['old'], noCoercion, 12, false, 'x'.repeat(2001)]) {
    const snapshot = coordinateSnapshot(task({ horario }));
    assert.equal(snapshot.valid, false);
    assert.throws(() => buildCoordinationPatch(snapshot, { horario: 'replacement' }), /histórico/);
  }
  for (const coordinada of [null, 'true', 'false', 0, 1, {}, []]) {
    assert.equal(coordinateSnapshot(task({ coordinada })).valid, false);
  }
  for (const propiedades_extra of [null, [], 'metadata', 0]) {
    assert.equal(coordinateSnapshot({ ...task(), propiedades_extra }).valid, false);
  }
  for (const revision of [undefined, null, 0, '4', -1]) {
    assert.equal(coordinateSnapshot({ ...task(), revision }).valid, false);
  }
});

test('patch contains changed allowlisted metadata keys only and preserves arbitrary horario text', () => {
  const snapshot = coordinateSnapshot(task({ horario: 'old', coordinada: false, salary: 100, material: 'keep' }));
  assert.deepEqual(buildCoordinationPatch(snapshot, { horario: 'old', coordinada: false }), {});
  assert.deepEqual(buildCoordinationPatch(snapshot, { horario: 'whenever / <img src=x>', coordinada: false,
    salary: 999, fecha_vencimiento: 'tomorrow', usuario: 'admin' }), { horario: 'whenever / <img src=x>' });
  assert.deepEqual(buildCoordinationPatch(snapshot, { horario: 'old', coordinada: true }), { coordinada: true });
  assert.deepEqual(buildCoordinationPatch(snapshot, { horario: '', coordinada: false }), { horario: '' });
  const unset = coordinateSnapshot(task());
  assert.deepEqual(buildCoordinationPatch(unset, { horario: undefined, coordinada: undefined }), {});
  assert.deepEqual(buildCoordinationPatch(unset, { horario: 'any text', coordinada: false }), { horario: 'any text', coordinada: false });
});

test('invalid drafts and implicit deletion of existing values are rejected', () => {
  const baseline = coordinateSnapshot(task({ horario: 'old', coordinada: true }));
  for (const draft of [null, {}, { horario: {}, coordinada: true }, { horario: 'ok', coordinada: 'false' },
    { horario: 'x'.repeat(2001), coordinada: true }, { horario: undefined, coordinada: true },
    { horario: 'old', coordinada: undefined }]) assert.throws(() => buildCoordinationPatch(baseline, draft));
});

test('models do not mutate task, metadata, captured snapshot or draft', () => {
  const metadata = Object.freeze({ horario: 'old', coordinada: false, material: 'keep', finance: 'untouched' });
  const original = Object.freeze({ ...task(metadata), colaborador_ids: Object.freeze([9]) });
  const before = JSON.stringify(original);
  const snapshot = Object.freeze(coordinateSnapshot(original));
  const draft = Object.freeze({ horario: 'new', coordinada: true });
  assert.deepEqual(buildCoordinationPatch(snapshot, draft), { horario: 'new', coordinada: true });
  assert.equal(canEditTaskCoordination(original, session(9, 'produccion')), true);
  assert.equal(JSON.stringify(original), before);
  assert.equal(snapshot.horario, 'old');
});

test('component source pins captured revision/session, explicit reset and parent draft reporting', () => {
  // Structural checks only: no React mounting, event simulation or browser claim.
  const source = readFileSync(new URL('./TaskCoordination.jsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ getSesion \} from '\.\.\/utils\.jsx'/);
  assert.match(source, /onUpdate\(editor.snapshot.id, \{ propiedades_extra: changes \}, 'actualizó la coordinación', editor.snapshot.revision\)/);
  assert.equal((source.match(/await onUpdate\(/g) || []).length, 1);
  assert.match(source, /const actual = getSesion\(\)/);
  assert.match(source, /actual\?\.token === editor.token/);
  assert.match(source, /actual\?\.usuario\?\.id === editor.userId/);
  assert.match(source, /actual\?\.usuario\?\.rol === editor.role/);
  assert.match(source, /pending.current\) return/);
  assert.match(source, /if \(!mounted.current\) return/);
  assert.match(source, /setConflict\(true\)/);
  assert.match(source, /reason\?\.status === 409/);
  assert.match(source, /callback.current\?\.\(\{ dirty, busy \}\); \}, \[dirty, busy\]\)/);
  assert.match(source, /return \(\) => \{ mounted.current = false; callback.current\?\.\(\{ dirty: false, busy: false \}\)/);
  assert.match(source, /onClick=\{\(\) => \{ setEditor\(null\); setConflict\(false\); setError\(''\); \}\}>Cancelar/);
  assert.match(source, /maxLength=\{2000\}/);
  assert.match(source, /<option value="" disabled=\{editor.snapshot.coordinada !== undefined\}>Sin registrar/);
  assert.match(source, /<label>Horario o indicaciones/);
  assert.match(source, /import '\.\/TaskCoordination\.css';/);
  const styles = readFileSync(new URL('./TaskCoordination.css', import.meta.url), 'utf8');
  assert.match(styles, /\.render-workspace \.ros-task-coordination fieldset \{ border:0/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /var\(--render-accent\)/);
  assert.doesNotMatch(styles, /!important|@import|:root/);
  assert.doesNotMatch(source.replace("import './TaskCoordination.css';", ''), /fetch\(|apiRequest|apiTaskById|dangerouslySetInnerHTML|JSON\.stringify|type="(?:date|datetime-local)"|\.css['"]|localStorage/);
  // No effect resets/rebases the editor when task props change.
  assert.doesNotMatch(source, /useEffect\([\s\S]*?setEditor[\s\S]*?\}, \[task/);
});
