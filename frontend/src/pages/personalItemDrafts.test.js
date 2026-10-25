import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalItemDrafts } from './personalItemDrafts.js';

test('page/block drafts survive selection changes without leaking to other blocks or instances', () => {
  const a = createPersonalItemDrafts(), b = createPersonalItemDrafts();
  a.set('1', '2', 'Unsubmitted'); a.set('3', '2', 'Another page');
  assert.equal(a.get('1', '2'), 'Unsubmitted');
  assert.equal(a.get('3', '2'), 'Another page');
  assert.equal(a.get('1', '3'), ''); assert.equal(b.get('1', '2'), '');
  assert.equal(a.dirty, true); assert.equal(b.dirty, false);
});
test('consuming a submitted draft never clears a different newer value or another block', () => {
  const drafts = createPersonalItemDrafts(); drafts.set(1, 2, 'First'); drafts.set(1, 3, 'Keep');
  drafts.set(1, 2, 'Newer'); assert.equal(drafts.consume(1, 2, 'First'), false);
  assert.equal(drafts.get(1, 2), 'Newer'); assert.equal(drafts.consume(1, 2, 'Newer'), true);
  assert.equal(drafts.get(1, 3), 'Keep'); assert.equal(drafts.dirty, true);
});
test('confirmed removal and explicit discard clear only their intended scope', () => {
  const drafts = createPersonalItemDrafts(); drafts.set(1, 2, 'A'); drafts.set(1, 3, 'B'); drafts.set(2, 2, 'C');
  drafts.removeBlock(1, 2); assert.equal(drafts.get(1, 3), 'B');
  drafts.removeList(1); assert.equal(drafts.get(2, 2), 'C');
  drafts.clear(); assert.equal(drafts.dirty, false);
  drafts.set(1, 2, ' '); assert.equal(drafts.dirty, true);
  drafts.set(1, 2, ''); assert.equal(drafts.dirty, false);
});
