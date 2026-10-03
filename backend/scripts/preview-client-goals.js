// Vista local con datos ficticios. Nunca conectar este script a producción.
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { runMigrations } from '../src/migrations.js';
import { prepareGoal } from '../src/client-goals.js';

const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/render_goals_qa') {
  throw new Error('La vista de ejemplo requiere una base local llamada render_goals_qa.');
}
process.env.RENDER_DISABLE_SERVER_START = 'true';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'local-client-goals-preview-only-not-a-production-secret';
process.env.MIA_SUPERVISOR_ENABLED = 'false';
process.env.TASK_COMPLETED_CLEANUP_ENABLED = 'false';
process.env.TASK_NOTIFICATION_CHANNEL = 'whatsapp';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await runMigrations(pool);
const existing = await pool.query("SELECT id FROM usuarios WHERE usuario='community-demo'");
if (!existing.rows.length) {
  const password = await bcrypt.hash('VistaLocal2026!', 10);
  const user = await pool.query(`INSERT INTO usuarios(usuario,nombre,rol,password_hash)
    VALUES('community-demo','Community de ejemplo','community',$1),('diseno-demo','Diseño de ejemplo','diseno',$1)
    RETURNING id,nombre`, [password]);
  for (const [name, reels, carousels] of [['Búnker Training', 4, 2], ['Pope Burger JR', 3, 2], ['El Ángel Azul', 4, 3]]) {
    const client = await pool.query('INSERT INTO clientes(nombre,cuota_reels,cuota_carruseles,activo) VALUES($1,$2,$3,true) RETURNING id', [name, reels, carousels]);
    const id = client.rows[0].id;
    if (name === 'Búnker Training') {
      for (let index = 1; index <= 2; index++) {
        await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,cliente_id,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
          VALUES($1,'Community de ejemplo','publicada',$2,'edicion','reel','2026-10-02','{"workspace":"render_os"}')`, [`Reel ${index} · Entrenamiento`, id]);
      }
      const publication = await pool.query(`INSERT INTO publicaciones(cliente_id,tipo,estado,fecha_programada,idea,copy)
        VALUES($1,'carrusel','publicada','2026-10-02','Entrenar acompañado cambia todo',$2) RETURNING id`,
      [id, 'La constancia se construye en equipo.\n\nEncontrá un espacio para entrenar, compartir y avanzar a tu ritmo.\n\nEscribinos y conocé nuestras clases.']);
      await pool.query(`INSERT INTO tareas(titulo,asignado_a,estado,cliente_id,publicacion_id,tipo_tarea,subtipo,fecha_vencimiento,propiedades_extra)
        VALUES('Entrenar acompañado cambia todo','Community de ejemplo','publicada',$1,$2,'diseno','carrusel','2026-10-02','{"workspace":"render_os"}')`, [id, publication.rows[0].id]);
    }
    await prepareGoal(pool, { period: '2026-10', key: `cliente-${id}`, responsibleIds: user.rows.map(row => row.id), actor: 'Vista local' });
  }
}
await pool.end();
const { app } = await import('../src/server.js');
app.listen(3007, '127.0.0.1', () => console.log('Vista local con datos ficticios: http://127.0.0.1:3007/clientes?periodo=2026-10'));
