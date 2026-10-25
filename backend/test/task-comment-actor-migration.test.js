import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startLocalHarness} from '../scripts/render2-local-test.js';
import {taskOperationalDto} from '../src/operational-dto.js';

test('actor migration is additive, nullable and indexed; it never infers identity or rewrites comments',()=>{
  const sql=readFileSync(new URL('../migrations/092_task_comment_actor.sql',import.meta.url),'utf8');
  assert.match(sql,/ADD COLUMN actor_usuario_id INTEGER;/);
  assert.match(sql,/actor_usuario_id IS NULL OR actor_usuario_id > 0/);
  assert.match(sql,/FOREIGN KEY \(actor_usuario_id\) REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.match(sql,/CREATE INDEX tarea_comentarios_actor_idx/);
  assert.doesNotMatch(sql,/^\s*(?:UPDATE|INSERT|DELETE FROM|DROP)\b/m);
  assert.doesNotMatch(sql,/ADD COLUMN[^;]*(?:NOT NULL|DEFAULT)/);
});
test('pre092 rehearsal cannot start an API or accept nonboolean deferral',async()=>{
  await assert.rejects(startLocalHarness({deferTaskCommentActorMigration:true}),/cluster-only fixture/);
  await assert.rejects(startLocalHarness({clusterOnly:true,deferTaskCommentActorMigration:'true'}),/cluster-only fixture/);
});
test('operational nested comments expose only ID/null, never actor profile or economic payload',()=>{
  const result=taskOperationalDto({id:1,comentarios:[{id:2,autor:'Historical label',actor_usuario_id:7,actor_profile:{sueldo:999},ingreso:999}]},{id:8,rol:'edicion'});
  assert.equal(result.comentarios[0].actor_usuario_id,7);assert.ok(!Object.hasOwn(result.comentarios[0],'actor_profile'));
  assert.ok(!Object.hasOwn(result.comentarios[0],'ingreso'));
  for(const value of [null,0,-1,'7',2147483648]){
    const row=taskOperationalDto({id:1,comentarios:[{id:2,actor_usuario_id:value}]},{id:8,rol:'edicion'}).comentarios[0];
    if(value===null)assert.equal(row.actor_usuario_id,null);else assert.ok(!Object.hasOwn(row,'actor_usuario_id'));
  }
});
