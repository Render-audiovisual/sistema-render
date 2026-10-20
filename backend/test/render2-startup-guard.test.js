import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assertFixtureIdentity, cleanEnvironment, fixtureWilsonEnvironment } from '../scripts/render2-local-test.js';

test('fixture integration options cannot override database, startup or secret guards', () => {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV', 'RENDER_DISABLE_SERVER_START', 'privateKey']) {
    assert.throws(() => fixtureWilsonEnvironment({ [key]: 'untrusted' }));
  }
  assert.throws(() => fixtureWilsonEnvironment({ publicKey: null }));
  assert.deepEqual(fixtureWilsonEnvironment({ telegramUserBindings: '{"synthetic":91001}' }),
    { WILSON_TELEGRAM_USER_BINDINGS: '{"synthetic":91001}' });
  assert.deepEqual(fixtureWilsonEnvironment(), {});
});

test('fixture identity rejects remote, reused and mismatched targets before migration', () => {
  const valid = { root: '/private/tmp/render2-local-ABC123', cwd: '/private/tmp/render2-local-ABC123', port: '55594',
    url: 'postgresql://render2_fixture@127.0.0.1:55594/render2_local_test',
    identity: { database: 'render2_local_test', username: 'render2_fixture', address: '127.0.0.1', port: 55594,
      directory: '/private/tmp/render2-local-ABC123/data' } };
  assert.doesNotThrow(() => assertFixtureIdentity(valid));
  for (const changed of [{ root: '/tmp/existing' }, { cwd: '/' }, { port: '5432' },
    { url: 'postgresql://render2_fixture@remote:55594/render2_local_test' },
    { identity: { ...valid.identity, directory: '/existing/data' } },
    { identity: { ...valid.identity, database: 'production' } },
    { identity: { ...valid.identity, username: 'postgres' } }]) {
    assert.throws(() => assertFixtureIdentity({ ...valid, ...changed }));
  }
  assert.equal(cleanEnvironment().DATABASE_URL, undefined);
  assert.equal(cleanEnvironment().JWT_SECRET, undefined);
});

test('principal server disabled import performs no DB, listener, fetch or scheduler work', () => {
  const server = new URL('../src/server.js', import.meta.url).href;
  const script = `
    import net from 'node:net';
    import pg from 'pg';
    const fail = () => { throw new Error('Forbidden startup side effect'); };
    net.Server.prototype.listen = fail;
    net.Socket.prototype.connect = fail;
    pg.Pool.prototype.query = fail;
    pg.Pool.prototype.connect = fail;
    globalThis.setInterval = fail;
    globalThis.setTimeout = fail;
    globalThis.fetch = fail;
    const { app } = await import(${JSON.stringify(server)});
    if (typeof app !== 'function') throw new Error('Missing principal app');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), env: cleanEnvironment(), timeout: 15000, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('legacy goal QA opt-ins fail before touching an existing database', () => {
  for (const file of ['client-goals.integration.test.js', 'client-goal-links.integration.test.js']) {
    const target = new URL(file, import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      import pg from 'pg';
      const fail = () => { throw new Error('Forbidden legacy database side effect'); };
      net.Socket.prototype.connect = fail;
      pg.Pool.prototype.query = fail;
      pg.Pool.prototype.connect = fail;
      process.env.RENDER_GOALS_TEST_DATABASE = 'true';
      await assert.rejects(import(${JSON.stringify(target)}), /Legacy goal QA is quarantined/);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('..', import.meta.url), env: cleanEnvironment(), timeout: 10000, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
});

test('missing frontend entrypoint during a local build cannot trigger startup effects or break API import', () => {
  const server = new URL('../src/server.js', import.meta.url).href;
  for (const code of ['ENOENT','EACCES']) {
    const script = `
      import fs from 'node:fs'; import net from 'node:net'; import pg from 'pg';
      const read=fs.readFileSync;
      fs.readFileSync=function(path,...args){
        if(String(path).endsWith('/frontend/dist/index.html'))throw Object.assign(new Error('Synthetic missing or inaccessible build'),{code:${JSON.stringify(code)}});
        return read.call(this,path,...args);
      };
      const fail=()=>{throw new Error('Forbidden startup side effect');};
      net.Server.prototype.listen=fail;net.Socket.prototype.connect=fail;
      pg.Pool.prototype.query=fail;pg.Pool.prototype.connect=fail;
      globalThis.setInterval=fail;globalThis.setTimeout=fail;globalThis.fetch=fail;
      const {app}=await import(${JSON.stringify(server)});
      if(typeof app!=='function')throw new Error('Missing principal app');
    `;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
      cwd:new URL('..',import.meta.url),env:cleanEnvironment(),timeout:15000,encoding:'utf8',
    });
    if(code==='ENOENT')assert.equal(result.status,0,result.stderr||result.error?.message);
    else {assert.notEqual(result.status,0);assert.match(result.stderr,/Synthetic missing or inaccessible build/);}
  }
});

test('actual startup wiring invokes only the independently selected services', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = source.indexOf('      for (const job of startup.jobs)');
  const end = source.indexOf('      process.send?.', start);
  assert.ok(start > 0 && end > start);
  const names = ['editorial', 'trash', 'wilson', 'supervisor'];
  for (const selected of [[], ...names.map(name => [name]), names]) {
    const calls = [], pool = {};
    const run = new Function('startup', 'pool', 'scheduleEditorialCalendar', 'scheduleRenderOsTrashCleanup',
      'scheduleWilsonMessages', 'scheduleMiaSupervisor', source.slice(start, end));
    run({ jobs: selected }, pool, ...names.map(name => (...args) => calls.push({ name, args })));
    assert.deepEqual(calls.map(call => call.name), selected);
    for (const call of calls) assert.deepEqual(call.args, call.name === 'editorial' ? [] : [pool]);
  }
});
