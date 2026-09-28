import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('task surface enables approved motion without an activation control', () => {
  const source = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
  assert.match(source, /useTaskWindowMotion\(task\?\.id, onClose\)/);
  assert.match(source, /useTaskBoardMotion\(boardRef, visible, view\)/);
  assert.match(source, /ros-drawer-backdrop ros-modal-backdrop/);
});

test('task disclosures use short motion and mobile filters do not toggle display', () => {
  const css = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.css', import.meta.url), 'utf8');
  const secondPass = css.slice(css.indexOf('Segunda pasada de movimiento'));
  assert.match(secondPass, /ros-modal-enter \.19s cubic-bezier\(\.2,\.8,\.2,1\)/);
  assert.match(secondPass, /max-height \.18s cubic-bezier\(\.2,\.8,\.2,1\)/);
  assert.match(secondPass, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(secondPass, /scale\(/);
  assert.doesNotMatch(secondPass, /display:none/);
});
