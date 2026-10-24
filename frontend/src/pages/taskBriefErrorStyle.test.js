import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const source = readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8');
const root = postcss.parse(readFileSync(new URL('./WorkspaceReadOnly.css', import.meta.url), 'utf8'));

test('brief conflicts retain the live alert and readable scoped wrapping on small screens', () => {
  assert.ok(source.includes('className="ros-inline-error ros-brief-error" role="alert">{briefError}'));
  const rules = [];
  root.walkRules('.render-workspace .ros-task-workspace .ros-brief-error', rule => rules.push(rule));
  assert.equal(rules.length, 1);
  assert.deepEqual(Object.fromEntries(rules[0].nodes.map(node => [node.prop, node.value])), {
    'box-sizing': 'border-box', 'font-size': '13px', 'line-height': '1.5',
    'max-width': '100%', 'min-width': '0', 'overflow-wrap': 'anywhere', padding: '12px',
  });
});
