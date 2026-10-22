import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

// CSS AST contracts only: selectors, declarations, media boundaries and source
// ordering. Not a general cascade engine, computed layout or physical iOS QA.
const roots = Object.fromEntries(['Projects', 'Productions'].map(name => [name,
  postcss.parse(readFileSync(new URL(`../pages/${name}.css`, import.meta.url), 'utf8'))]));
const scopes = { Projects: '.projects-page', Productions: '.productions-page' };
const selectors = rule => postcss.list.comma(rule.selector).map(value => value.trim());
const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
function matching(name, selector, parentType) {
  const rules = [];
  roots[name].walkRules(rule => {
    if (selectors(rule).includes(selector) && (!parentType || rule.parent.type === parentType)) rules.push(rule);
  });
  return rules;
}
function singleBase(name, selector, property) {
  const rules = matching(name, selector, 'root').filter(rule => property in declarations(rule));
  assert.equal(rules.length, 1, `${name}: one base ${property} for ${selector}`);
  return rules[0];
}
function mobileRule(name, selector, property, value) {
  const rules = matching(name, selector).filter(rule => rule.parent.type === 'atrule'
    && rule.parent.name === 'media' && rule.parent.params.replaceAll(' ', '') === '(max-width:1024px)'
    && declarations(rule)[property] === value);
  assert.equal(rules.length, 1, `${name}: ${property}:${value} at the inclusive 1024px breakpoint`);
  return rules[0];
}

for (const name of ['Projects', 'Productions']) {
  test(`${name}: text inputs and textarea override inherited 12px labels with explicit desktop 14px`, () => {
    const scope = scopes[name];
    const label = singleBase(name, `${scope} label:where(:not(.render-filter-field))`, 'font-size');
    assert.equal(declarations(label)['font-size'], '12px', 'Caption labels remain intentionally smaller');
    for (const selector of [`${scope} input:not([type=checkbox]):not([type=radio])`, `${scope} textarea`]) {
      const explicit = singleBase(name, selector, 'font-size');
      assert.equal(declarations(explicit)['font-size'], '14px');
      assert.equal(explicit.nodes.find(node => node.prop === 'font-size').important, undefined);
      const inherited = matching(name, selector.endsWith('textarea') ? `${scope} textarea` : `${scope} input`, 'root')
        .filter(rule => declarations(rule).font === 'inherit');
      assert.equal(inherited.length, 1);
      assert.ok(explicit.source.start.offset > inherited[0].source.start.offset, 'Explicit text size follows the font reset');
    }
    assert.equal(matching(name, `${scope} label:not(.render-filter-field)`, 'root').length, 0, 'Do not restore the specificity regression');
  });

  test(`${name}: text sizing owns inclusive tablet/mobile 16px, with 44px input targets and no checkbox/radio enlargement`, () => {
    const scope = scopes[name], input = `${scope} input:not([type=checkbox]):not([type=radio])`;
    const inputRule = mobileRule(name, input, 'font-size', '16px');
    const textareaRule = mobileRule(name, `${scope} textarea`, 'font-size', '16px');
    mobileRule(name, input, 'min-height', '44px');
    for (const width of [320, 390, 640, 680, 681, 760, 768, 980, 1000, 1023, 1024, 1025, 1280]) {
      // Evaluate ONLY the pinned media condition, not browser selector matching.
      for (const rule of [inputRule, textareaRule]) {
        const limit = Number(/^\(max-width:(\d+)px\)$/.exec(rule.parent.params.replaceAll(' ', ''))[1]);
        assert.equal(width <= limit ? declarations(rule)['font-size'] : '14px', width <= 1024 ? '16px' : '14px');
      }
    }
    for (const rule of [inputRule, textareaRule]) {
      assert.ok(selectors(rule).every(selector => selector === input || selector === `${scope} textarea`),
        'Text sizing does not target buttons, labels, selects, checkbox or radio');
    }
  });
}

test('zero-specificity :where exclusion lets existing member/participant flex rows win without important', () => {
  const cases = [
    ['Projects', '.pr-members label', '13px', 'tie'],
    ['Projects', '.projects-page .pr-checkbox', '13px', 'higher'],
    ['Productions', '.prod-participants label', '14px', 'tie'],
  ];
  for (const [name, selector, size, relation] of cases) {
    const base = singleBase(name, `${scopes[name]} label:where(:not(.render-filter-field))`, 'display');
    assert.equal(declarations(base).display, 'grid');
    const row = singleBase(name, selector, 'display');
    const values = declarations(row);
    assert.equal(values.display, 'flex'); assert.equal(values['align-items'], 'center');
    assert.equal(values['font-size'], size); assert.ok(parseFloat(values['min-height']) >= 44);
    assert.ok(!row.nodes.some(node => node.type === 'decl' && node.important));
    // Pinned selectors provide the proof without inventing a CSS parser:
    // base = one class + label = (0,1,1); :where(...) contributes ZERO.
    // member/participant = one class + label = (0,1,1), later wins.
    // checkbox = two classes = (0,2,0), wins regardless of label type count.
    if (relation === 'tie') {
      assert.match(selector, /^\.[a-z-]+ label$/);
      assert.ok(row.source.start.offset > base.source.start.offset, 'Equal specificity retains later flex row');
    } else assert.equal(selector, '.projects-page .pr-checkbox');
  }
});

test('shared FilterSelect typography remains excluded from route presentation, including focus rules', () => {
  const typography = /^(?:font(?:-.+)?|line-height|color|background(?:-.+)?|border(?:-.+)?|padding(?:-.+)?|outline(?:-.+)?)$/;
  for (const name of ['Projects', 'Productions']) {
    roots[name].walkRules(rule => {
      if (!rule.nodes.some(node => node.type === 'decl' && typography.test(node.prop))) return;
      for (const selector of selectors(rule)) {
        if (/(?:^|[\s>+~,(])select(?=$|[\s.#[:>+~,)])/.test(selector) || selector.includes(':focus-visible')) {
          assert.ok(selector.includes(':not(.render-filter-select)'), `${name}: ${selector} must not override shared select presentation`);
        }
      }
    });
    const caption = singleBase(name, `${scopes[name]} label:where(:not(.render-filter-field))`, 'font-size');
    assert.equal(declarations(caption)['font-size'], '12px');
  }
  const shared = postcss.parse(readFileSync(new URL('./FilterSelect.css', import.meta.url), 'utf8'));
  let desktop, mobile;
  shared.walkRules(rule => {
    if (rule.selector !== 'select.render-filter-select') return;
    if (rule.parent.type === 'root') desktop = declarations(rule);
    if (rule.parent.type === 'atrule' && rule.parent.params.replaceAll(' ', '') === '(max-width:1024px)') mobile = declarations(rule);
  });
  assert.equal(desktop['font-size'], '14px'); assert.equal(desktop['min-height'], '44px');
  assert.equal(mobile['font-size'], '16px');
});
