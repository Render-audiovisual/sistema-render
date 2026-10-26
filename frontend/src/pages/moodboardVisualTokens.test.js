import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

// Pure CSS source and resolved-token contracts; not native/computed-browser QA.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = postcss.parse(read('./MoodboardPreview.css'));
const design = postcss.parse(read('../design-system.css'));
function decls(root, selector, media = null) {
  const values = new Map();
  root.walkRules(rule => {
    if (!postcss.list.comma(rule.selector).includes(selector)) return;
    if (media === null ? rule.parent.type !== 'root' : rule.parent.type !== 'atrule'
      || rule.parent.name !== 'media' || rule.parent.params.replace(/\s/g, '') !== media) return;
    for (const node of rule.nodes) if (node.type === 'decl') values.set(node.prop, node.value);
  });
  return values;
}
const base = selector => decls(css, selector);
const tokens = decls(design, ':root');
function color(value, seen = new Set()) {
  const match = /^var\((--[\w-]+)\)$/.exec(value || '');
  if (match) {
    assert.ok(!seen.has(match[1]), 'No circular palette');
    assert.ok(tokens.has(match[1]), `Shared token ${match[1]} exists`);
    return color(tokens.get(match[1]), new Set([...seen, match[1]]));
  }
  assert.match(value || '', /^#[\da-f]{6}$/i, 'Resolve actual opaque shared color');
  return value;
}
function luminance(value) {
  const hex = color(value);
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}

test('Moodboard root adopts shared canvas, ink, font and sidebar geometry without Poppins/neon', () => {
  const root = base('.moodboard-preview-shell');
  assert.equal(root.get('background'), 'var(--render-canvas)');
  assert.equal(root.get('color'), 'var(--render-ink)');
  assert.equal(root.get('font-family'), 'var(--render-font)');
  assert.equal(root.get('margin-left'), 'var(--render-sidebar-width,236px)');
  assert.equal(root.get('width'), 'calc(100% - var(--render-sidebar-width,236px))');
  css.walkDecls(d => assert.doesNotMatch(d.value, /Poppins|#(?:b5fc00|c4ff30|9cda00|7ea900|7da900|89b900|719300|668c00)\b/i));
});

test('primary CTA uses shared accent states without raised shadow or movement', () => {
  const button = base('.moodboard-add-primary');
  assert.equal(button.get('background'), 'var(--render-accent)');
  assert.equal(button.get('color'), 'var(--render-accent-ink)');
  assert.equal(button.get('border'), '1px solid var(--render-accent)');
  assert.equal(base('.moodboard-add-primary:hover').get('background'), 'var(--render-accent-hover)');
  for (const selector of ['.moodboard-add-primary', '.moodboard-add-primary:hover', '.moodboard-add-primary:active']) {
    const declarations = base(selector);
    for (const property of ['box-shadow', 'transform'])
      assert.ok(!declarations.has(property) || declarations.get(property) === 'none', `${selector} ${property}`);
  }
});

test('status counters use shared muted text on actual muted surface with AA contrast', () => {
  const foreground = base('.moodboard-status-tabs b').get('color');
  const background = base('.moodboard-status-tabs').get('background');
  assert.equal(foreground, 'var(--render-muted)');
  assert.equal(background, 'var(--render-surface-muted)');
  const a = luminance(foreground), b = luminance(background);
  const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  assert.ok(ratio >= 4.5, `Counter contrast ${ratio.toFixed(3)}`);
});

test('brand navigation keyboard focus stays inside its clipping rail', () => {
  const focus = base('.moodboard-brand-rail nav button:focus-visible');
  assert.equal(focus.get('outline'), '2px solid var(--render-accent)');
  assert.equal(focus.get('outline-offset'), '-2px');
});

test('mobile editable controls use 16px text and fields retain 44px minimum targets', () => {
  for (const selector of ['.moodboard-field :is(input,select,textarea)', '.moodboard-search input',
    '.moodboard-category-list input', '.moodboard-category-add input', '.moodboard-category-filter select'])
    assert.equal(decls(css, selector, '(max-width:980px)').get('font-size'), '16px', selector);
  for (const selector of ['.moodboard-field input', '.moodboard-field select'])
    assert.equal(base(selector).get('min-height'), '44px', selector);
});

test('native overlay viewport, gallery columns and mobile rail geometry are preserved', () => {
  for (const selector of ['.modal-overlay.render-native-dialog.moodboard-compose-layer',
    '.modal-overlay.render-native-dialog.moodboard-panel-layer'])
    assert.equal(base(selector).get('inset'), '0');
  assert.equal(base('.moodboard-masonry').get('columns'), '4 235px');
  assert.equal(decls(css, '.moodboard-masonry', '(max-width:980px)').get('columns'), '2 160px');
  assert.equal(decls(css, '.moodboard-masonry', '(max-width:560px)').get('columns'), '1');
  const mobile = decls(css, '.moodboard-preview-shell', '(max-width:980px)');
  assert.equal(mobile.get('margin-left'), '0');
  assert.equal(mobile.get('width'), '100%');
  assert.equal(mobile.get('grid-template-columns'), 'minmax(0,1fr)');
  assert.equal(decls(css, '.moodboard-brand-rail nav', '(max-width:980px)').get('overflow-x'), 'auto');
});
