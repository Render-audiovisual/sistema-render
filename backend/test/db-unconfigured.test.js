import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('missing explicit URL keeps db import inert and refuses queries instead of using inherited PG targets', () => {
  const moduleUrl = new URL('../src/db.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    let connections = 0;
    net.Socket.prototype.connect = function () { connections++; throw Error('Network forbidden in inert import test'); };
    const {pool} = await import(${JSON.stringify(moduleUrl)});
    await assert.rejects(pool.query('SELECT 1'), error => error.code === 'RENDER_DB_NOT_CONFIGURED');
    await assert.rejects(pool.connect(), error => error.code === 'RENDER_DB_NOT_CONFIGURED');
    await pool.end();
    assert.equal(connections, 0);
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null',
      RENDER_DISABLE_SERVER_START: 'true', PGHOST: 'unconfigured.example.invalid', PGPORT: '5432',
      PGUSER: 'synthetic', PGDATABASE: 'synthetic', PGSSLMODE: 'no-verify' },
    encoding: 'utf8', timeout: 10000, stdio: 'pipe',
  });
  assert.equal(output, '');
});
