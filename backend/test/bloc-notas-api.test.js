import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { startLocalHarness, request, fixturePassword } from '../scripts/render2-local-test.js';

const qaDisponible = process.env.RENDER2_RUN_LOCAL_INTEGRATION === 'true';

test("API Bloc de notas: acceso compartido, autoguardado, conflicto y Papelera", {
  skip: qaDisponible ? false : "requiere RENDER2_RUN_LOCAL_INTEGRATION=true y fixture local propio",
  timeout: 180_000,
}, async t => {
  const fixture=await startLocalHarness({port:55772});
  t.after(async()=>{await fixture.cleanup();await assert.rejects(access(fixture.root),error=>error.code==='ENOENT');});
  const login=await request(fixture.base,'/api/login',{method:'POST',body:{usuario:'qa_designer',password:fixturePassword}});
  assert.equal(login.status,200);
  const token=login.body.token;
  const other=await request(fixture.base,'/api/login',{method:'POST',body:{usuario:'qa_luciano',password:fixturePassword}});
  assert.equal(other.status,200);
  let noteId = null;
  const api = async (path, options = {}) => {
    let body=options.body===undefined?undefined:JSON.parse(options.body);
    if(options.method && options.method!=='GET') {
      body={...body,...(Object.hasOwn(body??{},'request_id')?{}:{request_id:randomUUID()})};
      const match=/^\/notas\/(\d+)/.exec(path);
      if(match && !Object.hasOwn(body,'expected_updated_at')) {
        const read=await request(fixture.base,`/api/notas/${match[1]}/detalle${path.endsWith('/restaurar')?'?papelera=true':''}`,{token});
        assert.equal(read.status,200);body.expected_updated_at=read.body.item.updated_at;
      }
    }
    const result=await request(fixture.base,`/api${path}`,{token:options.token??token,method:options.method,body});
    return {response:{status:result.status},body:result.body};
  };

  {
    const created = await api("/notas", { method: "POST", body: JSON.stringify({ titulo: "QA nota", contenido: "Inicial", categoria: "diseno" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.creado_por, "Designer QA");
    assert.equal(created.body.categoria, "diseno");
    noteId = created.body.id;

    const updated = await api(`/notas/${noteId}`, { token:other.body.token, method: "PATCH", body: JSON.stringify({ contenido: "Guardada", categoria: "reunion", expected_updated_at: created.body.updated_at }) });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.contenido, "Guardada");
    assert.equal(updated.body.categoria, "reunion");
    assert.equal(updated.body.creado_por,created.body.creado_por);
    assert.equal(updated.body.modificado_por,'Luciano QA');

    const stale = await api(`/notas/${noteId}`, { method: "PATCH", body: JSON.stringify({ contenido: "No pisar", expected_updated_at: created.body.updated_at }) });
    assert.equal(stale.response.status, 409);

    assert.equal((await api(`/notas/${noteId}`, { method: "DELETE" })).response.status, 200);
    const trash = await api("/notas?papelera=true&q=QA%20nota");
    assert.ok(trash.body.some((note) => note.id === noteId));
    assert.equal((await api(`/notas/${noteId}/restaurar`, { method: "POST" })).response.status, 200);
  }
});
