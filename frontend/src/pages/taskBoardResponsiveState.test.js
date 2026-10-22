import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import ts from 'typescript';

const css = postcss.parse(readFileSync(new URL('./WorkspaceReadOnly.css', import.meta.url), 'utf8'));
const source = ts.createSourceFile('WorkspaceReadOnly.jsx', readFileSync(new URL('./WorkspaceReadOnly.jsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const selectors = new Set(['.ros-mobile-state', '.render-workspace .ros-mobile-state']);
// Evaluate only the actual selector's width rules, preserving specificity and
// source order. This is a CSS-AST contract test, not browser layout certification.
function stateAt(width) {
  const values = new Map(); let order = 0;
  css.walkRules(rule => {
    if (!rule.selectors.some(selector => selectors.has(selector))) return;
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      if (parent.type !== 'atrule') continue;
      assert.equal(parent.name, 'media');
      const condition = /^\(\s*(max|min)-width\s*:\s*(\d+)px\s*\)$/.exec(parent.params);
      assert.ok(condition, `Explicitly support new media condition: ${parent.params}`);
      if (condition[1] === 'max' ? width > Number(condition[2]) : width < Number(condition[2])) return;
    }
    const specificity = rule.selectors.includes('.render-workspace .ros-mobile-state') ? 2 : 1;
    rule.walkDecls(declaration => {
      const rank = [declaration.important ? 1 : 0, specificity, ++order];
      const old = values.get(declaration.prop);
      if (!old || rank[0] > old.rank[0] || rank[0] === old.rank[0] && (rank[1] > old.rank[1] || rank[1] === old.rank[1] && rank[2] > old.rank[2]))
        values.set(declaration.prop, { rank, value: declaration.value });
    });
  });
  return Object.fromEntries([...values].map(([key, entry]) => [key, entry.value]));
}

test('actual CSS cascade exposes touch-sized state selector throughout compact board including tablet boundaries', () => {
  for (const width of [320, 390, 600, 640, 641, 768, 1023, 1024]) {
    const state = stateAt(width);
    assert.equal(state.display, 'block', `${width}px visibility`);
    assert.ok(Number.parseFloat(state['min-height']) >= 44, `${width}px touch target`);
    assert.equal(state['font-size'], '16px', `${width}px readable native selector`);
    assert.equal(state.width, '100%');
  }
  for (const width of [1025, 1280, 1920]) assert.equal(stateAt(width).display, 'none', `${width}px desktop remains unchanged`);
});

test('responsive state fallback matches actual compact-board hook, not a separate invented breakpoint', () => {
  assert.equal(source.parseDiagnostics.length, 0);
  let boundary;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'compactBoard') {
      assert.ok(ts.isCallExpression(node.initializer));
      assert.equal(node.initializer.expression.getText(source), 'useMediaQuery');
      boundary = node.initializer.arguments[0].text;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(boundary, '(max-width: 1024px)');
  const matching = [];
  css.walkRules(rule => {
    if (rule.selectors.includes('.render-workspace .ros-mobile-state') && rule.nodes.some(node => node.prop === 'display' && node.value === 'block')) matching.push(rule);
  });
  assert.equal(matching.length, 1);
  assert.equal(matching[0].parent.name, 'media');
  assert.equal(matching[0].parent.params.replaceAll(' ', ''), boundary.replaceAll(' ', ''));
});
