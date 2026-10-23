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
const groupLabelSelector = '.render-workspace .ros-project-card>header small,.render-workspace .ros-project-card button>b,.render-workspace .ros-project-card button small';
const reviewQueueSelectors = new Set([
  '.render-workspace .ros-review-queue',
  '.render-workspace .ros-review-queue > strong, .render-workspace .ros-review-queue > p',
  '.render-workspace .ros-review-queue > p',
  '.render-workspace .ros-review-queue button',
  '.render-workspace .ros-review-queue button:focus-visible',
]);
test('review queue adds only its reviewed scoped wrapping, touch and focus rules', () => {
  const rules = [];
  roots.TaskHeader.walkRules(rule => {
    if (!rule.selector.includes('.ros-review-queue')) return;
    assert.ok(reviewQueueSelectors.has(normalize(rule.selector)), 'No broad selector may borrow this component exception');
    rules.push([normalize(rule.selector), rule.nodes.map(node => [node.prop, node.value, !!node.important])]);
  });
  assert.equal(rules.length, 5);
  assert.equal(hash(rules), '9ca97bf413ce9c7cdbe6287752d0fcb9b1e6578824568631e63cb5039d82a2cd');
  assert.equal(last('TaskHeader', '.render-workspace .ros-review-queue', 'flex-wrap'), 'wrap');
  assert.equal(last('TaskHeader', '.render-workspace .ros-review-queue button', 'min-height'), '44px');
  assert.equal(last('TaskHeader', '.render-workspace .ros-review-queue button:focus-visible', 'outline'), `2px solid ${token('accent')}`);
});
test('group counts and task states use the existing readable label token, not legacy 6px text', () => {
  assert.deepEqual(values('WorkspaceReadOnly', groupLabelSelector, 'font-size'), ['var(--ros-type-label)']);
});
function structure(node) {
  if (node.type === 'comment') return null;
  // Integration106 adds a separately fingerprinted component, not a rewrite
  // of the existing header. Keep the original migration baseline intact.
  if (node.type === 'rule' && reviewQueueSelectors.has(normalize(node.selector))) return null;
  // New recorded-context component styles have their own integration guards;
  // retain the exact migration baseline for every preexisting task rule.
  if (node.type === 'rule' && [
    '.render-workspace .ros-recorded-context dl', '.render-workspace .ros-recorded-context dl>div',
    '.render-workspace .ros-recorded-context dt', '.render-workspace .ros-recorded-context dd',
    '.render-workspace .ros-recorded-context p', '.render-workspace .ros-recorded-context a',
  ].includes(node.selector)) return null;
  if (node.type === 'decl') return [node.prop, !!node.important, paint.test(node.prop) ? null : node.value];
  // Integration91 extends this one existing font rule to two legacy 6px labels.
  // Pin that exact expansion above; keep every other migration invariant intact.
  const selector = node.type === 'rule' && node.selector === groupLabelSelector
    ? '.render-workspace .ros-project-card button small' : node.selector || node.name;
  return [node.type, selector, node.params, ...(node.nodes || []).map(structure).filter(Boolean)];
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const layoutBaseline = {
  WorkspaceReadOnly: 'cd36062210cde1ccd6a7f94280b514a620d5256cdbad66bee5bef3aeb5dcf11d',
  RenderApplePolish: 'edd06507a2c251e039c9e8c6ded93140f4fee376a1126c4f8146d00967e47f41',
  // Integration99: approved scoped order toolbar/actions in the existing layer.
  TaskHeader: '0570349431a2fafdcd47c0f0507d606f0c14479ea8f9001a0d0dfa8e4cb56a6e',
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
// Integration142: normalize only the seven migrated native controls. Apply the
// same projection to the pre-change HEAD once when recording the literals;
// tests never consult Git. Grouped button/summary branches and label layout stay.
function reviewedFilterPresentationBaseline(root) {
  const copy = root.clone();
  copy.walkRules(rule => {
    // These legacy rules still own non-shared controls, with all declarations
    // pinned. Only the exact shared-control exclusions change their selectors.
    if (normalize(rule.selector) === '.render-workspace .ros-filter-bar label:not(.render-filter-field) > span') {
      rule.selector = '.render-workspace .ros-filter-bar label > span';
    }
    if (normalize(rule.selector) === '.render-workspace .ros-filter-bar :is(select:not(.render-filter-select), button)') {
      rule.selector = '.render-workspace .ros-filter-bar :is(select, button)';
    }
    const selectors = rule.selectors.map(normalize);
    const retained = selectors.filter(selector => ![
      '.ros-filter-bar label>span',
      '.render-workspace .ros-filter-bar label>span',
      '.render-workspace .ros-filter-bar label > span',
      '.ros-filter-bar select',
      '.render-workspace .ros-filter-bar select',
      '.render-workspace .ros-filter-bar select:focus',
    ].includes(selector));
    if (retained.length !== selectors.length) {
      const presentation = new Set(['background', 'background-color', 'border', 'border-color', 'border-radius', 'color',
        'font-size', 'font-weight', 'padding', 'width', 'min-height', 'margin-bottom', 'letter-spacing', 'text-transform', 'box-shadow', 'outline']);
      rule.walkDecls(declaration => {
        assert.ok(presentation.has(declaration.prop), `Unexpected migrated control property: ${declaration.prop}`);
        assert.equal(!!declaration.important, false, 'Migrated controls cannot add important');
      });
    }
    if (!retained.length) { rule.remove(); return; }
    rule.selector = retained.join(',');
    if (retained.length === 1 && ['.ros-filter-bar label', '.render-workspace .ros-filter-bar label'].includes(retained[0])) {
      rule.walkDecls('gap', declaration => declaration.remove());
      if (!rule.nodes.some(node => node.type !== 'comment')) { rule.remove(); return; }
    }
    if (normalize(rule.selector) === '.render-workspace .ros-order-toolbar select') {
      const presentation = new Set(['min-height', 'padding', 'border', 'border-radius', 'background', 'color', 'font']);
      rule.walkDecls(declaration => { if (presentation.has(declaration.prop)) declaration.remove(); });
    }
    rule.selector = rule.selector.replace(':is(select:not(.render-filter-select), summary)', ':is(select, summary)');
    if (rule.selector === '.render-workspace :is(button, input, select:not(.render-filter-select), textarea, [role="button"]):focus-visible') {
      rule.selector = '.render-workspace :is(button, input, select, textarea, [role="button"]):focus-visible';
    }
  });
  return copy;
}
test('Integration142 exceptions retain unrelated layout and exact shared-select focus exclusion', () => {
  const selector = '.render-workspace :is(button, input, select:not(.render-filter-select), textarea, [role="button"]):focus-visible';
  assert.equal(last('RenderApplePolish', selector, 'outline'), `2px solid ${token('accent')}`);
  assert.equal(last('RenderApplePolish', '.render-workspace .ros-filter-bar label:not(.render-filter-field) > span', 'font-size'), '9px');
  assert.equal(last('RenderApplePolish', '.render-workspace .ros-filter-bar :is(select:not(.render-filter-select), button)', 'min-height'), '40px');
  const before = postcss.parse('.render-workspace .ros-filter-bar select,.render-workspace .ros-filter-bar button{min-height:36px}.render-workspace .ros-filter-bar label{gap:5px;min-width:0}');
  const after = reviewedFilterPresentationBaseline(before);
  assert.equal(after.nodes[0].selector, '.render-workspace .ros-filter-bar button');
  assert.equal(after.nodes[0].first.value, '36px');
  assert.deepEqual(after.nodes[1].nodes.map(node => [node.prop,node.value]), [['min-width','0']]);
  const changed = after.clone(); changed.nodes[1].first.value = '1px';
  assert.notEqual(hash(structure(after)), hash(structure(changed)), 'Label layout remains fingerprinted');
  assert.throws(() => reviewedFilterPresentationBaseline(postcss.parse('.ros-filter-bar select{position:fixed}')), /Unexpected migrated control property/);
  assert.throws(() => reviewedFilterPresentationBaseline(postcss.parse('.ros-filter-bar select{font-size:16px!important}')), /cannot add important/);
});
function reviewedTabletStateBaseline(root) {
  const copy = root.clone(), matches = [];
  copy.walkRules(rule => {
    if (normalize(rule.selector) === '.render-workspace .ros-mobile-state'
      && rule.parent.type === 'atrule' && rule.parent.name === 'media'
      && rule.parent.params.replace(/\s/g, '') === '(max-width:1024px)') matches.push(rule);
  });
  assert.equal(matches.length, 1, 'Exactly one reviewed compact-board fallback');
  const rule = matches[0];
  assert.equal(rule.parent.parent.type, 'root', 'No additional conditional wrapper');
  assert.deepEqual(rule.nodes.map(node => [node.type, node.prop, node.value, !!node.important]), [
    ['decl', 'background', token('surface-soft'), false],
    ['decl', 'border', `1px solid ${token('line')}`, false],
    ['decl', 'border-radius', '9px', false],
    ['decl', 'color', token('ink-soft'), false],
    ['decl', 'display', 'block', false],
    ['decl', 'font-family', 'inherit', false],
    ['decl', 'font-size', '16px', false],
    ['decl', 'margin-top', '9px', false],
    ['decl', 'min-height', '44px', false],
    ['decl', 'padding', '9px 11px', false],
    ['decl', 'width', '100%', false],
  ], 'Only the exact reviewed Integration125 declarations may leave the legacy fingerprint');
  // Remove only this validated node, retaining its media wrapper and every
  // other layout/motion/important declaration under the original baseline.
  rule.remove();
  return copy;
}
// Integration162 adds real opening/continuation controls to the existing layer.
// Pin every declaration of just these eight rules, then retain the original
// fingerprint of all preexisting layout/motion rules rather than replacing it.
function reviewedTaskContinuationBaseline(root) {
  const copy=root.clone(),records=[];
  const open='.render-workspace .ros-board .ros-task-card .ros-card-open';
  const more='.render-workspace :is(.ros-column-limit, .ros-list-limit)';
  const selectors=new Set([open,`${open}:hover`,`${open}:focus-visible`,more,`${more} p`,`${more} button`,`${more} button:focus-visible`]);
  copy.walkRules(rule=>{
    if(!selectors.has(normalize(rule.selector)))return;
    records.push([normalize(rule.selector),rule.parent.type==='atrule'?rule.parent.params:null,
      rule.nodes.map(node=>[node.type,node.prop,node.value,!!node.important])]);
    rule.remove();
  });
  assert.equal(records.length,8,'Only the eight reviewed functional-control rules');
  assert.equal(hash(records),'25b7e1d5e6aeaf3d40f233c57f9811d30e69b7a18cbe27b64d5063d3f735bd14');
  return copy;
}
for (const name of files) {
  test(`${name}: no appended layer, layout/motion change or new important declaration`, () => {
    let baselineRoot = name === 'WorkspaceReadOnly' ? reviewedTabletStateBaseline(roots[name]) : roots[name];
    if(name==='TaskHeader')baselineRoot=reviewedTaskContinuationBaseline(baselineRoot);
    if (['WorkspaceReadOnly', 'TaskHeader', 'RenderApplePolish'].includes(name)) baselineRoot = reviewedFilterPresentationBaseline(baselineRoot);
    assert.equal(hash(structure(baselineRoot)), layoutBaseline[name]);
  });
  test(`${name}: purposeful area and status styling is unchanged`, () => {
    const rules = [];
    roots[name].walkRules(rule => {
      if (/area-badge|area-(?:carruseles|produccion|edicion|historias|planificacion|web|chatbots|carteleria)|warning|danger|error|urgent|approved|\.pending|\.done|\.red\b|\.amber\b|\.green\b|\.blue\b|\.gray\b|production-progress/.test(rule.selector)) rules.push(rule.toString());
    });
    assert.equal(hash(rules), identityBaseline[name]);
  });
}
