import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { createClientGoalsRouter, prepareGoal, readGoals, reconcileMonthlyGoals, inheritedGoalResponsibles } from '../src/client-goals.js';
import { runMigrations } from '../src/migrations.js';
import { requireAuthentication } from '../src/auth.js';

const enabled = process.env.RENDER_GOALS_TEST_DATABASE === 'true';
test('PostgreSQL: objetivos reales, privacidad, concurrencia, cambios y conservación', { skip: !enabled && 'requiere PostgreSQL QA local' }, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.pathname, '/render_goals_qa');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await runMigrations(pool);
  // Refresca sólo las funciones de la migración aún no publicada, en QA local.
  const migration = readFileSync(new URL('../migrations/048_cliente_objetivos_mensuales.sql', import.meta.url), 'utf8');
  for (const [sql] of migration.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?END \$\$;/g)) await pool.query(sql);
  const suffix = Date.now();
  const user = (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash) VALUES($1,'Responsable QA','community','hash-local') RETURNING id`, [`qa-${suffix}`])).rows[0];
  const client = (await pool.query(`INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles,activo) VALUES($1,4,2,true) RETURNING id`, [`Marca QA ${suffix}`])).rows[0];
  const clientKey = `cliente-${client.id}`;
  const params = { period: '2026-10', key: clientKey, responsibleIds: [user.id], actor: 'QA', persistResponsibles:true };
  let server;
  try {
    // Una tarea de septiembre jamás ocupa una casilla del objetivo de octubre.
    await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,cliente_id,tipo_tarea,fecha_vencimiento,propiedades_extra)
      VALUES('Reel anterior','Responsable QA','publicada',$1,'edicion','2026-09-05','{"workspace":"render_os"}')`, [client.id]);
    const publication = (await pool.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy)
      VALUES($1,'carrusel','pendiente','2026-10-02','Carrusel existente','Copy original') RETURNING id`, [client.id])).rows[0];
    await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,cliente_id,publicacion_id,tipo_tarea,fecha_vencimiento,propiedades_extra)
      VALUES('Carrusel existente','Responsable QA','pendiente',$1,$2,'diseno','2026-10-02','{"workspace":"render_os","copy_trabajo":""}')`, [client.id, publication.id]);
    const first = await Promise.all([prepareGoal(pool, params), prepareGoal(pool, params)]);
    assert.equal(first.reduce((sum, result) => sum + result.creadas, 0), 5);
    assert.equal(first.reduce((sum, result) => sum + result.vinculadas, 0), 1);
    let goal = (await readGoals(pool, '2026-10')).clientes.find(item => item.clave === clientKey);
    assert.equal(goal.piezas.length, 6); assert.equal(goal.piezas.filter(piece => piece.estado === 'publicada').length, 0);
    assert.ok(!JSON.stringify(goal).includes('abono'));
    const piece = goal.piezas.find(item => item.tipo === 'carrusel');
    assert.equal(piece.copy, 'Copy original');
    await pool.query(`UPDATE publicaciones SET copy='Copy más reciente' WHERE id=$1`, [publication.id]);
    await pool.query(`UPDATE tareas SET estado='publicada',fecha_vencimiento='2026-11-03' WHERE id=$1`, [piece.tarea_id]);
    assert.equal((await pool.query('SELECT copy FROM cliente_objetivo_piezas WHERE id=$1', [piece.id])).rows[0].copy, 'Copy más reciente');
    await pool.query(`UPDATE tareas SET estado='publicada',titulo='Carrusel con título',
      propiedades_extra=propiedades_extra || '{"copy_trabajo":"Copy persistente"}'::jsonb WHERE id=$1`, [piece.tarea_id]);
    await pool.query(`UPDATE tareas SET estado='publicada' WHERE id=$1`, [piece.tarea_id]);
    goal = (await readGoals(pool, '2026-10')).clientes.find(item => item.clave === clientKey);
    assert.equal(goal.piezas.filter(item => item.estado === 'publicada').length, 1);
    assert.equal(goal.piezas.find(item => item.id === piece.id).copy, 'Copy persistente');
    await pool.query(`UPDATE tareas SET estado='en_revision' WHERE id=$1`, [piece.tarea_id]);
    let stored = (await pool.query('SELECT * FROM cliente_objetivo_piezas WHERE id=$1', [piece.id])).rows[0];
    assert.equal(stored.completada_at, null); assert.equal(stored.estado, 'en_revision');
    assert.equal((await pool.query('SELECT estado FROM publicaciones WHERE id=$1', [publication.id])).rows[0].estado, 'pendiente');
    assert.equal((await pool.query('SELECT count(*)::int n FROM cliente_objetivo_eventos WHERE pieza_id=$1', [piece.id])).rows[0].n, 2);
    await pool.query(`UPDATE tareas SET estado='publicada' WHERE id=$1`, [piece.tarea_id]);
    await pool.query('DELETE FROM tareas WHERE id=$1', [piece.tarea_id]);
    stored = (await pool.query('SELECT * FROM cliente_objetivo_piezas WHERE id=$1', [piece.id])).rows[0];
    assert.equal(stored.estado, 'publicada'); assert.equal(stored.copy, 'Copy persistente'); assert.equal(stored.tarea_id, null);
    assert.equal((await prepareGoal(pool, params)).creadas, 0);
    assert.equal((await readGoals(pool, '2026-11')).clientes.find(item => item.clave === clientKey).piezas.length, 0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM tareas WHERE cliente_id=$1 AND titulo='Reel anterior'", [client.id])).rows[0].n, 1);
    const assignment = await inheritedGoalResponsibles(pool, {clave:clientKey,cuentas:[{id:client.id}]}, '2026-11');
    assert.deepEqual(assignment.video.map(person => person.id), [user.id]);
    const automatic = await Promise.all([reconcileMonthlyGoals(pool,'2026-11'),reconcileMonthlyGoals(pool,'2026-11')]);
    assert.ok(automatic.reduce((sum,row) => sum+row.creadas,0) >= 6);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM tareas WHERE cliente_id=$1 AND propiedades_extra->>'objetivo_periodo'='2026-11'`,[client.id])).rows[0].n,6);
    assert.equal((await readGoals(pool,'2026-11')).clientes.find(item => item.clave === clientKey).piezas.length, 6);
    assert.equal((await reconcileMonthlyGoals(pool,'2026-11')).creadas, 0);
    await pool.query('UPDATE clientes SET cuota_reels=7 WHERE id=$1', [client.id]);
    assert.equal((await readGoals(pool, '2026-10')).clientes.find(item => item.clave === clientKey).reels, 4);

    process.env.JWT_SECRET = 'qa-client-goals-only';
    const app = express(); app.use(express.json()); app.use(requireAuthentication); app.use('/api/cliente-objetivos', createClientGoalsRouter({ pool }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/cliente-objetivos`;
    assert.equal((await fetch(`${base}?periodo=2026-10`)).status, 401);
    const headers = { Authorization: `Bearer ${jwt.sign({ id: user.id, nombre: 'QA', rol: 'diseno' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
    const response = await fetch(`${base}?periodo=2026-10`, { headers }); assert.equal(response.status, 200);
    assert.ok(!JSON.stringify(await response.json()).includes('abono'));
    assert.equal((await fetch(`${base}/preparar`, { method:'POST', headers, body:JSON.stringify({ periodo:'2026-10',clave:clientKey,responsables:[user.id] }) })).status, 403);
    const editable = goal.piezas.find(item => item.tarea_id);
    const version = (await pool.query('SELECT updated_at FROM tareas WHERE id=$1',[editable.tarea_id])).rows[0].updated_at.toISOString();
    const contentUrl = `${base}/piezas/${editable.id}/contenido`;
    const contentBody = {titulo:'Título del equipo',copy:'Copy editado por un integrante no asignado',expected_updated_at:version};
    assert.equal((await fetch(contentUrl,{method:'PATCH',headers,body:JSON.stringify(contentBody)})).status,200);
    const after = (await pool.query('SELECT titulo,asignado_a,estado FROM tareas WHERE id=$1',[editable.tarea_id])).rows[0];
    assert.equal(after.titulo,contentBody.titulo); assert.equal(after.asignado_a,'Responsable QA');
    assert.equal((await fetch(contentUrl,{method:'PATCH',headers,body:JSON.stringify({...contentBody,expected_updated_at:'2000-01-01T00:00:00.000Z'})})).status,409);
    assert.equal((await fetch(contentUrl,{method:'PATCH',headers,body:JSON.stringify({...contentBody,estado:'publicada'})})).status,400);
    assert.equal((await fetch(contentUrl,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(contentBody)})).status,401);
    assert.equal((await fetch(`${base}/piezas/999999999/contenido`,{method:'PATCH',headers,body:JSON.stringify(contentBody)})).status,404);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Sólo elimina los registros ficticios propios de esta prueba local.
    try {
      await pool.query('DELETE FROM cliente_objetivo_eventos WHERE pieza_id IN (SELECT p.id FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id WHERE o.cliente_id=$1)', [client.id]);
      await pool.query('DELETE FROM cliente_objetivo_piezas WHERE objetivo_id IN (SELECT id FROM cliente_objetivos_mensuales WHERE cliente_id=$1)', [client.id]);
      await pool.query('DELETE FROM cliente_objetivos_mensuales WHERE cliente_id=$1', [client.id]);
      await pool.query('DELETE FROM tareas WHERE cliente_id=$1', [client.id]);
      await pool.query('DELETE FROM publicaciones WHERE cliente_id=$1', [client.id]);
      await pool.query('DELETE FROM clientes WHERE id=$1', [client.id]);
      await pool.query('DELETE FROM cliente_objetivo_responsables WHERE clave=$1', [clientKey]);
      await pool.query('DELETE FROM usuarios WHERE id=$1', [user.id]);
    } finally { await pool.end(); }
  }
});

test('PostgreSQL: feed compartido, formato heredado y cliente sin asignación', {skip:!enabled && 'requiere PostgreSQL QA local'}, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.equal(url.pathname,'/render_goals_qa');
  const pool = new pg.Pool({connectionString:url.toString()});
  const suffix = Date.now();
  const user = (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash) VALUES($1,$2,'edicion','QA') RETURNING id`,[`feed-qa-${suffix}`,`Editor QA ${suffix}`])).rows[0];
  const group = (await pool.query(`INSERT INTO grupos_feed(nombre,cuota_reels,cuota_carruseles) VALUES($1,1,1) RETURNING id`,[`Feed QA ${suffix}`])).rows[0];
  const clients = (await pool.query(`INSERT INTO clientes(nombre,grupo_feed_id,activo,cuota_reels,cuota_carruseles)
    VALUES($1,$3,true,0,0),($2,$3,true,0,0) RETURNING id`,[`Cuenta A QA ${suffix}`,`Cuenta B QA ${suffix}`,group.id])).rows;
  const missing = (await pool.query(`INSERT INTO clientes(nombre,activo,cuota_reels,cuota_carruseles) VALUES($1,true,1,0) RETURNING id`,[`Sin asignación QA ${suffix}`])).rows[0];
  const ids = [...clients.map(client => client.id),missing.id];
  const accountUsers = (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash)
    VALUES($1,$2,'community','QA'),($3,$4,'diseno','QA') RETURNING id,nombre`,
  [`account-a-qa-${suffix}`,`Equipo A QA ${suffix}`,`account-b-qa-${suffix}`,`Equipo B QA ${suffix}`])).rows;
  try {
    const publication = (await pool.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy)
      VALUES($1,'carrusel','pendiente','2026-10-04','Pieza cuenta B','Copy B') RETURNING id`,[clients[1].id])).rows[0];
    await prepareGoal(pool,{period:'2026-10',key:`grupo-${group.id}`,responsibleIds:[user.id],persistResponsibles:true,actor:'QA'});
    const shared = (await readGoals(pool,'2026-10')).clientes.find(client => client.clave === `grupo-${group.id}`);
    assert.equal(shared.cuentas.length,2); assert.equal(shared.piezas.length,2);
    const piece = shared.piezas.find(piece => piece.publicacion_id === publication.id);
    assert.equal((await pool.query('SELECT cliente_id FROM tareas WHERE id=$1',[piece.tarea_id])).rows[0].cliente_id,clients[1].id);
    const next = await reconcileMonthlyGoals(pool,'2026-11');
    assert.ok(next.pendientes.some(client => client.clave === `cliente-${missing.id}`));
    const november = (await readGoals(pool,'2026-11')).clientes.find(client => client.clave === `grupo-${group.id}`);
    assert.equal(november.piezas.length,2); assert.ok(november.piezas.every(piece => piece.responsables.includes(`Editor QA ${suffix}`)));
    assert.equal((await readGoals(pool,'2026-11')).clientes.find(client => client.clave === `cliente-${missing.id}`).preparado,false);
    const before = (await pool.query('SELECT * FROM tareas WHERE cliente_id=ANY($1::int[]) ORDER BY id',[clients.map(client => client.id)])).rows;
    const settings = {period:'2026-10',key:`grupo-${group.id}`,responsibleIds:[user.id,...accountUsers.map(person => person.id)],
      responsibleByType:{video:[user.id],carrusel:accountUsers.map(person => person.id)},
      responsibleByAccount:{[clients[0].id]:[accountUsers[0].id],[clients[1].id]:[accountUsers[1].id]},persistResponsibles:true,actor:'QA'};
    for (const responsibleByAccount of [{[clients[0].id]:[user.id]}, {[clients[0].id]:[user.id],[missing.id]:[user.id]}]) {
      await assert.rejects(prepareGoal(pool,{...settings,responsibleByAccount}), /objetivo compartido/);
    }
    assert.equal((await prepareGoal(pool,settings)).creadas,0);
    assert.deepEqual((await pool.query('SELECT * FROM tareas WHERE cliente_id=ANY($1::int[]) ORDER BY id',[clients.map(client => client.id)])).rows,before);
    const configured = (await readGoals(pool,'2026-10')).clientes.find(client => client.clave === settings.key);
    assert.deepEqual(configured.responsables_por_cuenta[clients[0].id], [accountUsers[0]]);
    assert.deepEqual(configured.responsables_por_cuenta[clients[1].id], [accountUsers[1]]);
    assert.equal(configured.reels,1); assert.equal(configured.carruseles,1);
    const accountBPublication = (await pool.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea)
      VALUES($1,'carrusel','pendiente','2026-12-04','Cuenta B diciembre') RETURNING id`,[clients[1].id])).rows[0];
    await Promise.all([reconcileMonthlyGoals(pool,'2026-12'),reconcileMonthlyGoals(pool,'2026-12')]);
    const december = (await readGoals(pool,'2026-12')).clientes.find(client => client.clave === settings.key);
    assert.equal(december.piezas.length,2);
    assert.deepEqual(december.piezas.find(piece => piece.publicacion_id === accountBPublication.id).responsables,[accountUsers[1].nombre]);
    assert.deepEqual(december.piezas.find(piece => piece.tipo === 'video').responsables,[`Editor QA ${suffix}`]);
    await reconcileMonthlyGoals(pool,'2027-01');
    const january = (await readGoals(pool,'2027-01')).clientes.find(client => client.clave === settings.key);
    assert.equal(january.piezas.length,2);
    assert.deepEqual(january.piezas.find(piece => piece.tipo === 'carrusel').responsables,[accountUsers[0].nombre]);
    assert.deepEqual(january.responsables_por_cuenta,configured.responsables_por_cuenta);
  } finally {
    await pool.query('DELETE FROM cliente_objetivo_eventos WHERE pieza_id IN(SELECT p.id FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id WHERE o.cliente_id=ANY($1::int[]))',[ids]);
    await pool.query('DELETE FROM cliente_objetivo_piezas WHERE objetivo_id IN(SELECT id FROM cliente_objetivos_mensuales WHERE cliente_id=ANY($1::int[]))',[ids]);
    await pool.query('DELETE FROM cliente_objetivos_mensuales WHERE cliente_id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM cliente_objetivo_responsables WHERE clave=$1',[`grupo-${group.id}`]);
    await pool.query('DELETE FROM cliente_objetivo_responsables WHERE clave=ANY($1::text[])',[clients.map(client => `cliente-${client.id}`)]);
    await pool.query('DELETE FROM tareas WHERE cliente_id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM publicaciones WHERE cliente_id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM clientes WHERE id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM grupos_feed WHERE id=$1',[group.id]);
    await pool.query('DELETE FROM usuarios WHERE id=ANY($1::int[])',[[user.id,...accountUsers.map(person => person.id)]]); await pool.end();
  }
});
