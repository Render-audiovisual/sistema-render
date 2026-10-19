import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./Feedback.css', import.meta.url), 'utf8');
const rule = (selector) => {
  const block = css.split('}').find((entry) => entry.trim().startsWith(`${selector}{`));
  assert.ok(block, `Missing ${selector}`);
  return block.trim().slice(selector.length + 1);
};

test('feedback uses shared palette and system-font foundation without a theme layer', () => {
  const root = rule('.render-feedback');
  for (const token of ['ink', 'muted', 'line', 'surface-soft', 'surface', 'font']) {
    assert.ok(root.includes(`var(--render-${token})`), token);
  }
  assert.doesNotMatch(css, /@import|@font-face|Poppins|SF Pro Display|--rf-lime|#b5fc00|#c4ff2d|!important/);
  assert.equal(css.split('.render-feedback .rf-primary{').length - 1, 1);
  assert.equal(css.split('.render-feedback .rf-primary:hover{').length - 1, 1);
});

test('primary action uses shared action ink and quiet hover/focus tokens', () => {
  const primary = rule('.render-feedback .rf-primary');
  assert.match(primary, /background:var\(--rf-primary\)/);
  assert.match(primary, /border-color:var\(--rf-primary\)/);
  assert.match(primary, /color:var\(--render-accent-ink\)/);
  assert.match(rule('.render-feedback'), /--rf-primary:var\(--render-accent\)/);
  const hover = rule('.render-feedback .rf-primary:hover');
  assert.match(hover, /background:var\(--render-accent-hover\)/);
  assert.match(hover, /border-color:var\(--render-accent-hover\)/);
  assert.match(rule('.render-feedback :is(button,input,select,textarea,a):focus-visible'), /outline:2px solid var\(--render-accent\)/);
  assert.match(rule('.rf-fields .rf-people label.selected'), /background:var\(--render-accent-soft, #edf4ff\)/);
});

test('status colors, responsive controls, motion support and sticky footer remain', () => {
  assert.match(rule('.rf-status'), /background:#fff2ce;.*color:#825e12/);
  assert.match(rule('.rf-status.is-resolved'), /background:#e4f5e8;color:#26713e/);
  assert.match(rule('.rf-error'), /background:#fff0ed;color:#8b3322/);
  assert.match(rule('.rf-conflict'), /background:#fff0ed;.*color:#8b3322/);
  assert.match(rule('.rf-message'), /background:#f0f7e6;color:#405b24/);
  assert.match(rule('.rf-duplicates'), /background:#fff8e5;border:1px solid #ead7a1/);
  for (const width of [1050, 980, 720, 560, 480, 420]) assert.ok(css.includes(`@media(max-width:${width}px)`));
  assert.match(css, /\.rf-detail-actions,\.rf-form-actions\{[^}]*bottom:0;[^}]*position:sticky;/);
  assert.match(css, /\.rf-detail-actions button,\.rf-form-actions button\{min-height:48px;width:100%\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
