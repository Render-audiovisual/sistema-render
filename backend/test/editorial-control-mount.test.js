import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('principal editorial control mounts once after current-session authentication', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  // Source wiring check only. Actual authentication is independently exercised
  // by the opted-in principal HTTP/PostgreSQL suite.
  const mounts = [...source.matchAll(/^router\.use\('\/editorial-control', createEditorialControlRouter\(\{ express, pool \}\)\);$/gm)];
  assert.equal(mounts.length, 1);
  const auth = source.indexOf('router.use(createPrincipalAuthentication({ browserTransport: browserSessions, pool }));');
  assert.ok(auth >= 0 && mounts[0].index > auth);
  assert.match(source, /import \{ createEditorialControlRouter \} from "\.\/editorial-control.js";/);
});
