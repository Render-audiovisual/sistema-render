import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { startLocalHarness, assertFixtureIdentity, request, fixturePassword } from '../scripts/render2-local-test.js';
import { readGoals } from '../src/client-goals.js';

test('goal content capability is actor-specific read metadata, never a write permit', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 150000,
}, async t => {
  const f = await startLocalHarness({ port: 55847 });
  t.after(async () => { await f.cleanup(); await assert.rejects(access(f.root), e => e.code === 'ENOENT'); });
  const [identity] = await f.query(`SELECT current_database() database,current_user username,
    host(inet_server_addr()) address,inet_server_port() port,current_setting('data_directory') directory`);
  assertFixtureIdentity({ root:f.root,cwd:f.root,port:55847,
    url:'postgresql://render2_fixture@127.0.0.1:55847/render2_local_test',identity });
  const api = (path, token, method='GET', body) => request(f.base, `/api${path}`, {token,method,body});
  const ok = (r, status=200) => { assert.equal(r.status,status,JSON.stringify(r.body)); return r.body; };
  const login = async usuario => ok(await api('/login',null,'POST',{usuario,password:fixturePassword})).token;
  const owner=await login('qa_franco'),otherOwner=await login('qa_agustin');
  const designer=await login('qa_designer'),editor=await login('qa_luciano');
  const [client]=await f.query("INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles) VALUES('QA content capability',true,1,0) RETURNING id");
  const key=`cliente-${client.id}`;
  const goals=async token=>ok(await api('/cliente-objetivos?periodo=2026-10',token));
  const goal=data=>{const value=data.clientes.find(c=>c.clave===key);assert.ok(value);return value;};
  const preparation=goal(await goals(owner));
  ok(await api('/cliente-objetivos/preparar',owner,'POST',{periodo:'2026-10',clave:key,
    responsables:[91004],responsables_por_formato:{video:[91004],carrusel:[]},
    expected_preparation_revision:preparation.preparacion_revision}));
  const piece=goal(await goals(owner)).piezas[0]; assert.ok(piece?.tarea_id);
  const find=data=>goal(data).piezas.find(p=>p.id===piece.id);
  const current=async()=>ok(await api(`/tareas/${piece.tarea_id}?workspace=render_os`,owner));
  const body=task=>({titulo:'QA edited via goal',copy:'QA content',expected_updated_at:task.updated_at,expected_revision:task.revision});
  const endpoint=`/cliente-objetivos/piezas/${piece.id}/contenido`;
  const snapshot=async()=>{
    const out={};
    for(const table of ['tareas','tarea_asignaciones','cliente_objetivos_mensuales','cliente_objetivo_piezas','cliente_objetivo_eventos','publicaciones','editorial_publicacion_eventos']) {
      out[table]=await f.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`);
    }
    return out;
  };

  await t.test('shared reads retain pieces, versions and hashes while only assigned IDs or owners can edit',async()=>{
    const before=await snapshot(),responses=[];
    for(const [token,allowed] of [[owner,true],[otherOwner,true],[designer,true],[editor,false]]) {
      const data=await goals(token),p=find(data);assert.ok(p);
      assert.equal(p.puede_editar_contenido,allowed);assert.equal(typeof p.puede_editar_contenido,'boolean');
      assert.equal(Object.hasOwn(p,'preparation_membership'),false);
      responses.push(goal(data));
    }
    for(const row of responses.slice(1)){
      assert.equal(row.preparacion_revision,responses[0].preparacion_revision);
      assert.deepEqual(row.piezas.map(({puede_editar_contenido,...p})=>p),responses[0].piezas.map(({puede_editar_contenido,...p})=>p));
    }
    assert.deepEqual(await snapshot(),before);
    for(const actor of [undefined,null,{id:0,rol:'admin'},{id:'91001',rol:'admin'}]){
      const internal=await readGoals({query:async(sql,params)=>({rows:await f.query(sql,params)})},'2026-10',actor);
      assert.equal(find(internal).puede_editar_contenido,false,'Missing or invalid IDs fail closed, including admin labels');
    }
  });

  await t.test('names do not grant editing and stable collaborator IDs do',async()=>{
    await f.query("UPDATE usuarios SET nombre='Designer QA' WHERE id=91003");
    assert.equal(find(await goals(editor)).puede_editar_contenido,false);
    await f.query("INSERT INTO tarea_asignaciones(tarea_id,usuario_id,tipo) VALUES($1,91003,'colaborador')",[piece.tarea_id]);
    assert.equal(find(await goals(editor)).puede_editar_contenido,true);
    await f.query("UPDATE usuarios SET nombre='QA renamed collaborator' WHERE id=91003");
    assert.equal(find(await goals(editor)).puede_editar_contenido,true);
    ok(await api(endpoint,editor,'PATCH',body(await current())));
    assert.equal((await current()).propiedades_extra.copy_trabajo,'QA content');
  });

  await t.test('previous true capability cannot authorize a later removed assignment',async()=>{
    assert.equal(find(await goals(editor)).puede_editar_contenido,true);
    const held=body(await current());
    await f.query('DELETE FROM tarea_asignaciones WHERE tarea_id=$1 AND usuario_id=91003',[piece.tarea_id]);
    const before=await snapshot();ok(await api(endpoint,editor,'PATCH',held),404);
    assert.equal(find(await goals(editor)).puede_editar_contenido,false);
    assert.deepEqual(await snapshot(),before);
  });

  await t.test('missing workspace, noncanonical workspace and task trash/archive remove capability even for owners',async()=>{
    const [original]=await f.query('SELECT propiedades_extra FROM tareas WHERE id=$1',[piece.tarea_id]);
    for(const patch of [null,{workspace:null},{workspace:'legacy'},
      {papelera_render_os:true},{papelera_render_os:'true'},
      {archivada_render_os:true},{archivada_render_os:'true'}]){
      await f.query('UPDATE tareas SET propiedades_extra=$2::jsonb WHERE id=$1',[piece.tarea_id,JSON.stringify(patch===null?{}:{...original.propiedades_extra,...patch})]);
      const before=await snapshot();
      for(const token of [owner,designer])assert.equal(find(await goals(token)).puede_editar_contenido,false);
      assert.deepEqual(await snapshot(),before);
    }
    await f.query('UPDATE tareas SET propiedades_extra=$2::jsonb WHERE id=$1',[piece.tarea_id,JSON.stringify(original.propiedades_extra)]);
    assert.equal(find(await goals(owner)).puede_editar_contenido,true);
    assert.equal(find(await goals(designer)).puede_editar_contenido,true);
  });

  await t.test('capability does not bypass content CAS or invent publication',async()=>{
    const held=body(await current());assert.equal(find(await goals(designer)).puede_editar_contenido,true);
    ok(await api(endpoint,designer,'PATCH',{...held,copy:'QA newer content'}));
    const before=await snapshot();ok(await api(endpoint,designer,'PATCH',held),409);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await f.query('SELECT count(*)::int n FROM editorial_publicacion_eventos'))[0].n,0);
  });

  await t.test('historical piece remains readable with a strict false capability when its task disappears',async()=>{
    await f.query('DELETE FROM tareas WHERE id=$1',[piece.tarea_id]);
    const before=await snapshot();
    for(const token of [owner,designer,editor]){
      const p=find(await goals(token));assert.ok(p);assert.equal(p.tarea_id,null);assert.equal(p.puede_editar_contenido,false);
    }
    assert.deepEqual(await snapshot(),before);
  });
});
