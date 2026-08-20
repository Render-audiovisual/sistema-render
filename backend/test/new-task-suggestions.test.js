import assert from "node:assert/strict";
import test from "node:test";

import {
  getNewTaskSuggestions,
  getTaskDirectUrl,
  inferClientFromTaskTitle,
} from "../../frontend/src/features/render-os/utils/new-task-suggestions.js";

const clients = [
  { id: 1, nombre: "iPhone Shop" },
  { id: 2, nombre: "Lavalle Market" },
  { id: 3, nombre: "Lavalle Hortícola" },
  { id: 4, nombre: "Bendita Burger" },
];

const users = [
  { id: 1, nombre: "Luciano", usuario: "luciano", rol: "usuario" },
  { id: 2, nombre: "Líder", usuario: "lider", rol: "admin" },
  { id: 3, nombre: "Augusto Aguirre", usuario: "augusto", rol: "usuario" },
  { id: 4, nombre: "Mariano Meza", usuario: "mariano", rol: "usuario" },
  { id: 5, nombre: "Germán Beltzer", usuario: "german", rol: "usuario" },
  { id: 6, nombre: "Oriana", usuario: "oriana", rol: "usuario" },
];

test("detecta el cliente escrito en el título sin confundir nombres parecidos", () => {
  assert.equal(inferClientFromTaskTitle("Lavalle Market | Carrusel 1", clients)?.id, 2);
  assert.equal(inferClientFromTaskTitle("Lavalle Hortícola | Historia", clients)?.id, 3);
  assert.equal(inferClientFromTaskTitle("Trabajo sin cliente", clients), null);
});

test("una edición de video sugiere Luciano y Líder sin impedir cambios manuales", () => {
  const suggestion = getNewTaskSuggestions({ title: "iPhone Shop | Editar reel de lanzamiento", clients, users });
  assert.equal(suggestion.client?.id, 1);
  assert.equal(suggestion.primary, "Luciano");
  assert.deepEqual(suggestion.collaborators, ["Líder"]);
  assert.equal(suggestion.tipo_tarea, "edicion");
  assert.equal(suggestion.subtipo, "reel");
});

test("carruseles, historias y diseños respetan el diseñador definido para cada cliente", () => {
  const mariano = getNewTaskSuggestions({ title: "iPhone Shop | Carrusel de ofertas", clients, users });
  assert.equal(mariano.primary, "Mariano Meza");
  assert.deepEqual(mariano.collaborators, ["Oriana"]);
  assert.equal(mariano.tipo_tarea, "diseno");
  assert.equal(mariano.subtipo, "carrusel");

  const augusto = getNewTaskSuggestions({ title: "Bendita Burger | Historia del día", clients, users });
  assert.equal(augusto.primary, "Augusto Aguirre");
  assert.deepEqual(augusto.collaborators, ["Oriana"]);
  assert.equal(augusto.subtipo, "historia");
});

test("una visita de local se asigna a Germán y Líder", () => {
  const suggestion = getNewTaskSuggestions({ title: "Bendita Burger | Visita del local", clients, users });
  assert.equal(suggestion.primary, "Germán Beltzer");
  assert.deepEqual(suggestion.collaborators, ["Líder"]);
  assert.equal(suggestion.tipo_tarea, "produccion");
  assert.equal(suggestion.subtipo, "visita");
});

test("un aviso importante se asigna al diseñador del cliente y a Oriana", () => {
  const suggestion = getNewTaskSuggestions({ title: "iPhone Shop | Aviso importante", clients, users });
  assert.equal(suggestion.primary, "Mariano Meza");
  assert.deepEqual(suggestion.collaborators, ["Oriana"]);
  assert.equal(suggestion.subtipo, "aviso importante");
});

test("no inventa responsables ni clientes cuando el título es ambiguo", () => {
  const suggestion = getNewTaskSuggestions({ title: "Preparar material", clients, users });
  assert.equal(suggestion.client, null);
  assert.equal(suggestion.primary, "");
  assert.deepEqual(suggestion.collaborators, []);
});

test("la selección explícita de sin cliente no se reemplaza desde el título", () => {
  const suggestion = getNewTaskSuggestions({ title: "iPhone Shop | Carrusel", clients, users, clientId: "__none__" });
  assert.equal(suggestion.client, null);
  assert.equal(suggestion.primary, "Oriana");
  assert.deepEqual(suggestion.collaborators, []);
});

test("genera un enlace directo canónico que abre una única tarea", () => {
  assert.equal(
    getTaskDirectUrl("https://sistema.rendercorrientes.com", 482),
    "https://sistema.rendercorrientes.com/workspace/tareas?task=482",
  );
});
