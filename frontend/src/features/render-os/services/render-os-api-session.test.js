import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, apiTaskPage } from './render-os-api.js';
import { BrowserSessionError } from '../../../shared/session/browser-api-fetch.js';
import { createCapturedRequest } from '../../../shared/session/captured-request.js';

test('late body session failures are never converted into successful empty objects or task pages', async () => {
  const original = globalThis.fetch;
  try {
    for (const error of [new BrowserSessionError('browser_intent_obsolete'),
      Object.assign(new Error('binding changed'), { code: 'session_binding_obsolete' }),
      Object.assign(new Error('disposed'), { name: 'ApplicationSessionError' })]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => { throw error; }, headers: new Headers() });
      await assert.rejects(apiRequest('/api/inicio'), value => value === error);
      await assert.rejects(apiTaskPage(), value => value === error);
    }
  } finally { globalThis.fetch = original; }
});
test('task pagination forwards original transport options without changing filter or totals semantics', async () => {
  const original = globalThis.fetch;
  const options = { signal: new AbortController().signal, headers: { Authorization: 'Bearer synthetic' } };
  try {
    globalThis.fetch = async (url, passed) => {
      assert.equal(passed, options);
      assert.match(url, /workspace=render_os/); assert.match(url, /asignado_a_id=7/);
      return { ok: true, json: async () => [{ id: 1 }], headers: new Headers({ 'X-Total-Count': '4' }) };
    };
    assert.deepEqual(await apiTaskPage({ responsible: 'id:7', offset: 0, limit: 1 }, options), { items: [{ id: 1 }], total: 4 });
  } finally { globalThis.fetch = original; }
});
test('generic API fallback remains unchanged but task pages reject malformed successful JSON', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('fixture JSON'); }, headers: new Headers() });
    assert.deepEqual(await apiRequest('/api/inicio'), {});
    await assert.rejects(apiTaskPage(), { message: 'No se pudo verificar la página de tareas.' });
  } finally { globalThis.fetch = original; }
});

test('real captured API transport preserves typed server conflict without attaching private response fields',async()=>{
  const original=globalThis.fetch;
  const session={token:'qa88-original',usuario:{id:7,rol:'admin',activo:true}};
  try {
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'/api/usuarios/9');assert.equal(options.headers.Authorization,'Bearer qa88-original');
      return new Response(JSON.stringify({error:'Alias unavailable',code:'LOGIN_IDENTIFIER_UNAVAILABLE',other_user_id:99,private_contact:'not-for-error@example.invalid'}),{status:409,headers:{'content-type':'application/json'}});
    };
    const scope=createCapturedRequest({session,readSession:()=>session,request:apiRequest});
    await assert.rejects(scope.request('/api/usuarios/9',{method:'PATCH',body:'{}'}),error=>{
      assert.equal(error.status,409);assert.equal(error.code,'LOGIN_IDENTIFIER_UNAVAILABLE');
      assert.equal(error.message,'Alias unavailable');assert.equal(error.other_user_id,undefined);
      assert.equal(error.private_contact,undefined);assert.equal(error.body,undefined);return true;
    });
  } finally {globalThis.fetch=original;}
});

test('malformed error DTOs retain HTTP status and ignore unbounded or non-scalar protocol codes',async()=>{
  const original=globalThis.fetch;
  try {
    for(const code of [null,{},[],87,'invalid code','x'.repeat(81),'bad\ncode','valid\n','valid\r\n','session_binding_obsolete']) {
      globalThis.fetch=async()=>new Response(JSON.stringify({error:{secret:'not-text'},code}),{status:409});
      await assert.rejects(apiRequest('/api/usuarios'),error=>{
        assert.equal(error.status,409);assert.equal(error.code,undefined);assert.equal(error.message,'No se pudo completar la operación.');return true;
      });
    }
    for(const body of ['null','not-json']) {
      globalThis.fetch=async()=>new Response(body,{status:503});
      await assert.rejects(apiRequest('/api/usuarios'),error=>{assert.equal(error.status,503);assert.equal(error.code,undefined);return true;});
    }
  } finally {globalThis.fetch=original;}
});
