import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

// Source/token contracts, not a browser cascade, screenshot or native UI test.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = postcss.parse(read('./QuickHome.css'));
const shared = postcss.parse(read('../design-system.css'));
function declarations(root, selector, media = null) {
  const values = new Map();
  root.walkRules(rule => {
    if (!postcss.list.comma(rule.selector).includes(selector)) return;
    if (media === null ? rule.parent.type !== 'root' : rule.parent.type !== 'atrule'
      || rule.parent.name !== 'media' || rule.parent.params.replace(/\s/g, '') !== media) return;
    for (const node of rule.nodes) if (node.type === 'decl') values.set(node.prop, node.value);
  });
  return values;
}
const page = declarations(home, '.quick-home');
const tokens = new Map([...declarations(shared, ':root'), ...page]);
function resolve(value, seen = new Set()) {
  assert.equal(typeof value, 'string', 'A declared token value is required');
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(!seen.has(name), `Circular token ${name}`);
    assert.ok(tokens.has(name), `Missing token ${name}`);
    return resolve(tokens.get(name), new Set([...seen, name]));
  });
}
function luminance(color) {
  if (/^#[\da-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map(c => c + c).join('');
  assert.match(color, /^#[\da-f]{6}$/i, 'Resolve actual opaque six-digit color tokens');
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);

test('Home aliases shared surface, line, text, muted and accent tokens without a private palette', () => {
  for (const [local, global] of Object.entries({ bg: 'surface', soft: 'surface-soft', line: 'line',
    text: 'ink', muted: 'muted', blue: 'accent' })) {
    assert.equal(page.get(`--qh-${local}`), `var(--render-${global})`, `--qh-${local}`);
  }
});

test('Home uses shared font/canvas, explicit card surface and shared control/card radii', () => {
  assert.equal(page.get('background'), 'var(--render-canvas)');
  assert.ok(page.get('font')?.includes('var(--render-font)')
    || page.get('font-family') === 'var(--render-font)', 'Use the shared font family');
  assert.equal(declarations(home, '.qh-section').get('background'), 'var(--qh-bg)');
  assert.equal(declarations(home, '.quick-home button').get('border-radius'), 'var(--render-radius-control)');
  for (const selector of ['.qh-section', '.qh-summary', '.qh-status', '.qh-error'])
    assert.equal(declarations(home, selector).get('border-radius'), 'var(--render-radius-card)', selector);
});

test('both overdue presentations use the shared danger token', () => {
  for (const selector of ['.qh-summary .is-overdue dd', '.qh-deadline.is-overdue'])
    assert.equal(declarations(home, selector).get('color'), 'var(--render-danger)', selector);
});

test('resolved actual Home text, muted, accent and danger colors meet AA on surface and soft surface', () => {
  for (const foreground of ['--qh-text', '--qh-muted', '--qh-blue', '--render-danger']) {
    for (const background of ['--qh-bg', '--qh-soft']) {
      const ratio = contrast(luminance(resolve(`var(${foreground})`)), luminance(resolve(`var(${background})`)));
      assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(3)} < 4.5`);
    }
  }
});

test('token adoption preserves actionable target sizes, responsive layout and reduced motion', () => {
  for (const selector of ['.quick-home button', '.qh-monthly-production summary', '.qh-piece-detail summary',
    '.quick-home .qh-section-link', '.qh-shortcuts a'])
    assert.equal(declarations(home, selector).get('min-height'), '44px', selector);
  assert.equal(declarations(home, '.quick-home .qh-task-row').get('min-height'), '76px');
  assert.equal(declarations(home, '.quick-home .qh-compact-row').get('min-height'), '64px');
  assert.equal(declarations(home, '.qh-columns').get('grid-template-columns'), 'minmax(0,1.7fr) minmax(280px,1fr)');
  assert.equal(declarations(home, '.qh-columns', '(max-width:760px)').get('grid-template-columns'), 'minmax(0,1fr)');
  assert.equal(declarations(home, '.quick-home .qh-task-row', '(max-width:440px)').get('padding'), '12px 16px');
  assert.equal(declarations(home, '.quick-home *', '(prefers-reduced-motion:reduce)').get('transition'), 'none');
});

test('focus on rows and section links is inset so overflow-hidden cards cannot clip the outline', () => {
  assert.equal(declarations(home, '.qh-section').get('overflow'), 'hidden');
  const focus = declarations(home, '.quick-home :is(.qh-task-row,.qh-compact-row,.qh-section-link):focus-visible');
  assert.equal(focus.get('outline-offset'), '-3px');
});
