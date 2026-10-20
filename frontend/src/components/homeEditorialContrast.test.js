import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const luminance = hex => {
  const channels = hex.match(/[a-f\d]{2}/gi).map(c => Number.parseInt(c, 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
test('selected editorial view uses shared light-theme tokens with normal-text AA contrast', () => {
  const tokens = readFileSync(new URL('../design-system.css', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../pages/QuickHome.css', import.meta.url), 'utf8');
  const color = key => tokens.match(new RegExp(`${key}:\\s*(#[a-f\\d]{6})`, 'i'))?.[1];
  const foreground = color('--render-accent'), background = color('--render-accent-soft');
  assert.ok(foreground && background);
  assert.ok((luminance(background) + 0.05) / (luminance(foreground) + 0.05) >= 4.5);
  assert.match(css, /\[aria-label="Vistas del control editorial"\] button\[aria-pressed="true"\]\{[^}]*color:var\(--render-accent,#0068d4\)/);
});
