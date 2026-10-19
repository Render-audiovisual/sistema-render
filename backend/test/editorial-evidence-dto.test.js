import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialOperationalDto, editorialEvidenceDto } from '../src/operational-dto.js';
import { filterReportDataForUser } from '../src/report-access.js';

const eventId = '34349ff1-15c7-4d7b-9c14-7de9eb3836fd';
const evidence = () => ({ classification: 'confirmada_manualmente', revision: 2, amount: 987654321,
  confirmation: { id: eventId, actor_id: 4, occurred_at: '2026-09-30T22:00:00.000Z',
    recorded_at: '2026-10-01T01:00:00.000Z', source: 'manual', private_salary: { secret: 987654321 } } });
const expected = () => ({ classification: 'confirmada_manualmente', revision: 2,
  confirmation: { id: eventId, actor_id: 4, occurred_at: '2026-09-30T22:00:00.000Z',
    recorded_at: '2026-10-01T01:00:00.000Z', source: 'manual' } });

test('new evidence DTO is explicitly closed, nonmutating and safe for every role', () => {
  for (const rol of ['admin', 'community', 'diseno', 'edicion', 'produccion', undefined]) {
    const source = { id: 5, publicacion_evidencia: evidence() };
    const result = editorialOperationalDto(source, { rol });
    assert.deepEqual(result.publicacion_evidencia, expected());
    assert.ok(!JSON.stringify(result.publicacion_evidencia).includes('987654321'));
    assert.equal(source.publicacion_evidencia.amount, 987654321);
  }
});

test('evidence getters, inherited data, invalid authority fields and fake source are not serialized', () => {
  let calls = 0;
  const value = Object.create({ classification: 'confirmada_manualmente' });
  Object.defineProperty(value, 'confirmation', { enumerable: true, get() { calls++; throw new Error('Getter executed'); } });
  value.revision = -1;
  assert.deepEqual(editorialEvidenceDto(value), {});
  assert.deepEqual(editorialEvidenceDto({ classification: 'verified_instagram', revision: 1.5,
    confirmation: { actor_id: '4', source: 'instagram' } }), { confirmation: {} });
  for (const rol of ['admin', 'edicion']) {
    const piece = { id: 5 };
    Object.defineProperty(piece, 'publicacion_evidencia', { enumerable: true, get() { calls++; throw new Error('Root getter'); } });
    assert.deepEqual(editorialOperationalDto(piece, { rol }), { id: 5 });
  }
  assert.equal(calls, 0);
});

test('report projection retains only closed evidence for admin and shared community reads', () => {
  const row = { id: 5, cliente_id: 8, estado: 'publicada', publicacion_evidencia: evidence() };
  for (const rol of ['admin', 'community']) {
    const result = filterReportDataForUser({ tareas: [], tareasRenderOs: [], historias: [row], publicaciones: [row], clientes: [], usuarios: [], entregasEdicion: [] }, { id: 4, rol });
    assert.deepEqual(result.historias[0].publicacion_evidencia, expected());
    assert.deepEqual(result.publicaciones[0].publicacion_evidencia, expected());
  }
});
