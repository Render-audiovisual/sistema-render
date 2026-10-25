import assert from "node:assert/strict";
import test from "node:test";
import {
  crearMensajePrivadoTarea,
  destinatariosNuevosDeAsignacion,
  encolarNotificacionPrivadaTarea,
} from "../src/private-task-notifications.js";

test("una reasignación avisa solo a las personas nuevas", () => {
  assert.deepEqual(destinatariosNuevosDeAsignacion({
    asignadoAnterior: "Germán",
    asignadoActual: "Oriana",
    colaboradoresAnteriores: ["Augusto", "Mariano Meza"],
    colaboradoresActuales: ["Augusto", "Mariano Meza", "Luciano", "LUCIANO"],
  }), ["Oriana", "Luciano"]);
});

test("quitar responsables no genera avisos y normaliza acentos", () => {
  assert.deepEqual(destinatariosNuevosDeAsignacion({
    asignadoAnterior: "Germán",
    asignadoActual: "GERMAN",
    colaboradoresAnteriores: ["Oriana", "Augusto"],
    colaboradoresActuales: ["Oriana"],
  }), []);
});

test("editar otros campos no vuelve a notificar responsables existentes", () => {
  assert.deepEqual(destinatariosNuevosDeAsignacion({
    asignadoAnterior: "",
    asignadoActual: "Oriana",
    colaboradoresAnteriores: [],
    colaboradoresActuales: ["Augusto"],
    cambioAsignado: false,
    cambioColaboradores: false,
  }), []);
});

test("arma un aviso privado breve con enlace directo", () => {
  const result = crearMensajePrivadoTarea({
    tarea: { id: 42, titulo: "Carrusel 1", fecha_vencimiento: "2026-09-04", prioridad: "alta" },
    clienteNombre: "Luzin",
    motivo: "comentario",
    detalle: "Oriana: corregir la portada",
  });
  assert.match(result.text, /comentario nuevo/i);
  assert.match(result.text, /Luzin · Carrusel 1/);
  assert.match(result.text, /Oriana: corregir la portada/);
  assert.match(result.text, /workspace\/tareas\?task=42/);
});

test("encola una vez por destinatario, excluye al actor y tolera reintentos", async () => {
  const inserts = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.includes("SELECT id, usuario, nombre FROM usuarios")) {
        assert.match(sql, /activo IS TRUE/);
        return { rows: [
          { id: 2, usuario: "German", nombre: "Germán" },
          { id: 4, usuario: "Oriana", nombre: "Oriana" },
        ] };
      }
      if (sql.includes("SELECT nombre FROM clientes")) return { rows: [{ nombre: "Bohle" }] };
      if (sql.includes("INSERT INTO mia_private_task_notifications")) {
        inserts.push(params);
        return { rows: [{ id: 1, fingerprint: params[0] }] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  const result = await encolarNotificacionPrivadaTarea({
    pool,
    tarea: {
      id: 9, titulo: "Visita", asignado_a: "Germán", cliente_id: 4,
      fecha_vencimiento: "2026-09-02", prioridad: "alta", updated_at: "2026-09-02T12:00:00Z",
      propiedades_extra: { workspace: "render_os", colaboradores: ["Oriana", "GERMÁN"] },
    },
    actor: "Oriana",
  });
  assert.equal(result.encolado, true);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "Germán");
  assert.equal(inserts[0][2], "german");
  assert.deepEqual(JSON.parse(inserts[0][7]), { cliente: 'Bohle', actor: 'Oriana', destinatario_usuario_id: 2 });
});

test('unique legacy recipient persists stable ID and only an explicitly supplied actor ID', async () => {
  for (const actorId of [undefined, 7]) {
    const inserts=[];
    const pool={async query(sql,params){
      if(sql.startsWith('SELECT id, usuario, nombre'))return {rows:[{id:12,usuario:'unique',nombre:'Unique QA'}]};
      if(sql.includes('INSERT INTO mia_private_task_notifications')){inserts.push(params);return {rows:[{id:1,fingerprint:params[0]}]};}
      assert.fail('Unexpected query');
    }};
    await encolarNotificacionPrivadaTarea({pool,tarea:{id:42,titulo:'QA'},nombresDestinatarios:['Unique QA'],actor:'Author QA',actorId});
    assert.equal(inserts.length,1);
    assert.deepEqual(JSON.parse(inserts[0][7]),{cliente:null,actor:'Author QA',destinatario_usuario_id:12,...(actorId===undefined?{}:{actor_usuario_id:7})});
  }
});

test("receipt notifications bind recipient/actor IDs despite homonyms and leader aliases", async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id,usuario,nombre')) {
      assert.deepEqual(params, [[11, 12]]);
      return { rows: [{ id: 11, usuario: 'qa_actor', nombre: 'Agustín' }, { id: 12, usuario: 'qa_other', nombre: 'Agustín' }] };
    }
    if (sql.includes('INSERT INTO mia_private_task_notifications')) return { rows: [{ id: 1, fingerprint: params[0] }] };
    throw new Error('Unexpected query');
  } };
  const result = await encolarNotificacionPrivadaTarea({ pool, tarea: { id: 99, revision: 4, titulo: 'QA' },
    actor: 'Agustín', actorId: 11, destinatarioIds: [11, 12, 12], nombresDestinatarios: ['líder'] });
  assert.equal(result.encolado, true);
  const inserts = calls.filter(call => call.sql.includes('INSERT INTO'));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[2], 'qa_other');
  assert.equal(JSON.parse(inserts[0].params[7]).destinatario_usuario_id, 12);
  assert.equal(JSON.parse(inserts[0].params[7]).actor_usuario_id, 11);
  assert.ok(!calls.some(call => call.sql === 'SELECT id, usuario, nombre FROM usuarios WHERE activo IS TRUE'));
});

test("receipt notifications reject malformed identity selections before querying and propagate queue faults", async () => {
  let calls = 0;
  const pool = { async query(sql) {
    calls++;
    if (sql.startsWith('SELECT id,usuario,nombre')) return { rows: [{ id: 2, usuario: 'qa', nombre: 'QA' }] };
    throw new Error('QA queue fault');
  } };
  for (const selected of [[0], ['2'], null, {}]) {
    await assert.rejects(encolarNotificacionPrivadaTarea({ pool, tarea: { id: 1 }, destinatarioIds: selected, actorId: 1 }), { status: 400 });
  }
  await assert.rejects(encolarNotificacionPrivadaTarea({ pool, tarea: { id: 1 }, destinatarioIds: [2] }), { status: 400 });
  assert.equal(calls, 0);
  await assert.rejects(encolarNotificacionPrivadaTarea({ pool, tarea: { id: 1 }, destinatarioIds: [2], actorId: 1 }), /QA queue fault/);
});
