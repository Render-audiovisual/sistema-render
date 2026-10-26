import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
test('manual live preflight is snapshot-bound read-only, bounded and has no business payload export',()=>{
 const sql=readFileSync(new URL('../../ops/render-release-preflight.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');
 const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
 assert.equal(statements[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(statements.at(-1),'COMMIT');
 assert.ok(statements.slice(1,-1).every(s=>s.startsWith('SET LOCAL ')||s.startsWith('SELECT ')));
 assert.match(sql,/statement_timeout='15000ms'/);assert.match(sql,/lock_timeout='3000ms'/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|DO)\s+(?!role)/i);
 assert.doesNotMatch(sql,/pg_read_file|pg_ls_dir|password_hash|\bimporte\b|\bsueldo\b|\btitulo\b|COPY.*PROGRAM/i);
 assert.match(sql,/transaction_read_only/);assert.match(sql,/public\._migrations/);assert.match(sql,/column_shape_hash/);
 assert.match(sql,/unsafe_definer_count/);assert.match(sql,/default_public_grant_count/);
});
