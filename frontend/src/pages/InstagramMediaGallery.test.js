import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const source = readFileSync(new URL('./InstagramMediaGallery.jsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source.replace(/^import .*;$/gm, ''), { compilerOptions: { jsx: ts.JsxEmit.React,
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
Function('exports', 'React', 'useState', 'useMemo', code)(api, React, React.useState, React.useMemo);
const piece = (tipo, vistas, slug = tipo) => ({ tipo, permalink: `https://www.instagram.com/p/${slug}/`,
  publicado_at: '2026-10-15T15:00:00Z', caption: 'Publicación de prueba', metricas: { vistas, vistas_total: vistas, vistas_instagram: vistas, vistas_facebook: vistas === null ? null : 0, alcance: 100 },
  portada_url: 'https://scontent.cdninstagram.com/v/image.jpg?signature=example' });
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('gallery filters formats and sorts known views before missing views without modifying input', () => {
  const rows = [piece('reel', null, 'unknown'), piece('carrusel', 0), piece('reel', 500), piece('imagen', 900)];
  assert.deepEqual(api.galleryPieces(rows).map(p => p.metricas.vistas), [500, 0, null]);
  assert.equal(rows[0].metricas.vistas, null);
  assert.equal(api.galleryPieces(rows, 'reel').length, 2);
  assert.equal(api.galleryPieces(rows, 'carrusel').length, 1);
  assert.equal(api.mediaNumber(null), '—'); assert.equal(api.mediaNumber(0), '0');
});
test('only genuine Meta HTTPS CDN covers and public Instagram post destinations are accepted', () => {
  for (const url of ['https://cdninstagram.com.evil.test/image.jpg', 'https://evil.test/a.jpg', 'javascript:alert(1)',
    'https://user:secret@scontent.fbcdn.net/a.jpg', 'http://scontent.fbcdn.net/a.jpg', 'https://scontent.fbcdn.net:444/a.jpg'])
    assert.equal(api.mediaCoverUrl(url), null);
  assert.ok(api.mediaCoverUrl(piece('reel', 10).portada_url));
  assert.equal(api.mediaPostUrl('https://www.instagram.com/p/Real/?tracking=1'), 'https://www.instagram.com/p/Real/');
  assert.equal(api.mediaPostUrl('https://evil.test/p/Real/'), null);
});
test('cover is lazy loaded at fixed dimensions, not video autoplay; views and reach remain separate', () => {
  const html = render(api.InstagramMediaCard, { piece: piece('reel', 1200) });
  assert.match(html, /loading="lazy"/); assert.match(html, /decoding="async"/);
  assert.match(html, /width="480" height="600"/); assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /Visualizaciones totales/); assert.match(html, /Alcance/);
  assert.match(html, /target="_blank"/); assert.doesNotMatch(html, /<video|autoplay|iframe/);
});
test('missing cover and missing metric stay explicit rather than fabricated or rendered as zero', () => {
  const html = render(api.InstagramMediaCard, { piece: { ...piece('carrusel', null), portada_url: null } });
  assert.match(html, /Portada no disponible/); assert.match(html, /<dd>—<\/dd>/); assert.doesNotMatch(html, /<img/);
  const gallery = render(api.InstagramMediaGallery, { pieces: [] });
  assert.match(gallery, /No hay reels ni carruseles registrados/); assert.match(gallery, /no son visitas al perfil/);
});

test('printed gallery explicitly identifies the active format and sort instead of implying a full report', () => {
  assert.match(source, /Contenido mostrado:/);
  assert.match(source, /solo reels/); assert.match(source, /solo carruseles/);
  const css = readFileSync(new URL('./InstagramMediaGallery.css', import.meta.url), 'utf8');
  assert.match(css, /@media print\{[^\n]*\.ig-media-print-context\{display:block/);
});

test('simple gallery keeps formats and visible metrics without a sort menu or nested results',()=>{
  const html=render(api.InstagramMediaGallery,{pieces:[piece('reel',0),piece('carrusel',null)]});
  assert.doesNotMatch(html,/Ordenar por|Qué contenido funciona mejor|Ver resultados|<select/);
  for(const label of ['Me gusta','Comentarios'])assert.equal((html.match(new RegExp(`<dt>${label}</dt>`,'g'))||[]).length,1);
  for(const label of ['Visualizaciones totales','Alcance','Guardados','Compartidos'])assert.equal((html.match(new RegExp(`<dt>${label}</dt>`,'g'))||[]).length,2);
  assert.match(html,/<dd>0<\/dd>/);assert.match(html,/<dd>—<\/dd>/);
  assert.match(html,/aria-pressed="true">Todo/);
});

test('reels and carousels expose the entire original copy outside the Instagram link, preserving paragraphs safely', () => {
  for (const tipo of ['reel', 'carrusel']) {
    const caption = `Primer párrafo\n\n${'Texto completo '.repeat(60)}\n#Contenido <script>no ejecutar</script>`;
    const html = render(api.InstagramMediaCard, { piece: { ...piece(tipo, 1), caption } });
    assert.match(html, /<details class="ig-media-copy[^"]*"><summary>Ver copy completo<\/summary><p>Primer párrafo\n\n/);
    assert.match(html, /#Contenido &lt;script&gt;no ejecutar&lt;\/script&gt;/);
    assert.ok(html.lastIndexOf('</a>', html.indexOf('class="ig-media-copy')) > -1 && html.indexOf('</a>') < html.indexOf('class="ig-media-copy'));
    assert.doesNotMatch(html, /<script>/);
  }
  const missing = render(api.InstagramMediaCard, { piece: { ...piece('reel', 1), caption: '' } });
  assert.match(missing, /Sin copy disponible/); assert.doesNotMatch(missing, /Ver copy completo/);
  const css = readFileSync(new URL('./InstagramMediaGallery.css', import.meta.url), 'utf8');
  assert.match(css, /\.ig-media-copy p\{[^}]*white-space:pre-wrap/);
});

test('carousel uses the Feed card: uncovered 4:5 cover, three carousel KPIs and secondary likes/comments',()=>{
  const html=render(api.InstagramMediaCard,{piece:{...piece('carrusel',900),metricas:{vistas:900,alcance:2719,guardados:3,compartidos:8,likes:108,comentarios:5}}});
  assert.match(html,/ig-carousel-card/);assert.doesNotMatch(html,/ig-media-type|ig-media-open|Reproducciones/);
  assert.deepEqual([...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map(m=>m[1]),['Visualizaciones totales','Alcance','Guardados','Compartidos']);
  assert.match(html,/<dd>2\.719<\/dd>/);assert.match(html,/108 me gusta · 5 comentarios/);
  assert.match(html,/Ver en IG ↗/);assert.match(html,/loading="lazy"/);
  const reel=render(api.InstagramMediaCard,{piece:piece('reel',10)});assert.match(reel,/ig-media-type/);assert.doesNotMatch(reel,/ig-carousel-card/);
});
