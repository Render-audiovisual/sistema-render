import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const source = readFileSync(new URL('./InstagramClientStats.jsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;$/gm, ''), { compilerOptions: { jsx: ts.JsxEmit.React,
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
const stub = () => null;
Function('exports', 'React', 'useState', 'useMemo', 'useEffect', 'getSesion', 'useScopedRequest', 'isSessionFailure', 'handleAppLinkClick', 'mediaCoverUrl', 'mediaPostUrl', code)(
  api, React, React.useState, React.useMemo, React.useEffect, stub, stub, () => false, stub, v => v, v => v);
const bind = () => ({});

test('monthly available-view note identifies missing Facebook without inventing or repeating totals',()=>{
  const m={vistas_instagram_disponibles:2979499,vistas_facebook_disponibles:443190,
    publicaciones_sin_facebook:1,publicaciones_sin_instagram:0};
  assert.equal(api.monthlyViewNote(m),'Instagram: 2.979.499 · Facebook: 443.190 · Falta Facebook en 1 publicación');
  assert.match(api.monthlyViewNote({...m,publicaciones_sin_facebook:2}),/Falta Facebook en 2 publicaciones/);
  assert.doesNotMatch(api.monthlyViewNote({...m,publicaciones_sin_facebook:0}),/Falta/);
  assert.match(api.monthlyViewNote({...m,vistas_facebook_disponibles:0,publicaciones_sin_facebook:0}),/Facebook: 0/);
});

test('stats URL params are closed: one client, one month and an optional numeric publication', () => {
  assert.deepEqual(api.readStatsParams('?cliente=cliente-11&periodo=2026-10'), { cliente: 'cliente-11', periodo: '2026-10', pub: null });
  assert.deepEqual(api.readStatsParams('?cliente=grupo-2&periodo=2026-10&pub=1789'), { cliente: 'grupo-2', periodo: '2026-10', pub: '1789' });
  for (const q of ['?cliente=x&periodo=2026-10', '?cliente=cliente-1&periodo=2026-13', '?cliente=cliente-1&periodo=2026-10&pub=abc', '?cliente=cliente-1&cliente=cliente-2&periodo=2026-10'])
    assert.equal(api.readStatsParams(q), null, q);
  assert.equal(api.statsHref({ cliente: 'cliente-1', periodo: '2026-10', pub: '55' }), '/instagram/estadisticas?cliente=cliente-1&periodo=2026-10&pub=55');
  assert.equal(api.statsHref({ cliente: 'evil', periodo: '2026-10' }), null);
});

test('publications filter by format and sort by date, score or reach', () => {
  const rows = [{ ig_media_id: '1', tipo: 'reel', publicado_at: '2026-10-01T00:00:00Z', puntaje: 2, metricas: { alcance: 100 } },
    { ig_media_id: '2', tipo: 'carrusel', publicado_at: '2026-10-05T00:00:00Z', puntaje: 0.5, metricas: { alcance: 900 } },
    { ig_media_id: '3', tipo: 'reel', publicado_at: '2026-10-03T00:00:00Z', puntaje: null, metricas: { alcance: null } }];
  assert.deepEqual(api.sortPublications(rows, 'all', 'fecha').map(r => r.ig_media_id), ['2', '3', '1']);
  assert.deepEqual(api.sortPublications(rows, 'all', 'puntaje').map(r => r.ig_media_id), ['1', '2', '3']);
  assert.deepEqual(api.sortPublications(rows, 'reel', 'alcance').map(r => r.ig_media_id), ['1', '3']);
  assert.equal(api.variation(120, 100), 20); assert.equal(api.variation(5, 0), null);
});

test('curve renders own measurements and the typical band; insight compares at 24 h', () => {
  const curva = { mediciones: [{ horas: 1, alcance: 600 }, { horas: 24, alcance: 4000 }, { horas: 72, alcance: 4500 }],
    tipica: [{ horas: 1, p25: 100, p50: 150, p75: 200 }, { horas: 24, p25: 1100, p50: 1200, p75: 1350 }, { horas: 168, p25: null, p50: null, p75: null }] };
  const html = renderToStaticMarkup(React.createElement(api.CurveChart, { curva, bind }));
  assert.match(html, /class="igs-band"/); assert.equal((html.match(/class="igs-dot"/g) || []).length, 3); assert.match(html, /Día 3/);
  assert.match(api.curveInsight(curva), /3,3×/);
  const empty = renderToStaticMarkup(React.createElement(api.CurveChart, { curva: { mediciones: [{ horas: 1, alcance: 5 }], tipica: [] }, bind }));
  assert.match(empty, /todavía no tiene suficientes mediciones/);
});

test('followers chart needs two days and labels the month start', () => {
  const serie = [{ fecha: '2026-09-30', seguidores: 1000 }, { fecha: '2026-10-01', seguidores: 1010 }, { fecha: '2026-10-31', seguidores: 1120 }];
  const html = renderToStaticMarkup(React.createElement(api.FollowersChart, { serie, period: '2026-10', bind }));
  assert.match(html, /Inicio del mes/); assert.match(html, /class="igs-line"/);
  assert.match(renderToStaticMarkup(React.createElement(api.FollowersChart, { serie: serie.slice(0, 1), period: '2026-10', bind })), /Todavía no hay suficientes días/);
});

test('views lead publication rows and the monthly summary; reach remains separately labelled',()=>{
  assert.match(source,/<Tile label="Visualizaciones disponibles" value=\{a.vistas_disponibles\}/);
  assert.match(source,/fmt\(r.metricas.vistas_total\).*<small>vistas totales<\/small>/);
  assert.match(source,/\['vistas_total', 'Visualizaciones totales'\], \['alcance', 'Alcance'\]/);
  assert.match(source,/Instagram:.*vistas_instagram.*Facebook:.*vistas_facebook/);
  assert.match(api.measurementLabel('2026-11-03T18:00:00.000Z'),/^Actualizado/);
  assert.equal(api.measurementLabel(null),'Sin fecha de medición');
  assert.equal(api.measurementLabel('bad'),'Sin fecha de medición');
  assert.match(source,/measurementLabel\(d.medido_at\)/);assert.match(source,/measurementLabel\(r.medido_at\)/);
});

test('a principio de mes compara contra los mismos días del mes anterior',()=>{
  assert.equal(api.compareLabel({periodo_anterior:'2026-10',comparacion:{parcial:true,hasta_dia:3}}),'1–3 oct');
  assert.equal(api.compareLabel({periodo_anterior:'2026-10',comparacion:{parcial:true,hasta_dia:1}}),'1 oct');
  assert.equal(api.compareLabel({periodo_anterior:'2026-09',comparacion:{parcial:false,hasta_dia:null}}),'mes anterior');
  assert.equal(api.compareLabel({}),'mes anterior');
});
