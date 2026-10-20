import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Source/DDL contracts only, following the061 receipt migration test model.
// No PostgreSQL, HTTP, FK execution, timing or concurrency proof is claimed.
const migrations = new URL('../migrations/', import.meta.url);
function migration() {
  const names = readdirSync(migrations).filter(name => /^071_[a-z0-9_]+\.sql$/.test(name));
  assert.equal(names.length, 1, 'Exactly one071 migration must define the dispatch version boundary');
  return readFileSync(new URL(names[0], migrations), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
}
function definition(sql) {
  const match = /CREATE(?: OR REPLACE)? FUNCTION ([a-z_][a-z0-9_]*)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/i.exec(sql);
  assert.ok(match, 'A trigger function must be defined in migration071');
  return { name: match[1], body: match[2].trim(), declaration: match[0] };
}

test('071 installs definitions only, with no data writes, backfill, schema/FK replacement or lifecycle changes', () => {
  const sql = migration(), fn = definition(sql);
  const installation = sql.replace(fn.declaration, '');
  assert.equal((sql.match(/CREATE(?: OR REPLACE)? FUNCTION\b/gi) || []).length, 1);
  assert.equal((installation.match(/CREATE TRIGGER\b/gi) || []).length, 1);
  assert.doesNotMatch(installation, /\b(?:INSERT|DELETE|TRUNCATE|DROP|ALTER|SELECT|DO|CALL)\b|\bUPDATE\s+[a-z_]\w*\s+SET\b/i);
  assert.doesNotMatch(fn.body, /\b(?:INSERT|DELETE|TRUNCATE|SELECT|EXECUTE|PERFORM|CALL)\b|\bUPDATE\s+[a-z_]\w*\s+SET\b/i);
  assert.doesNotMatch(sql, /\b(?:ADD CONSTRAINT|DROP CONSTRAINT|REFERENCES|FOREIGN KEY|DISABLE TRIGGER|ENABLE TRIGGER)\b/i);
  assert.doesNotMatch(sql, /NEW\.(?:publicacion_id|cliente_id|estado|copy|opciones|preview_only|created_at)\s*(?::=|=)/i);
});

test('dispatch updated_at ignores caller timestamp and advances at least one microsecond from OLD using wall clock', () => {
  const { body } = definition(migration());
  assert.match(body, /^BEGIN NEW\.updated_at\s*(?::=|=)\s*GREATEST\(\s*clock_timestamp\(\),\s*OLD\.updated_at\s*\+\s*interval '1 microsecond'\s*\); RETURN NEW; END\s*$/i);
  // This exact RHS also excludes NOW()/transaction time, timestamp truncation,
  // caller NEW.updated_at, integer rounding and millisecond-only progression.
  assert.doesNotMatch(body, /date_trunc|milliseconds?|\bnow\s*\(|CURRENT_TIMESTAMP|NEW\.updated_at\s*\+|OLD\.created_at/i);
});

test('one unconditional BEFORE UPDATE row trigger covers every dispatch writer, including FK SET NULL', () => {
  const sql = migration(), fn = definition(sql);
  const trigger = sql.replace(fn.declaration, '').trim();
  assert.match(trigger, new RegExp(`^CREATE TRIGGER [a-z_][a-z0-9_]* BEFORE UPDATE ON publicacion_envios FOR EACH ROW EXECUTE FUNCTION ${fn.name}\\(\\);$`, 'i'));
  assert.doesNotMatch(trigger, /UPDATE OF|\bWHEN\b|FOR EACH STATEMENT|AFTER UPDATE|INSTEAD OF/i);
  assert.doesNotMatch(fn.body, /\b(?:IF|CASE|TG_OP|TG_ARGV|current_user|session_user)\b/i);
});

test('baseline publication deletion FK remains SET NULL and dispatch DTO retains opaque six-microsecond version text', () => {
  const baseline = readFileSync(new URL('../migrations/037_publicacion_envios.sql', import.meta.url), 'utf8');
  assert.match(baseline, /publicacion_id INTEGER REFERENCES publicaciones\(id\) ON DELETE SET NULL/);
  const dispatch = readFileSync(new URL('../src/publication-dispatch.js', import.meta.url), 'utf8');
  assert.ok(dispatch.includes(`to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`));
  //071 must not modify FK semantics or backfill old version values to obtain
  // this coverage: PostgreSQL's future FK-generated UPDATE invokes the trigger.
  const sql = migration();
  assert.doesNotMatch(sql, /ON DELETE|SET NULL|ALTER TABLE|UPDATE publicacion_envios SET/i);
});
