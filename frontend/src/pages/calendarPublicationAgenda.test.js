import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarPublicationLabel } from './calendarModel.js';
test('publication labels show only format, never task names or internal numbers', () => {
  assert.equal(calendarPublicationLabel({kind:'programacion',title:'Programación editorial · Reel #29200'}),'Reel');
  assert.equal(calendarPublicationLabel({kind:'publicacion',title:'Publicación confirmada manualmente · Carrusel · Promoción'}),'Carrusel');
  assert.equal(calendarPublicationLabel({kind:'programacion',title:'Otra cosa'}),'Contenido');
});
test('main publication agenda cannot open a task or visit', () => {
  const source = readFileSync(new URL('./Calendar.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/CalendarLinkedTask|setOpenedPublication|Abrir tarea|Abrir visita/);
  assert.match(source,/<h3>\{calendarPublicationLabel\(item\)\}<\/h3>/);
});
