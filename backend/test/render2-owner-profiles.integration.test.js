import test from 'node:test';
import assert from 'node:assert/strict';
import { startOwnerProfilesFixture, ownerProfileHttp, ownerSessionFromResponse, loginOwnerFixture } from './helpers/owner-profiles-local-fixture.js';
import { fixturePassword } from '../scripts/render2-local-test.js';

test('local owner profiles: actual cookie switch rotates session and scopes own work by explicit IDs without changing Leader', {
  skip: process.env.RENDER2_RUN_LOCAL_INTEGRATION !== 'true', timeout: 180000,
}, async t => {
  const f = await startOwnerProfilesFixture({pgPort:55630});
  t.after(async () => { await f.cleanup(); t.diagnostic('Own synthetic PG55630/HTTP processes removed; old52920 and existing restored copies untouched.'); });
  const http = (route, options) => ownerProfileHttp(f.base, route, options);
  const checked = (response, status = 200) => { assert.equal(response.status, status, 'Owner-profile HTTP status (credentials never printed)'); return response.body; };
  const metadata = (value, active) => assert.deepEqual(value, { principal_id: 91001, active,
    profiles: [{ key: 'franco', user_id: 91005, name: 'Franco' }, { key: 'agustin', user_id: 91006, name: 'Agustín' }] });
  const business = async () => {
    const result = {};
    for (const table of ['usuarios', 'tareas', 'tarea_asignaciones']) result[table] = await f.query(`SELECT
      md5(coalesce(jsonb_agg(jsonb_build_array(to_jsonb(r),xmin::text,ctid::text) ORDER BY to_jsonb(r)::text)::text,'[]')) AS hash FROM ${table} r`);
    return result;
  };
  const home = async (session, id, task) => {
    const response = await http('/api/inicio', { session }), dto = checked(response);
    assert.equal(response.context, session.context); assert.equal(dto.user.id, id);
    assert.equal(dto.summary.open, 1); assert.deepEqual(dto.activity.map(row => row.task_id), [task]);
    return dto;
  };
  const switchProfile = async (session, profile) => {
    const response = await http('/api/sesion/perfil-dueno', { session, method: 'POST', body: { profile } });
    checked(response); const next = ownerSessionFromResponse(response);
    assert.notEqual(next.cookie, session.cookie); assert.notEqual(next.context, session.context); assert.notEqual(next.csrf, session.csrf);
    metadata(next.ownerProfiles, profile); return next;
  };
  let root, franco, agustin;
  await t.test('root login/bootstrap expose active:null and preserve account identity; profile credentials cannot log in directly', async () => {
    root = await loginOwnerFixture(f.base); assert.equal(root.user.id, 91001); assert.equal(root.user.nombre, 'Cuenta Render'); metadata(root.ownerProfiles, null);
    const bootstrap = checked(await http('/api/sesion', { session: root })); metadata(bootstrap.owner_profiles, null);
    await home(root, 91001, f.tasks.leader);
    const users = await f.query('SELECT id,password_hash,google_id,google_email,rol,activo FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id', [[91005, 91006]]);
    assert.equal(users.length, 2); assert.notEqual(users[0].password_hash, users[1].password_hash);
    for (const user of users) {
      assert.equal(user.rol, 'admin'); assert.equal(user.activo, true); assert.equal(user.google_id, null); assert.equal(user.google_email, null);
      checked(await http('/api/login', { method: 'POST', body: { usuario: `qa_internal_owner_${user.id}`, password: fixturePassword } }), 401);
    }
  });
  await t.test('switch root to Franco to Agustín without a password; fresh cookie bootstrap and personal work follow actor IDs', async () => {
    const before = await business();
    franco = await switchProfile(root, 'franco'); assert.equal(franco.user.id, 91005); await home(franco, 91005, f.tasks.franco);
    const persistedFranco = checked(await http('/api/sesion', { session: franco })); metadata(persistedFranco.owner_profiles, 'franco');
    agustin = await switchProfile(franco, 'agustin'); assert.equal(agustin.user.id, 91006); await home(agustin, 91006, f.tasks.agustin);
    metadata(checked(await http('/api/sesion', { session: agustin })).owner_profiles, 'agustin');
    assert.deepEqual(await business(), before, 'Switch never mutates accounts, roles, task content, Leader or assignments');
    assert.deepEqual(await f.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [f.tasks.leader]),
      [{ tarea_id: f.tasks.leader, usuario_id: 91001, tipo: 'responsable' }]);
  });
  await t.test('crossed old proof, missing CSRF, unknown profile/extra body and bearer transport cannot switch or overwrite cookie', async () => {
    const before = await business();
    for (const options of [
      { session: { ...agustin, context: franco.context }, body: { profile: 'franco' }, status: 409 },
      { session: agustin, body: { profile: 'franco' }, headers: { 'x-render-csrf': '' }, status: 403 },
      { session: agustin, body: { profile: 'leader' }, status: 400 },
      { session: agustin, body: { profile: 'franco', password: fixturePassword }, status: 400 },
    ]) {
      const response = await http('/api/sesion/perfil-dueno', { method: 'POST', ...options }); checked(response, options.status); assert.equal(response.cookie, null);
    }
    const bearer = checked(await http('/api/login', { method: 'POST', body: { usuario: 'qa_franco', password: fixturePassword } })).token;
    const denied = await http('/api/sesion/perfil-dueno', { method: 'POST', body: { profile: 'franco' }, headers: { authorization: `Bearer ${bearer}` } });
    assert.ok([401, 403].includes(denied.status)); assert.equal(denied.cookie, null);
    assert.deepEqual(await business(), before);
  });
  for (const usuario of ['qa_luciano', 'qa_agustin']) {
    await t.test(`${usuario}: employee/nonmapped admin has no switch metadata and receives403`, async () => {
      const session = await loginOwnerFixture(f.base, usuario); assert.equal(session.ownerProfiles, undefined);
      const before = await business(); const response = await http('/api/sesion/perfil-dueno', { session, method: 'POST', body: { profile: 'franco' } });
      checked(response, 403); assert.equal(response.cookie, null); assert.deepEqual(await business(), before);
    });
  }
  await t.test('delegated browser writes persist as their actor, shared finance context denies employee, Leader tasks remain assigned',async()=>{
    const [client]=await f.query("INSERT INTO clientes(nombre) VALUES('QA owner HTTP client') RETURNING id");
    const response=await http('/api/producciones',{session:franco,method:'POST',body:{
      cliente_id:client.id,fecha:'2026-10-28',titulo:'QA owner HTTP visit',participante_ids:[91005,91003]}});
    const visit=checked(response,201).visita;
    assert.equal(typeof visit.id,'string');
    const [stored]=await f.query('SELECT creado_por_id,actualizado_por_id FROM produccion_visitas WHERE id=$1',[visit.id]);
    assert.deepEqual(stored,{creado_por_id:91005,actualizado_por_id:91005});
    checked(await http(`/api/producciones/${visit.id}`,{session:agustin}));
    checked(await http('/api/finanzas/pagos/contexto',{session:agustin}));
    const employee=await loginOwnerFixture(f.base,'qa_luciano');
    checked(await http('/api/finanzas/pagos/contexto',{session:employee}),403);
    assert.deepEqual(await f.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1',[f.tasks.leader]),
      [{tarea_id:f.tasks.leader,usuario_id:91001,tipo:'responsable'}]);
  });
  await t.test('missing or semantically invalid mapping403, without using name/role fallback or changing any business row', async () => {
    for (const mapping of [null, { accountId: 91001, francoUserId: 91005, agustinUserId: 91999 }]) {
      const app = await f.startApp({ mapping });
      try {
        const before = await business();
        const response = await ownerProfileHttp(app.base, '/api/sesion/perfil-dueno', { session: root, method: 'POST', body: { profile: 'agustin' } });
        checked(response, 403); assert.equal(response.cookie, null); assert.deepEqual(await business(), before);
      } finally { await app.stop(); }
    }
  });
  await t.test('root session revocation and target deactivation revoke delegated use, never falling back to Leader or another admin', async () => {
    const delegated = await switchProfile(await loginOwnerFixture(f.base), 'franco');
    await f.query('UPDATE usuarios SET session_version=session_version+1 WHERE id=91001'); // Explicit synthetic setup only.
    const afterRevocation = await business();
    checked(await http('/api/sesion', { session: delegated }), 401);
    checked(await http('/api/sesion/perfil-dueno', { session: delegated, method: 'POST', body: { profile: 'agustin' } }), 401);
    assert.deepEqual(await business(), afterRevocation);
    const newRoot = await loginOwnerFixture(f.base);
    await f.query('UPDATE usuarios SET activo=false WHERE id=91006'); // Explicit synthetic setup only.
    try {
      const afterDeactivation = await business();
      const response = await http('/api/sesion/perfil-dueno', { session: newRoot, method: 'POST', body: { profile: 'agustin' } });
      checked(response, 403); assert.equal(response.cookie, null); assert.deepEqual(await business(), afterDeactivation);
    } finally { await f.query('UPDATE usuarios SET activo=true WHERE id=91006'); }
  });
  await t.test('logout from owner profile revokes root session_version only, leaving actor and Leader task/bindings untouched', async () => {
    const principal = await loginOwnerFixture(f.base), delegated = await switchProfile(principal, 'agustin');
    const before = await business();
    const profileRows = () => f.query(`SELECT id,md5(to_jsonb(u)::text||xmin::text||ctid::text) AS hash
      FROM usuarios u WHERE id=ANY($1::int[]) ORDER BY id`, [[91005, 91006]]);
    const profileBefore = await profileRows();
    const versions = await f.query('SELECT id,session_version FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id', [[91001, 91005, 91006]]);
    checked(await http('/api/logout', { session: delegated, method: 'POST', body: {} }));
    const afterVersions = await f.query('SELECT id,session_version FROM usuarios WHERE id=ANY($1::int[]) ORDER BY id', [[91001, 91005, 91006]]);
    assert.deepEqual(afterVersions, versions.map(row => ({ ...row, session_version: row.session_version + (row.id === 91001 ? 1 : 0) })));
    assert.deepEqual(await profileRows(), profileBefore, 'Profile actor rows remain entirely physically unchanged on root logout');
    const after = await business(); assert.deepEqual(after.tareas, before.tareas); assert.deepEqual(after.tarea_asignaciones, before.tarea_asignaciones);
    checked(await http('/api/sesion', { session: delegated }), 401); checked(await http('/api/sesion', { session: principal }), 401);
    assert.deepEqual(await f.query('SELECT tarea_id,usuario_id,tipo FROM tarea_asignaciones WHERE tarea_id=$1', [f.tasks.leader]),
      [{ tarea_id: f.tasks.leader, usuario_id: 91001, tipo: 'responsable' }]);
  });
});
