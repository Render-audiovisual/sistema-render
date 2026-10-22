import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {startLocalHarness} from '../scripts/render2-local-test.js';

test('086 preserves historical cross-board references while enforcing new associations and observed revisions',{
  skip:process.env.RENDER2_RUN_LOCAL_INTEGRATION!=='true',timeout:180000,
},async t=>{
  const f=await startLocalHarness({port:55775,clusterOnly:true,deferMoodboardReferenceMigration:true});
  t.after(async()=>{await f.cleanup();await assert.rejects(access(f.root),e=>e.code==='ENOENT');t.diagnostic(`QA122 migration cleanup ENOENT: ${f.root}`);});
  const [a]=await f.query("INSERT INTO moodboard_boards(nombre) VALUES('QA122 own A') RETURNING id");
  const [b]=await f.query("INSERT INTO moodboard_boards(nombre) VALUES('QA122 own B') RETURNING id");
  const [category]=await f.query("INSERT INTO moodboard_categories(board_id,nombre) VALUES($1,'Legacy cross-board category') RETURNING id",[b.id]);
  const [reference]=await f.query(`INSERT INTO moodboard_references(board_id,category_id,titulo,nota,etiquetas,estado,tipo_fuente,enlace_externo,autor_nombre)
    VALUES($1,$2,NULL,'Preserve historical note',ARRAY['legacy'],'libre','enlace','https://example.invalid/qa122','Historic author') RETURNING *`,[a.id,category.id]);
  const beforeCategories=await f.query('SELECT * FROM moodboard_categories ORDER BY id');
  assert.deepEqual(await f.query("SELECT to_regclass('public.moodboard_reference_operations') AS relation"),[{relation:null}]);
  await f.query(await readFile(new URL('../migrations/086_moodboard_reference_operations.sql',import.meta.url),'utf8'));
  const [after]=await f.query('SELECT * FROM moodboard_references WHERE id=$1',[reference.id]);
  const {revision,...rest}=after;assert.equal(revision,'0');assert.deepEqual(rest,reference);
  assert.deepEqual(await f.query('SELECT * FROM moodboard_categories ORDER BY id'),beforeCategories);
  assert.deepEqual(await f.query('SELECT * FROM moodboard_reference_operations'),[]);
  const [constraint]=await f.query("SELECT convalidated FROM pg_constraint WHERE conname='moodboard_reference_category_board_fk'");
  assert.equal(constraint.convalidated,false,'legacy associations are not silently repaired or promoted');
  await assert.rejects(f.query(`INSERT INTO moodboard_references(board_id,category_id,nota,estado,tipo_fuente,enlace_externo,autor_nombre)
    VALUES($1,$2,'Reject new crossing','libre','enlace','https://example.invalid/new','New')`,[a.id,category.id]),/moodboard_reference_category_board_fk/);
  const [edited]=await f.query("UPDATE moodboard_references SET estado='aprobada' WHERE id=$1 RETURNING *",[reference.id]);
  assert.equal(edited.revision,'1');assert.equal(edited.category_id,category.id);assert.equal(edited.board_id,a.id);assert.equal(edited.nota,reference.nota);
  await f.query('DELETE FROM moodboard_categories WHERE id=$1',[category.id]);
  const [cleared]=await f.query('SELECT * FROM moodboard_references WHERE id=$1',[reference.id]);
  assert.equal(cleared.board_id,a.id);assert.equal(cleared.category_id,null);assert.ok(BigInt(cleared.revision)>1n);
  assert.equal(cleared.nota,reference.nota);assert.equal(cleared.titulo,null);assert.deepEqual(cleared.etiquetas,reference.etiquetas);
  assert.deepEqual(await f.query('SELECT * FROM moodboard_reference_operations'),[],'SQL history test does not fabricate browser receipts');
});
