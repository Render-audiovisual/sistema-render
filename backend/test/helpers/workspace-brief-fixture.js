import assert from 'node:assert/strict';
import { getUnifiedTaskContent } from '../../../frontend/src/features/render-os/utils/task-content.js';
import { isTaskDraftDirty } from '../../../frontend/src/pages/taskNavigationGuard.js';

function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing actual workspace section: ${start}`);
  return source.slice(from, to);
}

// Execute both actual owner-capturing callbacks. The fixture models a committed
// ACK, not the old undefined/Array.push return that the drawer now rejects.
export function workspaceBriefSave(source, bindings) {
  const { task, captureRequest } = bindings;
  assert.ok(Number.isSafeInteger(task.revision) && task.revision > 0, 'Fixture needs a real positive revision');
  assert.equal(typeof captureRequest, 'function');
  const owner = { taskId: task.id, captureRequest, baseline: structuredClone(task), generation: 0, pending: null, initialized: true };
  const briefDraftOwner = { current: owner }, errors = [];
  let draft = bindings.draft;
  const context = { ...bindings, briefDraftOwner, saving: false, getUnifiedTaskContent,
    setDraftState(update) { draft = typeof update === 'function' ? update(draft) : update; },
    setBriefError(value) { errors.push(value); },
    async onUpdate(id, changes, activity, observedRevision) {
      assert.equal(id, task.id);
      assert.equal(observedRevision, task.revision, 'Content save must pass its original baseline as the fourth argument');
      await bindings.onUpdate(id, changes, activity, observedRevision);
      return { ...task, ...changes, revision: task.revision + 1,
        propiedades_extra: { ...task.propiedades_extra, ...changes.propiedades_extra } };
    },
  };
  const setters = section(source, '  const setDraft = (owner => update => {', '  const [comments, setComments]');
  const save = section(source, '  const save = (owner => async () => {', '  const saveInlineField =');
  const callback = new Function(...Object.keys(context), `${setters}\n${save}\nreturn save;`)(...Object.values(context));
  return async () => {
    await callback();
    assert.deepEqual(errors.filter(Boolean), [], 'Business fixture must reach a verified ACK, not a swallowed drawer error');
    assert.equal(owner.pending, null);
    assert.equal(owner.generation, 1, 'Confirmed save uses the actual generation-aware draft setter');
    assert.equal(draft.id, task.id);
    assert.equal(draft.revision, owner.baseline.revision);
  };
}

export function observeWorkspaceBrief(source, { task, baseline, draft, editing = false, pending = null }) {
  const marker = source.indexOf('    draftSourceRef.current = task;');
  const start = source.lastIndexOf('  useEffect(() => {', marker);
  const end = source.indexOf('  }, [task?.updated_at, task?.revision]);', marker);
  assert.ok(marker >= 0 && start >= 0 && end > marker, 'Actual observation must track revision as well as timestamp');
  const owner = { baseline: structuredClone(baseline), pending }, writes = [];
  const context = { task, draft, editing, draftSourceRef: { current: baseline }, briefDraftOwner: { current: owner },
    isTaskDraftDirty, getUnifiedTaskContent, setDraft: value => writes.push(value), useEffect: callback => callback() };
  new Function(...Object.keys(context), source.slice(start, end) + '  }, []);')(...Object.values(context));
  return { baseline: owner.baseline, writes };
}
