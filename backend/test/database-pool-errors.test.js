import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { buildDatabasePoolConfig } from '../src/database-transport.js';

// Evaluate the actual module body with only AuthorityBoundPool and console replaced.
// The real transport validator runs; no real Pool, socket or DB is created.
const source = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const imports = [
  "import { AuthorityBoundPool as Pool } from './database-authority-context.js';",
  "import { buildDatabasePoolConfig } from './database-transport.js';",
  "export { isLoopbackDatabaseUrl } from './database-transport.js';",
];
let body = source;
for (const statement of imports) {
  assert.equal(body.split(statement).length, 2, `Expected one module dependency: ${statement}`);
  body = body.replace(statement, '');
}
body = body.replace('export const pool', 'const pool')
  .replace('export async function checkDatabaseConnection', 'async function checkDatabaseConnection');
const instantiate = new Function('Pool', 'buildDatabasePoolConfig', 'process', 'console',
  `${body}\nreturn {pool,checkDatabaseConnection};`);

function fixture(env = { DATABASE_URL: 'postgresql://qa:synthetic@db.example.invalid/qa' }) {
  const constructed = [], logs = [], calls = [];
  class Pool extends EventEmitter {
    constructor(config) { super(); this.config = config; constructed.push(this); }
    query(...args) { calls.push(['query', ...args]); return Promise.resolve({ rows: [{ ok: 1 }] }); }
    connect() { calls.push(['connect']); throw Error('No connection allowed in this test'); }
    end() { calls.push(['end']); return Promise.resolve(); }
  }
  const api = instantiate(Pool, buildDatabasePoolConfig, { env }, {
    error: (...args) => logs.push(args),
  });
  return { ...api, constructed, logs, calls };
}

test('configured pool retains one idle-error listener without eager DB operations', () => {
  const f = fixture();
  assert.equal(f.constructed.length, 1);
  assert.equal(f.pool.listenerCount('error'), 1);
  assert.deepEqual(f.calls, []);
});

test('idle error is handled with a generic diagnostic and no reconnect/write retries', () => {
  const f = fixture();
  const error = Object.assign(new Error('postgresql://private:SECRET@host/db'), {
    code: 'SECRET_CODE', detail: 'PRIVATE_SQL', stack: 'SECRET_STACK',
  });
  assert.doesNotThrow(() => f.pool.emit('error', error, { password: 'PRIVATE_CLIENT' }));
  assert.deepEqual(f.logs, [['PostgreSQL: conexión ociosa interrumpida.']]);
  assert.deepEqual(f.calls, []);
  assert.equal(f.constructed.length, 1);
});

test('handler never reads untrusted error properties, even on repeated idle failures', () => {
  const f = fixture();
  const error = new Proxy({}, { get() { throw Error('Error fields must not be inspected'); } });
  assert.doesNotThrow(() => { f.pool.emit('error', error); f.pool.emit('error', error); });
  assert.equal(f.logs.length, 2);
  assert.deepEqual(f.calls, []);
});

test('actual transport config retains TLS verification and explicit target', () => {
  const f = fixture();
  assert.equal(f.pool.config.host, 'db.example.invalid');
  assert.equal(f.pool.config.ssl.rejectUnauthorized, true);
  assert.equal(f.pool.config.ssl.minVersion, 'TLSv1.2');
  assert.equal(Object.hasOwn(f.pool.config, 'connectionString'), false);
  assert.deepEqual(f.calls, []);
});

test('unconfigured module remains frozen/inert and ignores inherited PG targets', async () => {
  const f = fixture({ PGHOST: 'unapproved.invalid', PGPASSWORD: 'NEVER_USE' });
  assert.equal(f.constructed.length, 0);
  assert.equal(Object.isFrozen(f.pool), true);
  await assert.rejects(f.pool.query('SELECT 1'), { code: 'RENDER_DB_NOT_CONFIGURED' });
  await assert.rejects(f.pool.connect(), { code: 'RENDER_DB_NOT_CONFIGURED' });
  await f.pool.end();
  assert.deepEqual(f.logs, []);
  assert.deepEqual(f.calls, []);
});

test('invalid transport fails before constructing a pool, never bypassing target guards', () => {
  assert.throws(() => fixture({ DATABASE_URL: 'postgresql://qa@db.example.invalid/qa?sslmode=disable' }), /transporte PostgreSQL/);
});

test('connection check still performs only its explicit SELECT and propagates query failures', async () => {
  const f = fixture();
  assert.equal(await f.checkDatabaseConnection(), true);
  assert.deepEqual(f.calls, [['query', 'SELECT 1 AS ok']]);
  const failure = new Error('Synthetic query failure');
  f.pool.query = async () => { throw failure; };
  await assert.rejects(f.checkDatabaseConnection(), error => error === failure);
  assert.deepEqual(f.logs, []);
});
