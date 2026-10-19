import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pure source contracts only; computed contrast and drawer behavior need browser QA.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const sidebar = read('./Sidebar.css');
const projects = read('../pages/Projects.css');
const productions = read('../pages/Productions.css');
const calendar = read('../pages/Calendar.css');
const sheets = [sidebar, projects, productions, calendar];

test('operational modules inherit shared font and two-pixel keyboard focus', () => {
  for (const css of sheets) {
    assert.match(css, /var\(--render-font\)/);
    assert.match(css, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--render-accent\)/);
    assert.doesNotMatch(css, /@import|fonts\.googleapis|font-family:\s*-apple-system/);
  }
});

test('local project and production palette aliases resolve to shared semantics', () => {
  for (const [css, prefix, action] of [[projects, 'pr', 'blue'], [productions, 'prod', 'accent']]) {
    for (const [local, shared] of Object.entries({ bg: 'surface', soft: 'surface-soft', line: 'line', text: 'ink', muted: 'muted', [action]: 'accent' })) {
      assert.ok(css.includes(`--${prefix}-${local}:var(--render-${shared})`));
    }
    assert.ok(css.includes(`.${prefix}-primary{background:var(--${prefix}-${action});border-color:var(--${prefix}-${action});color:var(--render-accent-ink)`));
    assert.match(css, /primary:hover:not\(:disabled\)\{background:var\(--render-accent-hover\)/);
  }
});

test('navigation and calendar use shared surface, selection and line tokens', () => {
  assert.match(sidebar, /\.sidebar\s*\{\s*background: var\(--render-sidebar\)/);
  assert.match(sidebar, /\.sidebar-link\.active\s*\{\s*background: var\(--render-sidebar-raised\)/);
  assert.match(sidebar, /\.account-menu-panel \{ background: var\(--render-surface\)/);
  for (const token of ['surface', 'ink', 'muted', 'line', 'sidebar-raised', 'accent']) {
    assert.ok(calendar.includes(`var(--render-${token})`));
  }
  assert.doesNotMatch(sidebar, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(calendar, /#[\da-f]{3,8}\b/i);
});

test('status and error palettes are preserved independently of action aliases', () => {
  assert.ok(projects.includes('.pr-stage-dot.is-en_progreso{border-color:#0071e3;background:#edf5ff}'));
  assert.ok(projects.includes('.pr-stage-dot.is-completada{border-color:#0071e3;background:#0071e3}'));
  assert.ok(projects.includes('.pr-error{background:#fff6f2;border-color:#ecd9cd;color:#813716}'));
  assert.ok(productions.includes('.prod-status.is-grabado,.prod-status.is-realizada{background:#e8f3ec;color:#216340}'));
  assert.ok(productions.includes('.prod-status.is-repetir{background:#fff0e2;color:#8b4915}'));
  assert.ok(productions.includes('.prod-error{background:#fff1f0;color:#9c2525;border:1px solid #f2cccc}'));
});

test('responsive geometry, mobile targets and reduced motion remain present', () => {
  for (const css of [projects, productions, calendar]) {
    assert.ok(css.includes('width:calc(100% - var(--render-sidebar-width,236px))'));
    assert.match(css, /max-width:980px/);
    assert.match(css, /min-height:44px/);
  }
  assert.match(sidebar, /data-collapsed="true"\] \{ padding-inline: 10px; width: 72px/);
  assert.match(sidebar, /\.sidebar \.sidebar-link \{ min-height: 44px; \}/);
  for (const css of [sidebar, projects, productions]) assert.match(css, /prefers-reduced-motion/);
});
