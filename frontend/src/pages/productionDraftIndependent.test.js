import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionDraft, productionVisitDraft, verifiedProductionDraftVisit } from './productionDraft.js';

// Full operational aggregate, not a partial PATCH receipt or an invented API.
function aggregate(revision = 3) {
  const id = '10000000-0000-4000-8000-000000000001';
  return {
    id, revision, tarea_origen_id: null, cliente_id: 21, cliente_nombre: 'Cliente QA',
    fecha: '2026-10-20', titulo: 'Visita QA', observaciones: 'Conservar', drive_url: '',
    contexto_historico_revisado: false, participante_ids: [91001],
    videos: [{ id: '20000000-0000-4000-8000-000000000001', visita_id: id,
      video_origen_id: null, titulo: 'Video QA', guion: 'Guion', estado: 'grabado',
      material_url: '', observaciones: '', tarea_edicion_id: null, editor_id: null,
      fecha_entrega: null, tarea_estado: null, publicacion_id: null,
      tarea_entrega_id: null, cliente_editorial_id: null, editor_actual_id: null,
      fecha_entrega_actual: null, tarea_cliente_id: null, editor_handoff_id: null,
      fecha_entrega_handoff: null }],
    fotos: [{ id: '30000000-0000-4000-8000-000000000001', visita_id: id,
      tipo: 'Equipo', estado: 'realizada', drive_url: '', observaciones: '' }],
  };
}
function editing() {
  const visit = aggregate();
  const model = createProductionDraft(visit, productionVisitDraft(visit));
  model.edit(draft => ({ ...draft, titulo: 'Mi borrador pendiente' }));
  return { model, visit };
}

test('independent: full DTO and wrapped read validate without changing input', () => {
  const visit = aggregate(), before = structuredClone(visit);
  assert.equal(verifiedProductionDraftVisit({ visita: visit }, visit.id), visit);
  assert.deepEqual(visit, before);
});

test('independent: malformed/incomplete recovery never resets held draft or revision', () => {
  const invalid = [
    () => ({ id: aggregate().id, revision: 4 }),
    value => { delete value.videos; return value; },
    value => { value.fotos = null; return value; },
    value => { value.videos.push(structuredClone(value.videos[0])); return value; },
    value => { value.videos[0].visita_id = 'other'; return value; },
    value => { delete value.titulo; return value; },
    value => { value.id = 'other'; return value; },
  ];
  for (const corrupt of invalid) {
    const { model } = editing(), before = model.snapshot;
    assert.equal(model.beginReload(() => true), true);
    assert.throws(() => model.complete(corrupt(aggregate(4)), { titulo: 'No adoptar' }));
    model.fail(new Error('Readback inválido'));
    assert.deepEqual(model.snapshot.draft, before.draft);
    assert.deepEqual(model.snapshot.visit, before.visit);
    assert.equal(model.snapshot.dirty, true);
    assert.equal(model.snapshot.blocked, true);
    assert.equal(model.snapshot.pending, false);
  }
});

test('independent: sibling ACK cannot rebase another dirty form', () => {
  const { model: sibling, visit } = editing();
  const writer = createProductionDraft(visit, productionVisitDraft(visit));
  writer.begin(visit);
  const saved = aggregate(4); saved.observaciones = 'Cambio del otro formulario';
  writer.complete(saved, productionVisitDraft(saved));
  sibling.observe(saved, productionVisitDraft(saved));
  assert.equal(writer.snapshot.visit.revision, 4);
  assert.equal(sibling.snapshot.visit.revision, 3);
  assert.equal(sibling.snapshot.draft.titulo, 'Mi borrador pendiente');
  assert.equal(sibling.snapshot.blocked, true);
  assert.throws(() => sibling.begin(saved), error => error.status === 409);
});

test('independent: explicit discard refusal preserves state; acceptance adopts verified server version', () => {
  const { model } = editing(), before = model.snapshot;
  let prompts = 0;
  assert.equal(model.beginReload(() => { prompts++; return false; }), false);
  assert.deepEqual(model.snapshot, before);
  assert.equal(model.beginReload(() => { prompts++; return true; }), true);
  const server = aggregate(5); server.titulo = 'Versión revisada';
  model.complete(server, productionVisitDraft(server));
  assert.equal(prompts, 2);
  assert.equal(model.snapshot.visit.revision, 5);
  assert.equal(model.snapshot.draft.titulo, server.titulo);
  assert.equal(model.snapshot.dirty, false);
  assert.equal(model.snapshot.blocked, false);
});

test('independent: failed GET preserves fields and revision, without reporting a saved write', async () => {
  const { model } = editing(), before = model.snapshot;
  model.beginReload(() => true);
  try { await Promise.reject(new Error('GET desconectado')); }
  catch (error) { model.fail(error); }
  assert.deepEqual(model.snapshot.visit, before.visit);
  assert.deepEqual(model.snapshot.draft, before.draft);
  assert.equal(model.snapshot.saved, false);
  assert.equal(model.snapshot.blocked, true);
  assert.equal(model.snapshot.pending, false);
});

test('independent: pending double begin and reload cannot replace frozen outgoing intent', () => {
  const { model, visit } = editing();
  const intent = model.begin(visit);
  assert.throws(() => model.begin(visit), /operación/);
  assert.equal(model.beginReload(() => assert.fail('must not prompt during write')), false);
  model.edit({ titulo: 'No admitir mientras guarda' });
  intent.draft.titulo = 'Mutación externa'; intent.visit.revision = 999;
  assert.equal(model.snapshot.visit.revision, 3);
  assert.equal(model.snapshot.draft.titulo, 'Mi borrador pendiente');
  assert.equal(model.snapshot.pending, true);
});

test('independent: successful verified save advances baseline and permits subsequent CAS', () => {
  const { model, visit } = editing();
  model.begin(visit);
  const saved = aggregate(4); saved.titulo = 'Mi borrador pendiente';
  model.complete(saved, productionVisitDraft(saved));
  assert.equal(model.snapshot.dirty, false);
  assert.equal(model.snapshot.pending, false);
  model.edit(draft => ({ ...draft, titulo: 'Siguiente cambio' }));
  assert.equal(model.begin(saved).visit.revision, 4);
});

test('independent: acknowledged write/readback failure differs from uncertain send and neither retries', () => {
  for (const acknowledged of [false, true]) {
    const { model, visit } = editing();
    model.begin(visit);
    const error = new Error('No se pudo leer la respuesta');
    if (acknowledged) error.productionSaved = true;
    model.fail(error);
    assert.equal(model.snapshot.saved, acknowledged);
    assert.equal(model.snapshot.uncertain, !acknowledged);
    assert.equal(model.snapshot.dirty, true);
    assert.equal(model.snapshot.blocked, true);
    assert.throws(() => model.begin(visit), err => err.status === 409);
  }
});

test('independent: stale completion cannot clear draft or adopt an unchanged write revision', () => {
  const { model, visit } = editing(), before = model.snapshot;
  model.begin(visit);
  assert.throws(() => model.complete(visit, productionVisitDraft(visit)), err => err.status === 409);
  assert.deepEqual(model.snapshot.draft, before.draft);
  assert.equal(model.snapshot.visit.revision, before.visit.revision);
});
