import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postcss from 'postcss';

const files = ['WorkspaceReadOnly', 'RenderApplePolish', 'TaskHeader', 'TaskDetailNotion', 'TaskDetailCompact'];
const roots = Object.fromEntries(files.map(name => [name, postcss.parse(readFileSync(new URL(`./${name}.css`, import.meta.url), 'utf8'))]));
const token = name => `var(--render-${name})`;
const normalize = selector => selector.replace(/\s+/g, ' ').trim();
function values(file, selector, property) {
  const result = [];
  roots[file].walkRules(rule => {
    if (normalize(rule.selector) === normalize(selector)) {
      rule.walkDecls(property, declaration => result.push(declaration.value));
    }
  });
  return result;
}
function last(file, selector, property) {
  const found = values(file, selector, property);
  assert.ok(found.length, `${file}: missing ${selector} ${property}`);
  return found.at(-1);
}

test('workspace typography and legacy palette aliases delegate to shared tokens', () => {
  assert.equal(last('WorkspaceReadOnly', '.render-workspace', 'font-family'), token('font'));
  for (const [alias, shared] of Object.entries({ ink: 'ink', muted: 'muted', line: 'line', soft: 'surface-soft', lime: 'accent', 'lime-hover': 'accent-hover', 'lime-muted': 'accent-border', graphite: 'ink', warm: 'canvas' })) {
    assert.equal(last('WorkspaceReadOnly', '.render-workspace', `--ros-${alias}`), token(shared));
  }
  for (const name of files) {
    roots[name].walkDecls('font-family', declaration => {
      assert.match(declaration.value, /^(?:inherit|var\(--render-font\)|.*Emoji.*)$/);
    });
  }
});

test('both late primary-action layers retain shared blue and white semantics', () => {
  for (const name of ['RenderApplePolish', 'TaskHeader']) {
    assert.equal(last(name, '.render-workspace .ros-primary-button', 'background'), token('accent'));
    assert.equal(last(name, '.render-workspace .ros-primary-button', 'color'), token('accent-ink'));
    assert.equal(last(name, '.render-workspace .ros-primary-button:hover', 'background'), token('accent-hover'));
  }
  const selector = '.render-workspace .ros-content-edit-actions button.primary';
  assert.equal(last('WorkspaceReadOnly', selector, 'background'), token('accent'));
  assert.equal(last('WorkspaceReadOnly', selector, 'color'), token('accent-ink'));
});

test('approval handoff stays neutral with its blue and white action intact', () => {
  const selector = '.render-workspace .ros-approval-handoff';
  assert.equal(last('WorkspaceReadOnly', selector, 'background'), token('surface-soft'));
  assert.equal(last('WorkspaceReadOnly', selector, 'border'), `1px solid ${token('line')}`);
  assert.equal(last('WorkspaceReadOnly', selector, 'color'), token('ink'));
  assert.equal(last('WorkspaceReadOnly', `${selector} span`, 'color'), token('muted'));
  assert.equal(last('WorkspaceReadOnly', `${selector} button`, 'background'), token('accent'));
  assert.equal(last('WorkspaceReadOnly', `${selector} button`, 'color'), token('accent-ink'));
});

test('document surfaces, quiet accents and keyboard focus use shared tokens', () => {
  assert.equal(last('TaskDetailNotion', '.render-workspace .ros-task-workspace-body', 'background'), token('surface'));
  assert.equal(last('TaskDetailNotion', '.render-workspace .ros-task-window-icon', 'background'), token('accent-soft'));
  assert.equal(last('TaskDetailNotion', '.render-workspace .ros-task-window-icon', 'color'), token('accent'));
  assert.equal(last('TaskHeader', '.render-workspace .ros-feedback-link b', 'background'), token('accent-soft'));
  assert.equal(last('TaskDetailCompact', '.render-workspace .ros-task-comments-footer .ros-comment-create textarea:focus', 'border-bottom-color'), token('accent'));
  for (const name of files) {
    roots[name].walkDecls(declaration => {
      if (declaration.prop === 'outline' && declaration.parent.selector?.includes('focus-visible')) {
        assert.equal(declaration.value, `2px solid ${token('accent')}`);
      }
    });
  }
});

// Migration guards captured from the pre-migration styles, not screenshots.
// Only paint/font values are omitted; selector/at-rule order, !important flags,
// declaration counts, sizing, layout, visibility and motion remain pinned.
const paint = /^(?:--ros-(?:ink|muted|line|soft|lime(?:-hover|-muted)?|graphite(?:-soft|-deep)?|warm|neutral|accent-strong)|background(?:-color)?|color|border(?:-(?:top|bottom|left|right|block))?(?:-color)?|outline(?:-color)?|box-shadow|text-decoration-color|scrollbar-color|font-family|font-weight)$/;
function structure(node) {
  if (node.type === 'comment') return null;
  if (node.type === 'decl') return [node.prop, !!node.important, paint.test(node.prop) ? null : node.value];
  return [node.type, node.selector || node.name, node.params, ...(node.nodes || []).map(structure).filter(Boolean)];
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const layoutBaseline = {
  WorkspaceReadOnly: '4393c850d1030445e9ff49760d7a4a6b773d91a42f08aebb81da906a340c3a6e',
  RenderApplePolish: '622868f4d950c468758fd420378e644befbb93a0c1ea283a0fc331d2ecf370dd',
  TaskHeader: '284515b36e7c319aef5c67edd9689c2dfcd68b3096f20fc8157d757a98dd86f4',
  TaskDetailNotion: 'ea76f4d2e014e5f391e90938bc64f69d671c4a71acf045dc07001b8b1ae6f295',
  TaskDetailCompact: '852876b2b66daed8c935703fa48b76c50805f57d51b912521819ae4c48369cad',
};
const identityBaseline = {
  WorkspaceReadOnly: '2d60296b153270616a4e44d537f5f44735000f1e6617bd41cd542b8f685cbdf3',
  RenderApplePolish: '99aafa6817ff20b6386e804a835b83cf49bf7d6d550511546e03359b8481b18d',
  TaskHeader: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  TaskDetailNotion: '44a534f98a574fe39b62027f73fdc1904e5eb4efc22169e268d955c1e7efb2b2',
  TaskDetailCompact: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
};
for (const name of files) {
  test(`${name}: no appended layer, layout/motion change or new important declaration`, () => {
    assert.equal(hash(structure(roots[name])), layoutBaseline[name]);
  });
  test(`${name}: purposeful area and status styling is unchanged`, () => {
    const rules = [];
    roots[name].walkRules(rule => {
      if (/area-badge|area-(?:carruseles|produccion|edicion|historias|planificacion|web|chatbots|carteleria)|warning|danger|error|urgent|approved|\.pending|\.done|\.red\b|\.amber\b|\.green\b|\.blue\b|\.gray\b|production-progress/.test(rule.selector)) rules.push(rule.toString());
    });
    assert.equal(hash(rules), identityBaseline[name]);
  });
}
