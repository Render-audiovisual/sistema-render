import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-only contract checks. These do not execute PostgreSQL or claim a
// populated upgrade has been verified; guarded fixture QA owns that evidence.
const source = readFileSync(new URL('../migrations/067_auth_login_buckets.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const table = /CREATE TABLE auth_login_buckets \((.*?)\);/.exec(sql)?.[1];

test('067 contains only an additive empty table and its expiry index', () => {
  assert.ok(table);
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE TABLE auth_login_buckets \(/);
  assert.equal(statements[1], 'CREATE INDEX auth_login_buckets_expiry_idx ON auth_login_buckets(expires_at)');
  assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]), ['auth_login_buckets']);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|COPY|SELECT|DO|CALL|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(sql, /IF NOT EXISTS|CREATE (?:FUNCTION|TRIGGER|EXTENSION|TYPE)|REFERENCES|FOREIGN KEY/i);
});

test('table has exactly four columns with the required scalar PostgreSQL types', () => {
  let depth = 0, start = 0;
  const definitions = [];
  for (let index = 0; index < table.length; index++) {
    if (table[index] === '(') depth++;
    if (table[index] === ')') depth--;
    if (table[index] === ',' && depth === 0) { definitions.push(table.slice(start, index).trim()); start = index + 1; }
  }
  definitions.push(table.slice(start).trim());
  assert.deepEqual(definitions.filter(definition => !definition.startsWith('CONSTRAINT ')), [
    'bucket_key TEXT PRIMARY KEY', 'attempts INTEGER NOT NULL',
    'window_started_at TIMESTAMPTZ NOT NULL', 'expires_at TIMESTAMPTZ NOT NULL',
  ]);
  assert.equal(definitions.filter(definition => definition.startsWith('CONSTRAINT ')).length, 3);
  const declarations = [...source.replace(/--[^\n]*/g, '').matchAll(/^\s+(\w+)\s+(TEXT|INTEGER|TIMESTAMPTZ)\b([^\n]*)/gm)]
    .map(([, name, type, rest]) => ({ name, type, rest: rest.trim().replace(/,$/, '') }));
  assert.deepEqual(declarations, [
    { name: 'bucket_key', type: 'TEXT', rest: 'PRIMARY KEY' },
    { name: 'attempts', type: 'INTEGER', rest: 'NOT NULL' },
    { name: 'window_started_at', type: 'TIMESTAMPTZ', rest: 'NOT NULL' },
    { name: 'expires_at', type: 'TIMESTAMPTZ', rest: 'NOT NULL' },
  ]);
  assert.doesNotMatch(table, /\b(?:JSONB?|BYTEA|SERIAL|BIGSERIAL|UUID|GENERATED|DEFAULT)\b/i);
  assert.equal((table.match(/PRIMARY KEY/g) || []).length, 1);
});

test('bucket key is a primary key constrained to exactly 64 lowercase hex characters', () => {
  assert.match(table, /bucket_key TEXT PRIMARY KEY/);
  assert.match(table, /CONSTRAINT auth_login_buckets_key_check CHECK \( char_length\(bucket_key\) = 64 AND bucket_key ~ '\^\[0-9a-f\]\{64\}\$' \)/);
  const pattern = new RegExp(/bucket_key ~ '([^']+)'/.exec(table)[1]);
  assert.equal(pattern.test('a0'.repeat(32)), true);
  for (const key of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(63)}\n`, 'user@example.org', '127.0.0.1'])
    assert.equal(key.length === 64 && pattern.test(key), false);
});

test('attempts is nonnull integer bounded to one through limit-plus-one 121', () => {
  assert.match(table, /attempts INTEGER NOT NULL/);
  assert.match(table, /CONSTRAINT auth_login_buckets_attempts_check CHECK \(attempts BETWEEN 1 AND 121\)/);
  assert.doesNotMatch(table, /attempts\s*(?:>=\s*0|>\s*0\s*\))/);
});

test('window timestamps are mandatory and expiry is strictly after the start', () => {
  assert.match(table, /window_started_at TIMESTAMPTZ NOT NULL/);
  assert.match(table, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(table, /CONSTRAINT auth_login_buckets_expiry_check CHECK \(expires_at > window_started_at\)/);
  assert.doesNotMatch(table, /expires_at >=|CURRENT_TIMESTAMP|clock_timestamp|now\(/i);
  assert.match(sql, /CREATE INDEX auth_login_buckets_expiry_idx ON auth_login_buckets\(expires_at\);$/);
});

test('schema stores no identifiers, network addresses, credentials, arbitrary payload or business references', () => {
  assert.doesNotMatch(table, /\b(?:usuario|usuarios|user_id|actor_id|identifier|email|ip|peer|address|password|credential|token|secret|payload|metadata|nombre|cliente_id|tarea_id)\b/i);
  assert.doesNotMatch(sql, /\b(?:usuarios|clientes|tareas|historias|publicaciones|producciones|proyectos)\b/i);
  assert.doesNotMatch(sql, /\b(?:INET|CIDR|JSON|JSONB)\b/i);
});
