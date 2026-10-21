import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../frontend/src/pages/Feedback.jsx", import.meta.url), "utf8");
const bloc = readFileSync(new URL("../../frontend/src/pages/BlocNotas.jsx", import.meta.url), "utf8");
const helper = source.slice(source.indexOf("export function feedbackBusinessInput"), source.indexOf("function feedbackResponsibles"));
const project = new Function(`${helper.replace("export ", "")} return feedbackBusinessInput;`)();
const business = { cliente: "Cliente", responsable: "Ana", responsables: ["Ana", "Luis"], referencia: "https://example.com", estado: "pendiente", vigencia: "permanente", flujo: "feedback" };
const provenance = { origen: "mia_whatsapp", confirmado_por: "Histórico", confirmado_por_id: 9, confirmado_at: "2026-10-19", provenance_version: 1, wilson_idempotency_key: "legacy" };
const note = { id: 7, titulo: "Pedido", contenido: "Texto", categoria: "general", updated_at: "2026-10-19T12:00:00.123Z", ...provenance, feedback: { ...business, ...provenance, future_server_field: true } };

test("business projection omits all provenance and unknown fields without mutating GET", () => {
  const before = structuredClone(note);
  assert.deepEqual(project(note.feedback), business);
  assert.deepEqual(project({ estado: "resuelto" }), { estado: "resuelto" });
  assert.deepEqual(project(), {});
  for (const legacy of [null, [], "legacy", 42]) assert.deepEqual(project(legacy), {});
  assert.deepEqual(note, before);
});

function handler(start, end, context) {
  const code = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  return new Function(...Object.keys(context), `${code}; return ${start.match(/function (\w+)/)[1]};`)(...Object.values(context));
}

for (const editing of [false, true]) test(`real persistDraft ${editing ? "PATCH" : "POST"} sends only business fields`, async () => {
  const calls = [];
  const draft = editing ? structuredClone(note) : { ...structuredClone(note), id: undefined };
  const noop = () => {};
  const save = handler("async function persistDraft", "  function save(", {
    draft, section: "clients", feedbackBusinessInput: project,
    feedbackResponsibles: (item) => item.feedback.responsables,
    lock: { current: false }, conflict: false,
    request: async (url, options) => { calls.push({ url, ...options }); return note; },
    setBusy: noop, setError: noop, setNotes: noop, markFeedbackSeen: noop,
    sesion: null, setSelected: noop, setDraft: noop, setBaseline: noop,
    setMessage: noop, setDuplicates: noop, setConflict: noop, restartNotes: noop,
  });
  await save({ skipDuplicateCheck: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, editing ? "PATCH" : "POST");
  assert.deepEqual(JSON.parse(calls[0].body), {
    titulo: note.titulo, contenido: note.contenido, categoria: note.categoria,
    feedback: business, ...(editing ? { expected_updated_at: note.updated_at } : {}),
  });
});

test("real status PATCH strips GET provenance and preserves business fields and exact CAS timestamp", async () => {
  let sent;
  const noop = () => {};
  const toggle = handler("async function toggleStatus", "  async function trashAction", {
    feedbackBusinessInput: project, lock: { current: false }, setBusy: noop, setError: noop,
    request: async (_url, options) => { sent = JSON.parse(options.body); return note; },
    setNotes: noop, setSelected: noop, setMessage: noop, restartNotes: noop,
  });
  await toggle(note);
  assert.deepEqual(sent, { feedback: { ...business, estado: "resuelto" }, expected_updated_at: note.updated_at });
  sent = null;
  await toggle({ ...note, source: "task" });
  assert.equal(sent, null);
});

test("duplicate selection uses target version without copying target provenance", () => {
  let draft = { titulo: "Nuevo pedido", feedback: { ...business } };
  const noop = () => {};
  const select = handler("function updateDuplicate", "  async function toggleStatus", {
    lock: { current: false },
    notes: [note], setDraft: (update) => { draft = update(draft); },
    setDuplicates: noop, setMessage: noop,
  });
  select(note.id);
  assert.equal(draft.id, note.id);
  assert.equal(draft.updated_at, note.updated_at);
  assert.deepEqual(draft.feedback, business);
  assert.equal(Object.hasOwn(draft, "origen"), false);
});

test("legacy Bloc autosave projects explicit content fields even from an enriched draft", () => {
  const expression = bloc.match(/body: JSON\.stringify\((\{ titulo: nextDraft\.titulo[^\n]+)\),/)[1];
  const body = new Function("nextDraft", "base", `return ${expression};`)(note, note);
  assert.deepEqual(body, { titulo: note.titulo, contenido: note.contenido, categoria: note.categoria, expected_updated_at: note.updated_at });
  assert.match(bloc, /setDraft\(selected \? \{ titulo: selected\.titulo, contenido: selected\.contenido, categoria:/);
});
