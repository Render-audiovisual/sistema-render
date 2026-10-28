import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPublicationCalendarSelection, calendarHref, calendarQuery, publicationPlanningHref, decodeCalendar, calendarGrid } from './calendarModel.js';

test('principal calendar retires personal/type URL filters and always requests the editorial team view', () => {
  const selection = readPublicationCalendarSelection('?mes=2027-01&dia=2027-01-12&scope=mine&tipo=tarea&cliente=14', '2026-10-27');
  assert.equal(selection.scope, 'team'); assert.equal(selection.tipo, 'all');
  const href = new URL(calendarHref(selection), 'https://render.test');
  assert.equal(href.searchParams.has('scope'), false); assert.equal(href.searchParams.has('tipo'), false);
  assert.equal(href.searchParams.get('cliente'), '14');
  const request = new URL(calendarQuery(selection), 'https://render.test');
  assert.equal(request.searchParams.get('vista'), 'publicaciones');
  assert.equal(request.searchParams.has('scope'), false); assert.equal(request.searchParams.has('kind'), false);
  assert.equal(request.searchParams.get('cliente_id'), '14');
  assert.deepEqual(readPublicationCalendarSelection(href.search, '2026-10-27'), selection);
});

test('empty months retain explicit creation through the real server-backed editor, with month/client context', () => {
  const selection = readPublicationCalendarSelection('?mes=2027-02&cliente=14', '2026-10-27');
  assert.equal(publicationPlanningHref(selection), '/planificacion-publicaciones?tab=calendario&mes=2027-02&cliente=14');
  assert.equal(publicationPlanningHref(selection, true), '/planificacion-publicaciones?tab=planilla&mes=2027-02&cliente=14');
  assert.equal(publicationPlanningHref({ ...selection, cliente: '' }, true), '/planificacion-publicaciones?tab=planilla&mes=2027-02');
  const source = readFileSync(new URL('./Calendar.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<FilterSelect /g) || []).length, 1);
  assert.match(source, /label="Cliente"/); assert.doesNotMatch(source, /Lo mío|label="Tipo"|label="Ámbito"/);
  assert.match(source, /\+ Agregar reel o carrusel/); assert.match(source, /publicationPlanningHref\(selection, true\)/);
  assert.doesNotMatch(source, /localStorage|method: ['"](?:POST|PATCH)/);
  const editor = readFileSync(new URL('./Publicaciones.jsx', import.meta.url), 'utf8');
  assert.match(editor, /editorialPatchBody\(publicacion, \{ fecha_programada: fecha \}\)/);
  assert.match(editor, /model.submit\(\{[\s\S]*?fecha_programada: iso/);
});

test('principal calendar refuses due dates, project milestones and stories even in a well-formed legacy response', () => {
  const selection = readPublicationCalendarSelection('?mes=2026-10&dia=2026-10-10', '2026-10-27');
  const grid = calendarGrid(selection.mes);
  const envelope = { range: grid, scope: 'team', kind: 'all', timezone: 'America/Argentina/Cordoba', clients: [], events: [], truncated: false };
  assert.deepEqual(decodeCalendar(envelope, selection).events, []);
  assert.throws(() => decodeCalendar({ ...envelope, events: [{ source: 'tarea', kind: 'tarea' }] }, selection));
  assert.throws(() => decodeCalendar({ ...envelope, events: [{ source: 'historia', kind: 'programacion' }] }, selection));
});
