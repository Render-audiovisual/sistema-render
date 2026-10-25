import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=new URL('../scripts/seed-usuarios.js',import.meta.url);
test('legacy account seed is inert even with a database URL and a shared default password',()=>{
  for(const args of [[],['--apply'],['--force']]) {
    const result=spawnSync(process.execPath,[fileURLToPath(script),...args],{
      env:{PATH:process.env.PATH,NODE_ENV:'production',DATABASE_URL:'postgresql://invalid.invalid:1/never_connect',
        SEED_PASSWORD_DEFAULT:'SYNTHETIC_SEED_CANARY'},timeout:2000,encoding:'utf8'});
    assert.equal(result.error,undefined);assert.equal(result.status,1);
    assert.equal(result.stdout,'');assert.match(result.stderr,/no se crearon ni modificaron cuentas/);
    assert.match(result.stderr,/sesión de administrador/);
    assert.doesNotMatch(result.stderr,/SYNTHETIC_SEED_CANARY|postgresql:|invalid\.invalid/);
  }
});
test('disabled seed imports no environment/database/crypto and has no side-effect escape path',()=>{
  const source=readFileSync(script,'utf8');
  assert.doesNotMatch(source,/^\s*import\s|import\(|require\(|pool\.|fetch\(|bcrypt\.|process\.env/m);
  assert.doesNotMatch(source,/INSERT INTO|UPDATE usuarios|DELETE FROM|SEED_PASSWORD_DEFAULT/);
});
