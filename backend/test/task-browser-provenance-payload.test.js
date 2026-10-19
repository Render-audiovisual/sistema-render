import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../frontend/src/pages/TareasTablero.jsx', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('export function stripTaskIntegrationMetadata'), source.indexOf('export function TareasTableroPage'));
const strip = new Function(`${helper.replace('export ', '')}; return stripTaskIntegrationMetadata;`)();

test('metadata echo removes only reserved integration keys case-insensitively; GET remains unchanged', () => {
  const business = { workspace: 'render_os', resumen: 'Brief', etiquetas: ['x'], colaboradores: ['QA'], custom_history: { keep: true }, produccion_videos_previstos: 3, wilson: 'not-reserved' };
  const metadata = { ...business, wilson_idempotency_key: 'legacy', WILSON_Actor: 9, Origen_Integracion: 'wilson' };
  const before = structuredClone(metadata);
  assert.deepEqual(strip(metadata), business);
  assert.deepEqual(metadata, before);
  for (const value of [null, undefined, [], 'legacy', 1]) assert.deepEqual(strip(value), {});
});

test('actual metadata writer strips markers from both GET echo and changes, preserving other business history', () => {
  const start = source.indexOf('  const actualizarMetadatos =');
  const code = source.slice(start, source.indexOf('  const enviarComentario', start));
  let sent;
  const write = new Function('tarea', 'onActualizarCampo', 'stripTaskIntegrationMetadata', `${code}; return actualizarMetadatos;`)(
    { id: 8, propiedades_extra: { wilson_archive_key: 'legacy', origen_integracion: 'wilson', resumen: 'Anterior', history: [1, 2] } },
    (id, payload) => { sent = { id, payload }; }, strip,
  );
  write({ resumen: 'Nuevo', WILSON_injected: 'no' });
  assert.deepEqual(sent, { id: 8, payload: { propiedades_extra: { resumen: 'Nuevo', history: [1, 2] } } });
});
