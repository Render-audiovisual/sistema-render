import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const reviews = readFileSync(new URL('../components/EditingReviews.jsx', import.meta.url), 'utf8');

test('review decision drafts and in-flight requests share task close/navigation guards without overwriting delivery state', () => {
  assert.match(source, /const deliveryDirty = deliveryFormDirty \|\| reviewDecisionDirty/);
  assert.match(source, /const deliveryBusy = deliveryFormBusy \|\| reviewDecisionBusy/);
  assert.match(source, /onDirty=\{setReviewDecisionDirty\} onBusy=\{setReviewDecisionBusy\}/);
  assert.match(source, /editing \|\| contentDirty \|\| deliveryDirty/);
  assert.match(source, /deliveryBusy \|\| deliveryDirty \|\| !mayApproveObservedDelivery/);
  assert.match(source, /fieldset disabled=\{reviewDecisionBusy \|\| reviewDecisionDirty \|\| approving \|\| saving\}/);
  assert.match(source, /EditingReviews task=\{task\} sesion=\{sesion\} disabled=\{deliveryFormBusy \|\| deliveryFormDirty \|\| approving \|\| saving \|\| editing\}/);
});

test('saved review refreshes canonical task through current-session guarded parent callback', () => {
  const section = source.slice(source.indexOf('async function refreshEditingTaskAfterSave'), source.indexOf('}, isCurrent);') + '}, isCurrent);'.length);
  assert.match(section, /refreshEditingTask\(\{ taskId: task.id, request: apiTaskById/);
  assert.match(section, /\}, isCurrent\)/);
  assert.match(section, /render-os:related-tasks/);
  assert.equal(source.match(/onSaved=\{refreshEditingTaskAfterSave\}/g).length, 2);
  assert.doesNotMatch(section, /localStorage|sessionStorage/);
});

test('other task actions refresh review history automatically only without a pending correction draft or result', () => {
  assert.match(reviews, /observed.current.revision !== task.revision \|\| observed.current.estado !== task.estado/);
  assert.match(reviews, /instance\?\.updateContext\(task, disabled\)/);
  assert.match(reviews, /changed && current && !current.busy && !current.uncertain && !current.notes/);
  assert.match(reviews, /void instance.refresh\(\)/);
  assert.match(reviews, /Actualizá las revisiones antes de continuar/);
});
