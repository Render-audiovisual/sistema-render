import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import pg from 'pg';
import {X509Certificate} from 'node:crypto';
import { buildDatabasePoolConfig, isLoopbackDatabaseUrl } from '../src/database-transport.js';

const remote = 'postgresql://qa_user:qa_unused@db.example.invalid:5433/qa_database';
test('every explicit connection pins public instead of inherited schema options',()=>{
  for(const DATABASE_URL of [remote,'postgresql://qa@127.0.0.1/qa']){
    assert.equal(buildDatabasePoolConfig({DATABASE_URL,PGOPTIONS:'-c search_path=untrusted'}).options,'-c search_path=public');
  }
});
test('single-line hosting PEM preserves the exact CA and strict TLS identity checks',()=>{
  const root=tls.rootCertificates[0],flat=root.replace(/[\r\n]/g,'');
  const config=buildDatabasePoolConfig({DATABASE_URL:remote,RENDER_DB_CA_PEM:flat});
  assert.equal(new X509Certificate(config.ssl.ca).fingerprint256,new X509Certificate(root).fingerprint256);
  assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.minVersion,'TLSv1.2');
  assert.equal(config.ssl.checkServerIdentity('ignored',{subjectaltname:'DNS:wrong.invalid',subject:{}}).code,'ERR_TLS_CERT_ALTNAME_INVALID');
  for(const value of [flat+'extra',flat.replace('CERTIFICATE','PRIVATE KEY'),
    '-----BEGIN CERTIFICATE-----aGVsbG8=-----END CERTIFICATE-----']){
    assert.throws(()=>buildDatabasePoolConfig({DATABASE_URL:remote,RENDER_DB_CA_PEM:value}));
  }
});
test('missing explicit URL returns no target and cannot resolve ambient PG targets', () => {
  for (const DATABASE_URL of [undefined, '']) assert.equal(buildDatabasePoolConfig({ DATABASE_URL, PGHOST: 'unknown.example.invalid', PGSSLMODE: 'no-verify' }), null);
});
test('only exact loopback TCP destinations are plaintext; remote targets always verify TLS', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]']) {
    const url = `postgresql://qa@${host}/qa`;
    assert.equal(isLoopbackDatabaseUrl(url), true); assert.equal(buildDatabasePoolConfig({ DATABASE_URL: url }).ssl, false);
  }
  for (const host of ['localhost.example.invalid', 'localhost.', '127.1', '192.0.2.10', '[2001:db8::10]', '[::ffff:127.0.0.1]']) {
    const config = buildDatabasePoolConfig({ DATABASE_URL: `postgresql://qa@${host}/qa` });
    assert.equal(config.ssl.rejectUnauthorized, true); assert.equal(config.ssl.minVersion, 'TLSv1.2');
  }
});
test('validated explicit fields survive installed pg without URL/SSL parser overrides or external IO', async () => {
  const config = buildDatabasePoolConfig({ DATABASE_URL: remote, PGSSLMODE: 'verify-full' });
  assert.equal(Object.hasOwn(config, 'connectionString'), false);
  const client = new pg.Client(config);
  assert.equal(client.connectionParameters.host, 'db.example.invalid');
  assert.equal(client.connectionParameters.port, 5433); assert.equal(client.connectionParameters.user, 'qa_user');
  assert.equal(client.connectionParameters.database, 'qa_database');
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.sslnegotiation, 'postgres');
  assert.equal(await client.connectionParameters.password(), 'qa_unused');
  const empty = new pg.Client(buildDatabasePoolConfig({ DATABASE_URL: 'postgresql://qa@db.example.invalid/qa' }));
  assert.equal(await empty.connectionParameters.password(), '');
});
test('all query/fragment and socket/host overrides reject before installed pg can read files or replace TLS', () => {
  for (const tail of ['?ssl=no-verify', '?sslmode=disable', '?sslmode=require', '?sslrootcert=/secret', '?sslcert=/secret', '?sslkey=/secret',
    '?host=remote.example', '?host=/tmp', '?port=5432', '?application_name=qa', '?uselibpqcompat=true', '?sslnegotiation=direct', '?', '#fragment', '#']) {
    assert.throws(() => buildDatabasePoolConfig({ DATABASE_URL: remote + tail }), /transporte PostgreSQL/);
  }
});
test('malformed explicit URLs fail with generic errors rather than credential-bearing parser data', () => {
  const secret = 'QA_PRIVATE_URL_SENTINEL';
  for (const value of [`postgresql://user:${secret}@/db`, `https://user:${secret}@db.example/db`, `postgresql://user:${secret}@db.example`,
    `postgresql://user:${secret}@db.example:0/db`, `postgresql://user:${secret}@db.example/a/b`, `postgresql://user:${secret}%ZZ@db.example/db`,
    `postgresql://user:${secret}%00@db.example/db`, ` postgresql://user:${secret}@db.example/db`, 'socket:/tmp', '/tmp qa']) {
    assert.throws(() => buildDatabasePoolConfig({ DATABASE_URL: value }), error => {
      assert.equal(String(error).includes(secret), false); assert.equal(error.cause, undefined); return true;
    });
  }
});
test('explicit certificate identity remains tied to the expected remote DNS or IP, not a caller-supplied TLS name', () => {
  for (const [host, cert] of [['db.example.invalid', { subjectaltname: 'DNS:db.example.invalid', subject: {} }],
    ['192.0.2.10', { subjectaltname: 'IP Address:192.0.2.10', subject: {} }]]) {
    const config = buildDatabasePoolConfig({ DATABASE_URL: `postgresql://qa@${host}/qa` });
    assert.equal(config.ssl.checkServerIdentity('untrusted-caller-name.invalid', cert), undefined);
    assert.equal(config.ssl.checkServerIdentity('db.example.invalid', { subjectaltname: 'DNS:other.example.invalid', subject: {} }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  }
  const ipv6 = buildDatabasePoolConfig({ DATABASE_URL: 'postgresql://qa@[2001:db8::10]/qa' });
  assert.equal(ipv6.ssl.checkServerIdentity('anything', {}).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
});
test('custom CA uses a bounded in-memory public certificate bundle, never a filename or private key', () => {
  const root = tls.rootCertificates[0];
  const config = buildDatabasePoolConfig({ DATABASE_URL: remote, RENDER_DB_CA_PEM: `${root}\n${root}` });
  assert.equal(config.ssl.rejectUnauthorized, true); assert.equal((config.ssl.ca.match(/BEGIN CERTIFICATE/g) || []).length, 2);
  for (const pem of ['', '/private/secret/ca.pem', '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    '-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----', `${root}\nextra`, 'x'.repeat(262145), Array(17).fill(root).join('\n')]) {
    assert.throws(() => buildDatabasePoolConfig({ DATABASE_URL: remote, RENDER_DB_CA_PEM: pem }), /transporte PostgreSQL/);
  }
  assert.throws(() => buildDatabasePoolConfig({ DATABASE_URL: 'postgresql://qa@127.0.0.1/qa', RENDER_DB_CA_PEM: root }));
});
test('environment options cannot downgrade verification, select certificate paths or switch negotiation', () => {
  for (const override of [{ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { PGSSLMODE: 'no-verify' }, { PGSSLMODE: 'disable' },
    { PGSSLMODE: 'prefer' }, { PGSSLMODE: 'require' }, { PGSSLNEGOTIATION: 'direct' },
    { PGSSLROOTCERT: '/secret' }, { PGSSLCERT: '/secret' }, { PGSSLKEY: '/secret' }, { PGSSLCRL: '/secret' }]) {
    assert.throws(() => buildDatabasePoolConfig({ DATABASE_URL: remote, ...override }), /transporte PostgreSQL/);
  }
  assert.throws(() => buildDatabasePoolConfig({ DATABASE_URL: 'postgresql://qa@127.0.0.1/qa', PGSSLMODE: 'verify-full' }));
});
