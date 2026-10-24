import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./WorkspaceReadOnly.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const selector = '.render-workspace .ros-task-comments-footer .ros-comment-action';
const rule = css.slice(css.indexOf(`${selector}{`), css.indexOf('}', css.indexOf(`${selector}{`)));

test('comment read and recovery actions share scoped token-based styling, not browser defaults', () => {
  assert.equal((source.match(/className="ros-comment-action"/g) || []).length, 2);
  for (const property of ['appearance:none', 'background:var(--render-surface-soft)', 'border:1px solid var(--render-line)',
    'color:var(--render-accent)', 'font:inherit', 'max-width:100%', 'overflow-wrap:anywhere', 'min-height:40px']) {
    assert.ok(rule.includes(property), property);
  }
});

test('comment actions expose keyboard focus and disabled feedback without animated movement', () => {
  assert.ok(css.includes(`${selector}:focus-visible{\n  outline:2px solid var(--render-accent);`));
  assert.ok(css.includes(`${selector}:hover:not(:disabled)`));
  assert.ok(css.includes(`${selector}:disabled{\n  cursor:not-allowed;`));
  assert.doesNotMatch(rule, /animation:|transform:|transition:/);
});

test('mobile comment actions retain a 44px target within the panel width', () => {
  assert.ok(css.includes(`@media(max-width:640px){\n  ${selector}{min-height:44px}`));
});
