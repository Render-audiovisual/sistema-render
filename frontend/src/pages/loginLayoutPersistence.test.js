import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('login opts out of sidebar width and maximum width', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const login = css.match(/\.login-main\s*\{([^}]+)\}/)[1];
  assert.match(login, /width:\s*100%/);
  assert.match(login, /max-width:\s*none/);
  assert.match(login, /margin-left:\s*0/);
});

test('login exposes stable standard password-manager fields without storing passwords', () => {
  const source = readFileSync(new URL('./Login.jsx', import.meta.url), 'utf8');
  assert.match(source, /<form[^>]+autoComplete="on"/);
  assert.match(source, /id="render-login-username"\s+name="username"/);
  assert.match(source, /id="render-login-password"\s+name="password"/);
  assert.match(source, /autoComplete="username"/);
  assert.match(source, /autoComplete="current-password"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
