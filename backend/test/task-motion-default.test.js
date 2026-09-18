import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('task surface enables approved motion without an activation control', () => {
  const source = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
  assert.match(source, /useTaskWindowMotion\(task\?\.id, onClose, true\)/);
  assert.match(source, /useTaskBoardMotion\(boardRef, visible, view, true\)/);
});
