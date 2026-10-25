import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { feedbackNotesMutationBody } from '../../frontend/src/pages/feedbackNotesMutation.js';

const source = readFileSync(new URL("../../frontend/src/pages/Feedback.jsx", import.meta.url), "utf8");
const bloc = readFileSync(new URL("../../frontend/src/pages/BlocNotas.jsx", import.meta.url), "utf8");
const helper = source.slice(source.indexOf("export function feedbackBusinessInput"), source.indexOf("function FeedbackResponsiblePicker"));
const project = new Function(`${helper.replace("export ", "")} return feedbackBusinessInput;`)();
const business = { cliente: "Cliente", responsable: "Ana", responsables: ["Ana", "Luis"], referencia: "https://example.com", estado: "pendiente", vigencia: "permanente", flujo: "feedback" };
const provenance = { origen: "mia_whatsapp", confirmado_por: "Histórico", confirmado_por_id: 9, confirmado_at: "2026-10-19", provenance_version: 1, wilson_idempotency_key: "legacy" };
const note = { id: 7, titulo: "Pedido", contenido: "Texto", categoria: "general", updated_at: "2026-10-19T12:00:00.123Z", ...provenance, feedback: { ...business, ...provenance, future_server_field: true } };
const requestId='11111111-1111-4111-8111-111111111111';

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

for (const editing of [false, true]) test(`real persistDraft ${editing ? "edit" : "create"} sends only business fields through canonical model`, async () => {
  const calls = [];
  const draft = editing ? structuredClone(note) : { ...structuredClone(note), id: undefined };
  if(!editing)draft.feedback.responsable_ids=[9];
  const noop = () => {};
  const save = handler("async function persistDraft", "  function save(", {
    draft, section: "clients", feedbackBusinessInput: project,
    feedbackResponsibles: (item) => item.feedback.responsables,
    lock: { current: false }, conflict: false,
    mutationRef:{current:{model:{snapshot:{locked:false}}}},
    runMutation:async action=>action({start:async(input,options)=>{calls.push({body:feedbackNotesMutationBody(input,requestId),options});}}),
    setBusy: noop, setError: noop, setNotes: noop, markFeedbackSeen: noop,
    sesion: null, setSelected: noop, setDraft: noop, setBaseline: noop,
    setMessage: noop, setDuplicates: noop, setConflict: noop, restartNotes: noop,
  });
  await save({ skipDuplicateCheck: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {
    request_id:requestId,action:editing?'edit':'create',
    fields:{titulo: note.titulo, contenido: note.contenido, categoria: note.categoria,feedback: {...business,...(!editing?{responsable_ids:[9]}:{})}},
    ...(editing ? {note_id:note.id,expected_updated_at:note.updated_at} : {}),
  });
  assert.equal(calls[0].options.checkDuplicates,false);
});

test("real status PATCH strips GET provenance and preserves business fields and exact CAS timestamp", async () => {
  let sent;
  const noop = () => {};
  const toggle = handler("async function toggleStatus", "  async function trashAction", {
    feedbackBusinessInput: project, lock: { current: false }, setBusy: noop, setError: noop,
    mutationRef:{current:{model:{snapshot:{locked:false}}}},
    runMutation:async action=>action({start:async input=>{sent=feedbackNotesMutationBody(input,requestId);}}),
    setNotes: noop, setSelected: noop, setMessage: noop, restartNotes: noop,
  });
  await toggle(note);
  assert.deepEqual(sent, {request_id:requestId,action:'edit',note_id:note.id,fields:{feedback:{...business,estado:'resuelto'}},expected_updated_at:note.updated_at});
  sent = null;
  await toggle({ ...note, source: "task" });
  assert.equal(sent, null);
});

test("duplicate selection uses target version without copying target provenance", () => {
  let draft = { titulo: "Nuevo pedido", feedback: { ...business } };
  const noop = () => {};
  const select = handler("function updateDuplicate", "  async function toggleStatus", {
    lock: { current: false },
    mutationRef:{current:{model:{snapshot:{phase:'idle',locked:false}}}},
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
