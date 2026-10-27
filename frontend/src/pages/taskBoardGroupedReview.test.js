import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BOARD_COLUMNS, STATUSES, canonicalTaskState } from '../features/render-os/constants.js';
import { effectiveTaskFilterState } from '../features/render-os/utils/task-view-state.js';

const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('WorkspaceReadOnly.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const owner = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TasksView');
function callback(name, deps) {
  let found;
  const walk = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = node.initializer;
    ts.forEachChild(node, walk);
  };
  walk(owner); assert.ok(found);
  return Function(...Object.keys(deps), `return (${found.getText(file)});`)(...Object.values(deps));
}
const review = BOARD_COLUMNS.find(c => c.id === 'en_revision');
const task = estado => ({ id: 1, revision: 2, estado, propiedades_extra: { workspace: 'render_os' } });
function fixture(row, { sort = 'manual' } = {}) {
  const effects = [];
  const deps = { sort, archiveMode: 'active', manualReady: true, tasksLatestRef: { current: [row] },
    sesion: { usuario: { id: 9, rol: 'admin' } }, canonicalTaskState, effectiveTaskFilterState,
    setDragOver() {}, canUserEditTask: () => true, canUserMoveTask: () => true, canUserMoveTaskToState: () => true,
    onReorder: (...args) => effects.push(['order', ...args]), move: (...args) => { effects.push(['move', ...args]); return 'move'; },
    compactBoard: true, selectMobileBoardColumn: id => effects.push(['column', id]) };
  const event = () => ({ dataTransfer: { types: ['text/task-id'], getData: () => String(row.id) },
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  return { effects, deps, event, drop: callback('dropOnProcessButton', deps), before: callback('dropBeforeTask', deps),
    controls: callback('orderControls', deps) };
}

test('four display columns cover every business state once, retaining approval and published compatibility', () => {
  assert.deepEqual(BOARD_COLUMNS.map(c => c.id), ['pendiente', 'en_progreso', 'en_revision', 'finalizadas']);
  assert.deepEqual(review.states, ['en_revision', 'aprobada']); assert.equal(review.dropState, 'en_revision');
  assert.ok(STATUSES.some(s => s.id === 'aprobada'));
  for (const state of STATUSES.map(s => s.id)) assert.equal(BOARD_COLUMNS.filter(c => c.states.includes(state)).length, 1);
  assert.equal(effectiveTaskFilterState(task('publicada')), 'finalizada');
  const rows = [task('en_revision'), { ...task('aprobada'), id: 2 },
    { ...task('en_revision'), id: 3, propiedades_extra: { revision_aprobada: true } }];
  assert.equal(rows.filter(r => review.states.includes(effectiveTaskFilterState(r))).length, 3);
});

test('review/approved/historical drops into mixed group do not revoke, approve, order or navigate', () => {
  for (const row of [task('en_revision'), task('aprobada'),
    { ...task('en_revision'), propiedades_extra: { revision_aprobada: true } }]) {
    for (const sort of ['manual', 'date']) {
      const before = structuredClone(row), f = fixture(row, { sort });
      f.drop(f.event(), review); assert.deepEqual(f.effects, []); assert.deepEqual(row, before);
      assert.equal(f.controls(row, [row], 0), undefined);
      if (sort === 'manual') {
        const event = f.event(); f.before(event, { ...task('aprobada'), id: 4 });
        assert.equal(event.stopped, true); assert.deepEqual(f.effects, []);
      }
    }
  }
});

test('external process dropped on approved card bubbles only into en_revision, never approval or mixed anchors', () => {
  const row = task('en_progreso'), f = fixture(row), event = f.event();
  f.before(event, { ...task('aprobada'), id: 3 });
  assert.equal(event.stopped, undefined); assert.deepEqual(f.effects, []);
  f.drop(event, review);
  assert.deepEqual(f.effects, [['move', row, 'en_revision'], ['column', 'en_revision']]);
  assert.equal(row.estado, 'en_progreso', 'No optimistic state mutation');
});

test('task header removes Feedback only; dedicated application route/sidebar remain in source', () => {
  assert.doesNotMatch(owner.getText(file), /openFeedback|newFeedbackCount|refreshFeedbackCount|ros-feedback-link/);
  // The dedicated feature remains owned by the application, not the task board.
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /feedback/i);
  assert.match(source, /canonicalTaskState\(task.estado\) === 'aprobada'.*Aprobada/);
});
