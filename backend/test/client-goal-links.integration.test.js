import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import jwt from 'jsonwebtoken';
import { prepareGoal, goalLinkOptions, linkGoalTask, createClientGoalsRouter } from '../src/client-goals.js';
import { runMigrations } from '../src/migrations.js';
import { requireAuthentication } from '../src/auth.js';

test('Vínculo mensual: atomicidad, privacidad, duplicados y conservación de tareas',
  {skip:process.env.RENDER_GOALS_TEST_DATABASE !== 'true' && 'requiere PostgreSQL QA local'}, async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.equal(url.pathname,'/render_goals_qa');
    const pool = new pg.Pool({connectionString:url.toString()}); await runMigrations(pool);
    const suffix = Date.now();
    const user = (await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash)
      VALUES($1,'Vínculos QA','community','QA') RETURNING id`, [`links-${suffix}`])).rows[0];
    const clients = (await pool.query(`INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles,activo)
      VALUES($1,8,4,true),($2,1,0,true) RETURNING id`, [`Vínculos QA ${suffix}`,`Otra QA ${suffix}`])).rows;
    const ids = clients.map(client => client.id);
    const params = {period:'2026-10', key:`cliente-${ids[0]}`, responsibleIds:[user.id], actor:'QA'};
    let server;
    const makeTask = async (title, changes = {}) => (await pool.query(`INSERT INTO tareas
      (titulo,cliente_id,estado,tipo_tarea,subtipo,fecha_vencimiento,asignado_a,propiedades_extra,tarea_padre_id)
      VALUES($1,$2,$3,$4,'reel',$5,'Vínculos QA',$6::jsonb,$7) RETURNING *`,
    [title,changes.client || ids[0],changes.state || 'publicada',changes.type || 'edicion',changes.date || '2026-10-06',
      JSON.stringify({workspace:'render_os',copy_trabajo:'Copy conservado',...changes.metadata}),changes.parent || null])).rows[0];
    const payload = (task, piece) => ({tarea_id:task.id,expected_tarea_updated_at:task.updated_at.toISOString(),
      expected_pieza_updated_at:piece.updated_at.toISOString()});
    try {
      await prepareGoal(pool, params);
      const source = await makeTask('iPhone de ejemplo | Edición reel | Cargadores');
      const opts = await goalLinkOptions(pool, source.id, '2026-10');
      assert.equal(opts.casilleros.length,8); assert.equal(opts.tarea.tipo,'video');
      assert.ok(!JSON.stringify(opts).includes('abono'));
      const [slot,second] = opts.casilleros;
      const planned = (await pool.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy)
        VALUES($1,'video','pendiente','2026-10-06','Reel planificado','Copy de la planificación') RETURNING *`,[ids[0]])).rows[0];
      await pool.query('UPDATE cliente_objetivo_piezas SET publicacion_id=$2 WHERE id=$1',[slot.id,planned.id]);
      const plannedOptions = await goalLinkOptions(pool,source.id,'2026-10');
      assert.ok(plannedOptions.casilleros.some(piece => piece.id===slot.id && piece.publicacion_id===planned.id));
      const snapshots = (await pool.query('SELECT * FROM tareas WHERE id=ANY($1::int[]) ORDER BY id',[[source.id,slot.tarea_id]])).rows;
      await assert.rejects(linkGoalTask(pool,slot.id,{...payload(source,slot),estado:'publicada'},'QA'), {status:400});
      await assert.rejects(linkGoalTask(pool,slot.id,{...payload(source,slot),expected_tarea_updated_at:'2000-01-01'},'QA'), {status:409});
      await assert.rejects(linkGoalTask(pool,slot.id,{...payload(source,slot),expected_pieza_updated_at:'2000-01-01'},'QA'), {status:409});
      for (const task of [await makeTask('Reel otro',{client:ids[1]}),await makeTask('Reel septiembre',{date:'2026-09-01'}),
        await makeTask('Video visita',{type:'produccion'}),await makeTask('Reel privado',{metadata:{workspace:'privado'}})]) {
        await assert.rejects(linkGoalTask(pool,slot.id,payload(task,slot),'QA'));
      }
      const carousel = (await pool.query("SELECT * FROM cliente_objetivo_piezas WHERE objetivo_id=$1 AND tipo='carrusel' LIMIT 1",[opts.objetivo.id])).rows[0];
      await assert.rejects(linkGoalTask(pool,carousel.id,payload(source,carousel),'QA'), {status:400});
      const result = await linkGoalTask(pool,slot.id,payload(source,slot),'QA');
      assert.equal(result.completadas,1); assert.equal(result.total,8);
      assert.deepEqual((await pool.query('SELECT * FROM tareas WHERE id=ANY($1::int[]) ORDER BY id',[[source.id,slot.tarea_id]])).rows,snapshots);
      assert.equal((await pool.query('SELECT reels FROM cliente_objetivos_mensuales WHERE id=$1',[opts.objetivo.id])).rows[0].reels,8);
      assert.equal((await pool.query('SELECT copy FROM cliente_objetivo_piezas WHERE id=$1',[slot.id])).rows[0].copy,'Copy conservado');
      const audit = (await pool.query('SELECT * FROM cliente_objetivo_vinculos WHERE pieza_id=$1',[slot.id])).rows[0];
      assert.equal(audit.tarea_anterior_id,slot.tarea_id); assert.equal(audit.registro_anterior.titulo,slot.titulo);
      assert.equal(audit.registro_anterior.publicacion_id,planned.id);
      assert.deepEqual((await pool.query('SELECT * FROM publicaciones WHERE id=$1',[planned.id])).rows[0],planned);
      assert.equal((await goalLinkOptions(pool,source.id,'2026-10')).vinculo_actual.id,slot.id);
      await assert.rejects(linkGoalTask(pool,second.id,payload(source,second),'QA'),{status:409});
      await pool.query("UPDATE tareas SET estado='publicada' WHERE id=$1",[slot.tarea_id]);
      assert.equal((await pool.query("SELECT count(*)::int n FROM cliente_objetivo_piezas WHERE objetivo_id=$1 AND tipo='video' AND estado='publicada'",[opts.objetivo.id])).rows[0].n,1);
      await pool.query("UPDATE tareas SET estado='en_revision' WHERE id=$1",[source.id]);
      assert.equal((await pool.query('SELECT estado,completada_at FROM cliente_objetivo_piezas WHERE id=$1',[slot.id])).rows[0].completada_at,null);
      await pool.query("UPDATE tareas SET estado='publicada' WHERE id=$1",[source.id]);
      const competing = await makeTask('Reel concurrente');
      const doneSlot = (await pool.query('SELECT * FROM cliente_objetivo_piezas WHERE id=$1',[slot.id])).rows[0];
      await assert.rejects(linkGoalTask(pool,slot.id,payload(competing,doneSlot),'QA'),{status:409});
      await pool.query('UPDATE cliente_objetivo_piezas SET publicacion_id=$2 WHERE id=$1',[second.id,planned.id]);
      await pool.query("UPDATE publicaciones SET estado='publicada' WHERE id=$1",[planned.id]);
      await assert.rejects(linkGoalTask(pool,second.id,payload(competing,second),'QA'),{status:409});
      await pool.query("UPDATE publicaciones SET estado='pendiente' WHERE id=$1",[planned.id]);
      const third = opts.casilleros[2];
      const simultaneous = await Promise.allSettled([linkGoalTask(pool,second.id,payload(competing,second),'QA'),linkGoalTask(pool,third.id,payload(competing,third),'QA')]);
      assert.equal(simultaneous.filter(item => item.status==='fulfilled').length,1);
      const child = await makeTask('Reel edición hija',{parent:source.id});
      const available = (await goalLinkOptions(pool,competing.id,'2026-10')).casilleros[0];
      await assert.rejects(linkGoalTask(pool,available.id,payload(child,available),'QA'), {status:409});
      assert.equal((await prepareGoal(pool,params)).creadas,0);
      assert.equal((await pool.query('SELECT tarea_id FROM cliente_objetivo_piezas WHERE id=$1',[slot.id])).rows[0].tarea_id,source.id);
      await assert.rejects(goalLinkOptions(pool,competing.id,'2026-09'),{status:400});

      process.env.JWT_SECRET='links-qa-only';
      const app=express(); app.use(express.json()); app.use(requireAuthentication); app.use('/api/cliente-objetivos',createClientGoalsRouter({pool}));
      server=app.listen(0,'127.0.0.1'); await new Promise(resolve => server.on('listening',resolve));
      const base=`http://127.0.0.1:${server.address().port}/api/cliente-objetivos`;
      const headers=role=>({Authorization:`Bearer ${jwt.sign({id:user.id,nombre:'QA',rol:role},process.env.JWT_SECRET)}`,'Content-Type':'application/json'});
      assert.equal((await fetch(`${base}/tareas/${source.id}/vinculo?periodo=2026-10`)).status,401);
      assert.equal((await fetch(`${base}/tareas/${source.id}/vinculo?periodo=2026-10`,{headers:headers('diseno')})).status,403);
      assert.equal((await fetch(`${base}/tareas/${source.id}/vinculo?periodo=2026-10`,{headers:headers('community')})).status,200);
      assert.equal((await fetch(`${base}/piezas/${available.id}/vincular`,{method:'POST',headers:headers('diseno'),body:JSON.stringify(payload(competing,available))})).status,403);
    } finally {
      if(server) await new Promise(resolve=>server.close(resolve));
      // Exclusivamente fixtures propios de la base QA local.
      for(const table of ['cliente_objetivo_vinculos','cliente_objetivo_eventos']) await pool.query(`DELETE FROM ${table} WHERE pieza_id IN
        (SELECT p.id FROM cliente_objetivo_piezas p JOIN cliente_objetivos_mensuales o ON o.id=p.objetivo_id WHERE o.cliente_id=ANY($1::int[]))`,[ids]);
      await pool.query('DELETE FROM cliente_objetivo_piezas WHERE objetivo_id IN(SELECT id FROM cliente_objetivos_mensuales WHERE cliente_id=ANY($1::int[]))',[ids]);
      await pool.query('DELETE FROM cliente_objetivos_mensuales WHERE cliente_id=ANY($1::int[])',[ids]);
      await pool.query('DELETE FROM tareas WHERE cliente_id=ANY($1::int[])',[ids]);
      await pool.query('DELETE FROM publicaciones WHERE cliente_id=ANY($1::int[])',[ids]);
      await pool.query('DELETE FROM clientes WHERE id=ANY($1::int[])',[ids]);
      await pool.query('DELETE FROM usuarios WHERE id=$1',[user.id]); await pool.end();
    }
  });
