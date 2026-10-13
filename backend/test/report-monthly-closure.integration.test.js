import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

test('PostgreSQL: cierre idempotente de tres usuarios, septiembre solamente, sin alterar datos fuente',
  { skip: process.env.RENDER_GOALS_TEST_DATABASE !== 'true' && 'requiere PostgreSQL QA local' }, async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/render_goals_qa');
    const pool = new pg.Pool({ connectionString: url.toString() });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Todo se crea en un esquema efímero y se revierte incluso si falla el test.
      const schema = `report_closure_qa_${process.pid}_${Date.now()}`;
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query(`CREATE TABLE usuarios(id INTEGER PRIMARY KEY, usuario TEXT UNIQUE, nombre TEXT, rol TEXT);
        INSERT INTO usuarios VALUES (11,'oriana','Oriana','community'),(12,'augusto','Augusto','diseno'),
          (13,'mariano','Mariano Meza','diseno'),(14,'agustin','Agustín','admin'),(15,'luciano','Luciano','edicion');
        CREATE TABLE tareas(id INTEGER, estado TEXT, fecha DATE);
        INSERT INTO tareas VALUES (1,'pendiente','2026-09-12'),(2,'en_progreso','2026-10-13');
        CREATE TABLE publicaciones(id INTEGER, estado TEXT);
        INSERT INTO publicaciones VALUES(1,'pendiente');
        CREATE TABLE entregas_edicion(id INTEGER, importe INTEGER);
        INSERT INTO entregas_edicion VALUES(1,12500);`);
      const before = {};
      for (const table of ['usuarios', 'tareas', 'publicaciones', 'entregas_edicion']) before[table] = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      const sql = readFileSync(new URL('../migrations/054_cierre_reportes_septiembre_2026.sql', import.meta.url), 'utf8');
      await client.query(sql);
      await client.query(sql);
      const result = (await client.query("SELECT usuario_id,to_char(periodo,'YYYY-MM') AS periodo,porcentaje,motivo,autorizado_por FROM reporte_cierres_mensuales ORDER BY usuario_id")).rows;
      assert.deepEqual(result.map(row => [row.usuario_id, row.periodo, row.porcentaje]), [[11,'2026-09',100],[12,'2026-09',100],[13,'2026-09',100]]);
      assert.ok(result.every(row => row.motivo && row.autorizado_por));
      assert.equal((await client.query("SELECT count(*)::int n FROM reporte_cierres_mensuales WHERE periodo='2026-10-01'")).rows[0].n, 0);
      for (const table of Object.keys(before)) assert.deepEqual((await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows, before[table]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
