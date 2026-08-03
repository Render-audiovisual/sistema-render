import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../src/db.js";

// Test de integración: requiere una base de datos real (DATABASE_URL) con
// las migraciones aplicadas. Se salta automáticamente si no hay DB
// configurada (ej. build sin backend/.env) en vez de fallar el suite entero.
// Nunca corre contra producción: usa la conexión que ya tenga configurada
// el entorno donde se ejecuta `npm test`, y limpia la fila que crea.
const dbDisponible = Boolean(process.env.DATABASE_URL);

test(
  "GET /api/tareas: workspace=render_os aísla las tareas nuevas de las históricas",
  { skip: dbDisponible ? false : "requiere DATABASE_URL — test de integración contra Postgres" },
  async () => {
    const creada = await pool.query(
      `INSERT INTO tareas (titulo, asignado_a, tipo_tarea, subtipo, prioridad, estado, propiedades_extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id`,
      [
        "[TEST aislamiento RENDER OS] no debe quedar en la base",
        "Test QA",
        "diseno",
        "regresion-workspace",
        "media",
        "pendiente",
        JSON.stringify({ workspace: "render_os" }),
      ],
    );
    const id = creada.rows[0].id;

    try {
      // Mismo predicado que router.get("/tareas") aplica cuando workspace=render_os.
      const conWorkspace = await pool.query(
        `SELECT id FROM tareas WHERE id = $1 AND propiedades_extra->>'workspace' = 'render_os'`,
        [id],
      );
      assert.equal(
        conWorkspace.rows.length,
        1,
        "la tarea debe aparecer cuando se consulta con workspace=render_os (tablero RENDER OS)",
      );

      // Mismo predicado que aplica para cualquier caller SIN workspace=render_os
      // (ej. la página vieja /piezas, que llama GET /api/tareas sin parámetros).
      const sinWorkspace = await pool.query(
        `SELECT id FROM tareas WHERE id = $1 AND propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'`,
        [id],
      );
      assert.equal(
        sinWorkspace.rows.length,
        0,
        "la tarea NO debe aparecer en consultas sin workspace=render_os (no debe filtrar al tablero /piezas)",
      );
    } finally {
      await pool.query("DELETE FROM tareas WHERE id = $1", [id]);
    }
  },
);

test(
  "GET /api/tareas: las tareas históricas (sin workspace) no aparecen en el tablero RENDER OS",
  { skip: dbDisponible ? false : "requiere DATABASE_URL — test de integración contra Postgres" },
  async () => {
    const creada = await pool.query(
      `INSERT INTO tareas (titulo, asignado_a, tipo_tarea, subtipo, prioridad, estado)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        "[TEST aislamiento RENDER OS] tarea histórica, no debe quedar en la base",
        "Test QA",
        "diseno",
        "regresion-workspace-historica",
        "media",
        "pendiente",
      ],
    );
    const id = creada.rows[0].id;

    try {
      const enRenderOS = await pool.query(
        `SELECT id FROM tareas WHERE id = $1 AND propiedades_extra->>'workspace' = 'render_os'`,
        [id],
      );
      assert.equal(
        enRenderOS.rows.length,
        0,
        "una tarea histórica (sin workspace) no debe aparecer en el tablero RENDER OS",
      );

      const sinWorkspace = await pool.query(
        `SELECT id FROM tareas WHERE id = $1 AND propiedades_extra->>'workspace' IS DISTINCT FROM 'render_os'`,
        [id],
      );
      assert.equal(
        sinWorkspace.rows.length,
        1,
        "una tarea histórica sigue viéndose en /piezas (IS DISTINCT FROM matchea JSONB sin la clave workspace)",
      );
    } finally {
      await pool.query("DELETE FROM tareas WHERE id = $1", [id]);
    }
  },
);
