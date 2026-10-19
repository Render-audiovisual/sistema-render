import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveWilsonTaskAssignmentWrite } from "../src/wilson-integration.js";
import { replaceTaskAssignments } from "../src/task-assignments.js";

function database(users, memberships = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT tarea_id, usuario_id, tipo")) return { rows: memberships };
      if (sql.includes("SELECT id, nombre, activo")) {
        const [ids, names] = params;
        return { rows: users.filter(user => ids.includes(user.id) || names.includes(user.nombre)) };
      }
      if (/^(DELETE FROM|INSERT INTO) tarea_asignaciones/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected unit query: ${sql}`);
    },
  };
}
const users = [
  { id: 11, nombre: "Persona seleccionada", activo: true },
  { id: 22, nombre: "Colaborador renombrado", activo: true },
  { id: 33, nombre: "Nueva selección", activo: true },
];
const current = { id: 100, asignado_a: "Nombre histórico", propiedades_extra: { colaboradores: ["Etiqueta obsoleta"] } };
const normalized = { asignado_a: users[0].nombre, colaboradores: [users[1].nombre] };

test("new confirmed task resolves unique active selections and persists IDs on the supplied client", async () => {
  const db = database(users);
  const assignment = await resolveWilsonTaskAssignmentWrite(db, {}, normalized);
  assert.equal(assignment.ownerId, 11);
  assert.deepEqual(assignment.collaboratorIds, [22]);
  await replaceTaskAssignments(db, 100, assignment);
  assert.deepEqual(db.calls.at(-1).params, [100, [11, 22], ["responsable", "colaborador"]]);
  assert.equal(db.calls.some(call => /BEGIN|COMMIT/.test(call.sql)), false);
});

test("write boundary rejects absent, inactive and ambiguous selected names", async () => {
  for (const records of [[], [{ ...users[0], activo: false }], [users[0], { ...users[0], id: 99 }]]) {
    const db = database(records);
    await assert.rejects(resolveWilsonTaskAssignmentWrite(db, {}, { asignado_a: users[0].nombre, colaboradores: [] }), /desconocida, inactiva o ambigua/);
    assert.equal(db.calls.some(call => /DELETE|INSERT/.test(call.sql)), false);
  }
  await assert.rejects(resolveWilsonTaskAssignmentWrite(database(users), {}, {
    asignado_a: users[0].nombre, colaboradores: ["No existe"],
  }), /desconocida/);
});

test("content-only PATCH never reads or reconstructs assignment IDs from legacy labels", async () => {
  const db = database([]);
  assert.equal(await resolveWilsonTaskAssignmentWrite(db, { titulo: "Nuevo", descripcion: "Contenido" }, normalized, current), null);
  assert.deepEqual(db.calls, []);
});

test("owner-only PATCH preserves collaborators by stable ID despite renamed display labels", async () => {
  const db = database(users, [{ tarea_id: 100, usuario_id: 22, tipo: "colaborador" }]);
  const assignment = await resolveWilsonTaskAssignmentWrite(db, { responsable: users[2].nombre }, {
    asignado_a: users[2].nombre, colaboradores: ["Etiqueta obsoleta"],
  }, current);
  assert.equal(assignment.ownerId, 33);
  assert.deepEqual(assignment.collaboratorIds, [22]);
  assert.deepEqual(db.calls[1].params, [[], [users[2].nombre]]);
});

test("collaborator-only PATCH preserves owner ID and clears collaborators explicitly", async () => {
  const db = database(users, [
    { tarea_id: 100, usuario_id: 11, tipo: "responsable" },
    { tarea_id: 100, usuario_id: 22, tipo: "colaborador" },
  ]);
  const assignment = await resolveWilsonTaskAssignmentWrite(db, { colaboradores: [] }, {
    asignado_a: "Nombre histórico", colaboradores: [],
  }, current);
  assert.equal(assignment.ownerId, 11);
  assert.deepEqual(assignment.collaboratorIds, []);
  assert.equal(db.calls.length, 1); // Only membership read: untouched owner is not reselected.
});

test("partial legacy reassignment does not backfill the untouched owner or collaborators", async () => {
  const db = database(users);
  const collaboratorOnly = await resolveWilsonTaskAssignmentWrite(db, { colaboradores: [users[2].nombre] }, {
    asignado_a: "Nombre histórico", colaboradores: [users[2].nombre],
  }, current);
  assert.equal(collaboratorOnly.ownerId, null);
  assert.deepEqual(collaboratorOnly.collaboratorIds, [33]);
  const ownerOnly = await resolveWilsonTaskAssignmentWrite(db, { asignado_a: users[0].nombre }, normalized, current);
  assert.equal(ownerOnly.ownerId, 11);
  assert.deepEqual(ownerOnly.collaboratorIds, []);
});

test("explicit full selection replaces membership and deduplicates selected IDs", async () => {
  const db = database(users);
  const assignment = await resolveWilsonTaskAssignmentWrite(db, { responsables: [users[0].nombre, users[2].nombre] }, {
    asignado_a: users[0].nombre, colaboradores: [users[2].nombre, users[2].nombre, users[0].nombre],
  }, current);
  assert.equal(assignment.ownerId, 11);
  assert.deepEqual(assignment.collaboratorIds, [33]);
});

test("route wiring keeps confirmation, locking, atomic assignment writes and rollback hooks", () => {
  const source = readFileSync(new URL("../src/wilson-integration.js", import.meta.url), "utf8");
  const start = source.indexOf('async function executeTaskReceiptOperation(');
  const end = source.indexOf('  router.post("/tareas",', start);
  assert.ok(start >= 0 && end > start, 'shared receipt mutator must exist');
  const mutator = source.slice(start, end);
  assert.match(source, /router\.post\("\/tareas",\(req,res,next\)=>executeTaskReceiptOperation\(req,res,next,'crear'\)\)/);
  assert.match(source, /router\.patch\("\/tareas\/:id",\(req,res,next\)=>executeTaskReceiptOperation\(req,res,next,'editar'\)\)/);
  assert.match(mutator, /await client.query\('BEGIN'\)/);
  assert.match(mutator, /if\(client\)await client.query\('ROLLBACK'\).catch\(\(\)=>\{\}\)/);
  assert.match(mutator, /finally \{client\?\.release\(\);\}/);
  const ordered = ["await client.query('BEGIN')", 'await lockTaskOperationActor(', 'await findTaskOperationReceipt(',
    'const current=await prepareTaskOperationTarget(', 'await prepareWilsonTaskOperation(', 'await consumeTaskOperationConfirmation(',
    'INSERT INTO tareas', 'await replaceTaskAssignments(client,task.id,prepared.assignment)',
    'await writeWilsonAudit(', 'await insertTaskOperationReceipt('];
  let previous = -1;
  for (const fragment of ordered) {
    const position = mutator.indexOf(fragment);
    assert.ok(position > previous, `${fragment} must occur in transaction order`);
    previous = position;
  }
  assert.ok(mutator.indexOf("await client.query('COMMIT')", previous) > previous, 'mutation receipt commits after assignment and audit');
  assert.ok(mutator.indexOf('if(prior)') < mutator.indexOf('await prepareWilsonTaskOperation('), 'exact replay precedes new selection resolution');
  const editStart = mutator.indexOf("} else if(operation==='editar')");
  const editEnd = mutator.indexOf("} else if(operation==='archivar')", editStart);
  assert.ok(editStart > 0 && editEnd > editStart);
  const edit = mutator.slice(editStart, editEnd);
  assert.match(edit, /if\(changedFields.length\) \{/);
  assert.match(edit, /WHERE id=\$1 AND revision=\$12 RETURNING/);
  assert.match(edit, /if\(prepared.assignment\)await replaceTaskAssignments\(client,task.id,prepared.assignment\)/);
  assert.ok(edit.indexOf('UPDATE tareas') < edit.indexOf('await replaceTaskAssignments('));
  assert.match(source, /await lockTaskOperationResources\(db,intent.target_id\);\s*const task=await lockTaskOperationRow\(db,intent.target_id\)/);
  assert.match(source, /task.revision!==intent.expected_revision/);
  assert.match(source, /const ownerId=ownerSelected\?resolved.ownerId:current.asignado_a_id/);
  assert.match(source, /collaboratorsSelected\?resolved.collaboratorIds:\(current\?\.colaborador_ids\?\?\[\]\)/);
  assert.doesNotMatch(mutator, /INSERT INTO tarea_comentarios/);
});
