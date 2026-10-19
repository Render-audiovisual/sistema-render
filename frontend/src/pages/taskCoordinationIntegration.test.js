import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');

test('principal detail supplies current task, identity, strict update queue and shared leave state to coordination', () => {
  assert.equal((source.match(/<TaskCoordination /g) || []).length, 1);
  assert.match(source, /<TaskCoordination task=\{task\} sesion=\{sesion\} onUpdate=\{onUpdate\} onDraftStateChange=\{setCoordinationDraft\}/);
  assert.match(source, /const taskDraftDirty =[\s\S]*?coordinationDraft\.dirty/);
  assert.match(source, /const taskWriteBusy =[^;]*coordinationDraft\.busy/);
  assert.match(source, /if \(windowMotion.closing \|\| taskWriteBusy/);
  assert.match(source, /useNavigationGuard\([\s\S]*?dirty: taskDraftDirty, busy: taskWriteBusy/);
});

test('observed coordination revision cannot enter generic automatic conflict retry', () => {
  assert.match(source, /const updateTask = \(id, changes, activity, observedRevision = null\)/);
  assert.match(source, /observedRevision !== null && previous\.revision !== observedRevision/);
  assert.match(source, /observedRevision === null && canRetryTaskUpdate\(previous, currentTask, changes\)/);
});

test('retained German coordination control carries the observed revision and explains conflicts', () => {
  const legacy = readFileSync(new URL('./dashboards/German.jsx', import.meta.url), 'utf8');
  const control = legacy.slice(legacy.indexOf('const handleCoordinarFecha'), legacy.indexOf('const handleMarcar', legacy.indexOf('const handleCoordinarFecha')));
  assert.match(control, /Number\.isSafeInteger\(produccion\.revision\)/);
  assert.match(control, /expected_revision: produccion\.revision/);
  assert.match(control, /response\.status === 409/);
});
