import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExpectedEditingDelivery, assertCurrentEditingApprover, assertEditingApprovalDelivery } from '../src/editing-approval.js';
import { configuredOwnerProfiles, rememberOwnerProfileSession, bindCapturedOwnerProfileAuthority } from '../src/owner-profile-authority.js';
import { bindDatabaseAuthorityClient } from '../src/database-authority-context.js';

test('delegated approver retains principal before actor and closed proof preserves authority through recapture', async()=>{
  const pool={};
  const policy=configuredOwnerProfiles({NODE_ENV:'test',RENDER_DB_ENVIRONMENT:'test',
    DATABASE_URL:'postgresql://fixture@127.0.0.1:55989/render2_local_test',
    RENDER_OWNER_PROFILES:JSON.stringify({accountId:91001,francoUserId:91005,agustinUserId:91006})},pool).policy;
  const exp=Math.floor(Date.now()/1000)+300;
  const auth={id:91005,rol:'admin',session_version:1,root_id:91001,root_session_version:1,root_exp:exp,exp,owner_profile:'franco'};
  rememberOwnerProfileSession(auth,auth,policy);
  const captured=bindCapturedOwnerProfileAuthority(auth,Object.freeze({id:auth.id,rol:auth.rol,session_version:auth.session_version}));
  const users=[91001,91005,91006].map(id=>({id,rol:'admin',activo:true,session_version:1})),calls=[];
  const db={async query(sql,params){calls.push(sql);return {rows:sql.includes('id=ANY')?users:users.filter(user=>user.id===params[0])};}};
  bindDatabaseAuthorityClient(db,pool);
  auth.id=91006;
  const proof=await assertCurrentEditingApprover(db,captured);
  assert.deepEqual(proof,{id:91005,rol:'admin',activo:true,session_version:1});assert.ok(Object.isFrozen(proof));
  assert.match(calls[0],/ORDER BY id FOR SHARE$/);assert.match(calls[1],/WHERE id=\$1 FOR SHARE$/);
  assert.deepEqual(await assertCurrentEditingApprover(db,proof),proof);
  const foreignCalls=[];
  const foreign=bindDatabaseAuthorityClient({async query(sql){foreignCalls.push(sql);return {rows:users};}},{});
  await assert.rejects(assertCurrentEditingApprover(foreign,proof),{status:401});assert.equal(foreignCalls.length,0);
  for(const patch of [{activo:false},{rol:'edicion'},{session_version:2}]) {
    Object.assign(users[0],{activo:true,rol:'admin',session_version:1},patch);calls.length=0;
    await assert.rejects(assertCurrentEditingApprover(db,proof),{status:401});assert.equal(calls.length,1);
  }
  calls.length=0;
  await assert.rejects(assertCurrentEditingApprover(db,{...proof,root_id:91001}),{status:401});assert.equal(calls.length,0);
});

const ID = 'a0000000-0000-4000-8000-000000000001';
const OLD = 'b0000000-0000-4000-8000-000000000002';
const ADMIN = { id: 4, rol: 'admin', activo: true, session_version: 2 };
const task = (change = {}) => ({ id: 8, revision: 6, estado: 'aprobada', tipo_tarea: 'edicion',
  propiedades_extra: { workspace: 'render_os', revision_aprobada: true, revision_aprobada_entrega_id: ID }, ...change });
const delivery = (change = {}) => ({ id: ID, task_id: 8, task_revision: 5, ...change });
const database = rows => ({ calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows }; } });

test('optional expected ID normalizes undefined/null and strict UUID, never forced strings or trim', () => {
  assert.equal(normalizeExpectedEditingDelivery(undefined), null);
  assert.equal(normalizeExpectedEditingDelivery(null), null);
  assert.equal(normalizeExpectedEditingDelivery(ID.toUpperCase()), ID);
  for (const value of ['', 'invalid', ` ${ID}`, `${ID}\n`, `${ID}\0`, {}, 1, [], true]) {
    assert.throws(() => normalizeExpectedEditingDelivery(value), { status: 400 });
  }
});

test('approver revalidates current active admin/session under SHARE and returns closed proof', async () => {
  const db = database([{ ...ADMIN, nombre: 'No authority', password_hash: 'SECRET' }]);
  assert.deepEqual(await assertCurrentEditingApprover(db, ADMIN), ADMIN);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM usuarios WHERE id=\$1 FOR SHARE$/);
  assert.deepEqual(db.calls[0].params, [4]);
});

test('revoked/inactive/mismatched actor or session401, current nonadmin and unknown403', async () => {
  for (const row of [null, { ...ADMIN, id: 5 }, { ...ADMIN, activo: false }, { ...ADMIN, session_version: 3 }, { ...ADMIN, rol: 'edicion' }]) {
    await assert.rejects(assertCurrentEditingApprover(database(row ? [row] : []), ADMIN), { status: 401 });
  }
  for (const rol of ['diseno', 'edicion', 'produccion', 'community', 'programacion', 'unknown']) {
    const user = { ...ADMIN, rol, nombre: 'Administrador' };
    await assert.rejects(assertCurrentEditingApprover(database([user]), user), { status: 403 });
  }
  for (const auth of [null, {}, { ...ADMIN, id: '4' }, { ...ADMIN, session_version: '2' }]) {
    const db = database([ADMIN]);
    await assert.rejects(assertCurrentEditingApprover(db, auth), { status: 401 });
    assert.equal(db.calls.length, 0);
  }
});

test('explicit latest delivery with correct task, post-update revision and effective approval returns canonical ID', async () => {
  const db = database([delivery()]);
  assert.equal(await assertEditingApprovalDelivery(db, task(), ID.toUpperCase()), ID);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].params, [8]);
  assert.match(db.calls[0].sql, /WHERE task_id=\$1 ORDER BY task_revision DESC,recorded_at DESC,id DESC LIMIT 1/);
  assert.doesNotMatch(db.calls[0].sql, /FOR UPDATE|FOR SHARE|pg_advisory|JOIN|INSERT|UPDATE /);
});

test('missing, older and foreign explicit delivery selections409, invalid UUID400', async () => {
  for (const expected of [null, undefined, OLD]) await assert.rejects(assertEditingApprovalDelivery(database([delivery()]), task(), expected), { status: 409 });
  await assert.rejects(assertEditingApprovalDelivery(database([delivery({ task_id: 9 })]), task(), ID), { status: 409 });
  await assert.rejects(assertEditingApprovalDelivery(database([delivery()]), task(), {}), { status: 400 });
});

test('deliberately changed persisted sector/workspace cannot bypass existing delivery history', async () => {
  for (const changed of [task({ tipo_tarea: 'diseno' }), task({ propiedades_extra: { workspace: 'historical', revision_aprobada: true, revision_aprobada_entrega_id: ID } })]) {
    const db = database([delivery()]);
    await assert.rejects(assertEditingApprovalDelivery(db, changed, ID), { status: 409 });
    assert.equal(db.calls.length, 1);
    assert.doesNotMatch(db.calls[0].sql, /tipo_tarea|workspace/);
  }
});

test('archive/trash flags block artifact approval even when latest ID matches', async () => {
  for (const key of ['archivada_render_os', 'papelera_render_os']) {
    for (const value of [true, 'true']) {
      const updated = task(); updated.propiedades_extra[key] = value;
      await assert.rejects(assertEditingApprovalDelivery(database([delivery()]), updated, ID), { status: 409 });
    }
  }
});

test('effective approval after triggers must survive with exact flag and selected binding; never repairs it', async () => {
  for (const change of [{ estado: 'en_revision' }, { estado: 'finalizada' }, { propiedades_extra: null },
    { propiedades_extra: { workspace: 'render_os', revision_aprobada: false, revision_aprobada_entrega_id: ID } },
    { propiedades_extra: { workspace: 'render_os', revision_aprobada: 'true', revision_aprobada_entrega_id: ID } },
    { propiedades_extra: { workspace: 'render_os', revision_aprobada: true, revision_aprobada_entrega_id: null } },
    { propiedades_extra: { workspace: 'render_os', revision_aprobada: true, revision_aprobada_entrega_id: OLD } }]) {
    const db = database([delivery()]);
    await assert.rejects(assertEditingApprovalDelivery(db, task(change), ID), { status: 409 });
    assert.ok(db.calls.every(c => c.sql.startsWith('SELECT')));
  }
});

test('legacy zero-delivery approval returns null, never invents an artifact binding', async () => {
  const legacy = task({ tipo_tarea: 'diseno', propiedades_extra: { workspace: 'render_os', revision_aprobada: true, revision_aprobada_entrega_id: null } });
  assert.equal(await assertEditingApprovalDelivery(database([]), legacy, undefined), null);
  await assert.rejects(assertEditingApprovalDelivery(database([]), legacy, ID), { status: 409 });
  await assert.rejects(assertEditingApprovalDelivery(database([]), task(), undefined), { status: 409 });
  for (const changed of [{ ...legacy, estado: 'en_revision' }, { ...legacy, propiedades_extra: { revision_aprobada: false } }]) {
    await assert.rejects(assertEditingApprovalDelivery(database([]), changed, undefined), { status: 409 });
  }
});

test('malformed or not-yet-post-update revision fails closed without coercion', async () => {
  for (const revision of [0, -1, '6', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(assertEditingApprovalDelivery(database([delivery()]), task({ revision }), ID), { status: 409 });
  }
  for (const task_revision of [0, -1, '5', 6, 7]) {
    await assert.rejects(assertEditingApprovalDelivery(database([delivery({ task_revision })]), task(), ID), { status: 409 });
  }
});

test('database failures propagate unchanged; helpers never own transaction boundaries', async () => {
  const error = Object.assign(new Error('driver fault'), { code: 'P0001' });
  const db = { query: async () => { throw error; } };
  await assert.rejects(assertCurrentEditingApprover(db, ADMIN), e => e === error);
  await assert.rejects(assertEditingApprovalDelivery(db, task(), ID), e => e === error);
});
