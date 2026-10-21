import test from "node:test";
import assert from "node:assert/strict";
import { filterReportDataForUser, summarizeRenderOsByDay } from "../src/report-access.js";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

const data = {
  tareas: [
    { id: 1, asignado_a: "Augusto", asignado_a_id: 1, colaborador_ids: [], cliente_id: 11, publicacion_id: 7 },
    { id: 2, asignado_a: "Luciano", asignado_a_id: 3, colaborador_ids: [], cliente_id: 10 },
  ],
  tareasRenderOs: [
    { id: 3, asignado_a: "Germán", asignado_a_id: 2, colaborador_ids: [], cliente_id: 10 },
    { id: 4, asignado_a: "Augusto", asignado_a_id: 1, colaborador_ids: [], cliente_id: 11 },
  ],
  historias: [{ id: 5, estado: "publicada" }],
  publicaciones: [
    { id: 6, cliente_id: 10, tipo: "carrusel" },
    { id: 7, cliente_id: 11, tipo: "carrusel" },
    { id: 8, cliente_id: 10, tipo: "video" },
  ],
  clientes: [
    { id: 10, nombre: "Luzin" },
    { id: 11, nombre: "Moketa" },
  ],
  usuarios: [
    { id: 1, nombre: "Augusto", rol: "diseno" },
    { id: 2, nombre: "Germán", rol: "produccion" },
  ],
  entregasEdicion: [{ id: 9, editor_clave: "luciano", editor_id: 3 }],
};

test("el reporte de un diseñador contiene solo sus carruseles", () => {
  const result = filterReportDataForUser(data, { id: 1, nombre: "Augusto Aguirre", rol: "diseno" });
  assert.deepEqual(result.tareas.map((item) => item.id), [1]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [7]);
  assert.deepEqual(result.historias, []);
  assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [4]);
  assert.deepEqual(result.usuarios.map((item) => item.id), [1]);
});

test("producción recibe únicamente sus tareas RENDER OS", () => {
  const result = filterReportDataForUser(data, { id: 2, nombre: "Germán Beltzer", rol: "produccion" });
  assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [3]);
  assert.deepEqual(result.publicaciones, []);
  assert.deepEqual(result.historias, []);
});

test("community conserva métricas globales de publicación sin usuarios ajenos", () => {
  const result = filterReportDataForUser(data, { id: 4, nombre: "Oriana", rol: "community" });
  assert.deepEqual(result.historias.map((item) => item.id), [5]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [6, 7, 8]);
  assert.deepEqual(result.usuarios, []);
  assert.deepEqual(result.tareasRenderOs, []);
});

test("el administrador conserva el reporte completo", () => {
  const result = filterReportDataForUser(data, { rol: "admin" });
  assert.deepEqual(result.tareasRenderOs, data.tareasRenderOs);
});

test("edición recibe únicamente su registro confirmado", () => {
  const result = filterReportDataForUser(data, { id: 3, nombre: "Luciano", rol: "edicion" });
  assert.deepEqual(result.entregasEdicion.map((item) => item.id), [9]);
});

test("el endpoint del reporte está disponible tras la autenticación compartida", () => {
  assert.match(serverSource, /router\.use\(createPrincipalAuthentication\(\{ browserTransport: browserSessions, pool \}\)\);[\s\S]*router\.get\("\/reportes\/datos", async/);
  assert.doesNotMatch(
    serverSource,
    /router\.get\("\/reportes\/datos", requireRole\("admin"\)/,
  );
});

test("el resumen compartido expone solo totales diarios y no detalles de tareas", () => {
  const result = summarizeRenderOsByDay([
    { titulo: "Carrusel 1", estado: "publicada", fecha_vencimiento: "2026-08-06", propiedades_extra: {} },
    { titulo: "Video 1", estado: "pendiente", fecha_vencimiento: "2026-08-07", propiedades_extra: {} },
    { titulo: "Editar video", tipo_tarea: "edicion", estado: "publicada", fecha_vencimiento: "2026-08-07", propiedades_extra: {} },
    { titulo: "Carrusel archivado", estado: "publicada", fecha_vencimiento: "2026-08-08", propiedades_extra: { archivada_render_os: true } },
  ]);
  assert.deepEqual(result, {
    "2026-08-06": { carruseles: { total: 1, publicadas: 1 } },
    "2026-08-07": {
      reels_planificados: { total: 1, publicadas: 0 },
      ediciones: { total: 1, publicadas: 1 },
    },
  });
  assert.equal(JSON.stringify(result).includes("Carrusel 1"), false);
});

test("el reporte obtiene la cuota compartida desde grupos_feed", () => {
  const snapshotSource = readFileSync(new URL('../src/report-snapshot.js', import.meta.url), 'utf8');
  assert.match(serverSource, /res.json\(await loadReportSnapshot\(pool, req.auth, req.query\)\)/);
  assert.match(snapshotSource, /gf\.cuota_carruseles AS cuota_feed_carruseles/);
  assert.match(snapshotSource, /LEFT JOIN grupos_feed gf ON gf\.id=c\.grupo_feed_id/);
  assert.doesNotMatch(snapshotSource, /SELECT id,nombre,cuota_carruseles,cuota_feed_carruseles,grupo_feed_id FROM clientes/);
});

test('task/user identity survives rename and rejects homonyms, display aliases and historical labels', () => {
  const input = { ...data, tareas: [
    { id: 1, asignado_a: 'Same Name', asignado_a_id: 8, colaborador_ids: [] },
    { id: 2, asignado_a: 'Renamed', asignado_a_id: 7, colaborador_ids: [] },
    { id: 3, asignado_a: 'Other', asignado_a_id: 8, colaborador_ids: [7] },
    { id: 4, asignado_a: 'Same Name', propiedades_extra: { edicion_responsable: 'Same Name', colaboradores: ['Same Name'] } },
  ], usuarios: [{ id: 7, nombre: 'Renamed' }, { id: 8, nombre: 'Same Name' }] };
  for (const nombre of ['Same Name', 'Renamed', 'Mariano', 'Augusto']) {
    const result = filterReportDataForUser(input, { id: 7, nombre, rol: 'edicion' });
    assert.deepEqual(result.tareas.map(row => row.id), [2, 3]);
    assert.deepEqual(result.usuarios.map(row => row.id), [7]);
    assert.equal(result.tareas[0].asignado_a_id, 7);
    assert.deepEqual(result.tareas[1].colaborador_ids, [7]);
  }
});

test('revoked or malformed numeric task identities never fall back to names', () => {
  for (const asignado_a_id of [null, '7', 0, -1, 7.1, Infinity, {}, true]) {
    const result = filterReportDataForUser({ ...data, tareas: [{ id: 1, asignado_a: 'Alex', asignado_a_id,
      colaborador_ids: ['7', null, {}, 0, -1, 7.1] }] }, { id: 7, nombre: 'Alex', rol: 'edicion' });
    assert.deepEqual(result.tareas, []);
  }
  const result = filterReportDataForUser({ ...data, tareas: [{ id: 1, asignado_a_id: 8, colaborador_ids: [7, '8', {}, -1], cliente_id: '11' }] }, { id: 7, rol: 'diseno' });
  assert.deepEqual(result.tareas[0].colaborador_ids, [7]);
  assert.equal(result.tareas[0].cliente_id, undefined);
});

test('designer publications require exact editorial links on current-member tasks, never just matching clients', () => {
  const input = { ...data, tareas: [{ id: 1, asignado_a_id: 7, cliente_id: 10, publicacion_id: 6 }],
    tareasRenderOs: [{ id: 2, asignado_a_id: 8, colaborador_ids: [7], cliente_id: 11, publicacion_id: 7 },
      { id: 3, asignado_a: 'Mariano', asignado_a_id: 8, cliente_id: 12 }],
    clientes: [...data.clientes, { id: 12, nombre: 'Luzin' }],
    publicaciones: [...data.publicaciones, { id: 9, cliente_id: 12, tipo: 'carrusel' }, { id: 10, cliente_id: 10, tipo: 'carrusel' }] };
  const result = filterReportDataForUser(input, { id: 7, nombre: 'Unknown Designer', rol: 'diseno' });
  assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7]);
  const revoked = filterReportDataForUser({ ...input, tareas: [], tareasRenderOs: [] }, { id: 7, nombre: 'Augusto', rol: 'diseno' });
  assert.deepEqual(revoked.publicaciones, []);
});

test('legacy editing delivery labels are never authority; only explicit editor_id authorizes own rows', () => {
  const input = { ...data, entregasEdicion: [
    { id: 1, editor_clave: 'Alex' }, { id: 2, editor_id: 7, editor_clave: 'Old label' },
    { id: 3, editor_id: 8, editor_clave: 'Alex' }, { id: 4, editor_id: '7', editor_clave: 'Alex' },
  ] };
  const result = filterReportDataForUser(input, { id: 7, nombre: 'Alex', rol: 'edicion' });
  assert.deepEqual(result.entregasEdicion.map(row => row.id), [2]);
  assert.deepEqual(filterReportDataForUser(input, { id: 7, rol: 'community' }).entregasEdicion.map(row => row.id), [2]);
  assert.equal(filterReportDataForUser(input, { rol: 'admin' }).entregasEdicion.length, 4);
});

test('every non-admin role excludes other editors attributed delivery sentinels', () => {
  const input = { ...data, entregasEdicion: [
    { id: 1, editor_id: 7, editor_clave: 'Renamed', cliente_etiqueta: 'Own delivery' },
    { id: 2, editor_id: 8, editor_clave: 'Same name', cliente_etiqueta: 'OTHER_EDITOR_SENTINEL' },
    { id: 3, editor_clave: 'Same name', cliente_etiqueta: 'UNATTRIBUTED_SENTINEL' },
  ] };
  for (const rol of ['community', 'diseno', 'produccion', 'edicion', 'programacion']) {
    const result = filterReportDataForUser(input, { id: 7, nombre: 'Same name', rol });
    assert.deepEqual(result.entregasEdicion.map(row => row.id), [1]);
    assert.doesNotMatch(JSON.stringify(result.entregasEdicion), /OTHER_EDITOR_SENTINEL|UNATTRIBUTED_SENTINEL/);
    assert.deepEqual(filterReportDataForUser(input, { id: 9, rol }).entregasEdicion, []);
  }
  assert.equal(filterReportDataForUser(input, { rol: 'admin' }).entregasEdicion, input.entregasEdicion);
});

test('editorial report preserves actual publication timestamp with exact Unicode field, never objects', () => {
  const timestamp = new Date('2026-10-19T15:00:00Z');
  const input = { ...data,
    historias: [{ id: 1, fecha_publicación_real: timestamp }, { id: 2, fecha_publicación_real: null },
      { id: 3, fecha_publicación_real: { importe: 'FINANCE_SENTINEL' } }],
    tareas: [{ id: 9, asignado_a_id: 1, publicacion_id: 4 }],
    publicaciones: [{ id: 4, cliente_id: 11, tipo: 'carrusel', fecha_publicación_real: timestamp },
      { id: 5, cliente_id: 11, tipo: 'carrusel', fecha_publicación_real: { importe: 'FINANCE_SENTINEL' } }],
  };
  const result = filterReportDataForUser(input, { id: 7, rol: 'community' });
  assert.equal(result.historias[0]['fecha_publicación_real'], timestamp.toISOString());
  assert.equal(result.historias[1]['fecha_publicación_real'], null);
  assert.equal(Object.hasOwn(result.historias[2], 'fecha_publicación_real'), false);
  assert.equal(result.publicaciones[0]['fecha_publicación_real'], timestamp.toISOString());
  assert.equal(Object.hasOwn(result.publicaciones[1], 'fecha_publicación_real'), false);
  assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL/);
  const designer = filterReportDataForUser(input, { id: 1, rol: 'diseno' });
  assert.equal(designer.publicaciones[0]['fecha_publicación_real'], timestamp.toISOString());
});

const visitId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
function productionInput() {
  const secret = { importe: 'FINANCE_SENTINEL', abono: 'FINANCE_SENTINEL', finanzas: { sueldo: 'FINANCE_SENTINEL' } };
  return { desde: '2026-10-01', hasta: '2026-11-01', ...secret, visitas: [{
    id: visitId, tarea_origen_id: 90, cliente_id: 11, cliente_nombre: 'Client', fecha: '2026-10-19', titulo: 'Visit',
    participante_ids: [8, 7, '9', 0, -1, secret], ...secret,
    videos: [{ id: videoId, titulo: 'Video', estado: 'grabado', tarea_edicion_id: 100,
      tarea_estado: 'aprobada', editor_actual_id: 8, fecha_entrega_actual: '2026-10-21', ...secret }],
    fotos: [{ id: photoId, tipo: 'Storefront', estado: 'realizada', ...secret }],
  }] };
}

test('normalized registry remains shared for known operational identities with closed nested DTOs', () => {
  const input = { ...data, producciones: productionInput() };
  const before = structuredClone(input);
  for (const rol of ['diseno', 'edicion', 'community', 'produccion', 'programacion']) {
    const result = filterReportDataForUser(input, { id: 999, rol });
    assert.doesNotMatch(JSON.stringify(result.producciones), /FINANCE_SENTINEL/);
    assert.deepEqual(result.producciones, { desde: '2026-10-01', hasta: '2026-11-01', visitas: [{
      id: visitId, tarea_origen_id: 90, cliente_id: 11, cliente_nombre: 'Client', fecha: '2026-10-19', titulo: 'Visit', participante_ids: [8, 7],
      videos: [{ id: videoId, titulo: 'Video', estado: 'grabado', tarea_edicion_id: 100,
        tarea_estado: 'aprobada', editor_actual_id: 8, fecha_entrega_actual: '2026-10-21' }],
      fotos: [{ id: photoId, tipo: 'Storefront', estado: 'realizada' }],
    }] });
  }
  assert.deepEqual(input, before);
  assert.equal(filterReportDataForUser(input, { rol: 'admin' }).producciones, input.producciones);
});

test('registry schemas reject financial objects under allowed keys, malformed IDs and unknown states', () => {
  const secret = { importe: 'FINANCE_SENTINEL' };
  const source = productionInput();
  source.desde = secret;
  Object.assign(source.visitas[0], { titulo: secret, cliente_id: '11', id: secret });
  Object.assign(source.visitas[0].videos[0], { titulo: secret, estado: 'paid', tarea_estado: secret, editor_actual_id: '8', fecha_entrega_actual: secret });
  Object.assign(source.visitas[0].fotos[0], { tipo: secret, estado: 'invoiced' });
  const result = filterReportDataForUser({ ...data, producciones: source }, { id: 7, rol: 'edicion' }).producciones;
  assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL|paid|invoiced/);
  assert.equal(result.visitas[0].cliente_id, undefined);
  assert.equal(result.visitas[0].videos[0].editor_actual_id, undefined);
  assert.equal(result.visitas[0].videos[0].estado, undefined);
});

test('disabled or invalid identities fail closed including shared production and summaries', () => {
  for (const auth of [{ id: '7', rol: 'community' },
    { id: 0, rol: 'diseno' }, { id: 7, rol: 'edicion', activo: false }, { rol: 'produccion' }, {}]) {
    const result = filterReportDataForUser({ ...data, producciones: productionInput() }, auth);
    for (const [key, value] of Object.entries(result)) {
      assert.deepEqual(value, key === 'resumenRenderOsPorDia' ? {} : key === 'producciones' ? { visitas: [] } : []);
    }
  }
});

test('unknown active roles retain only sanitized shared registry with range and their own user ID', () => {
  const input = { ...data, usuarios: [{ id: 7, nombre: 'Own', abono: 'FINANCE_SENTINEL' }, { id: 8, nombre: 'Other' }], producciones: productionInput() };
  const expected = filterReportDataForUser(input, { id: 7, rol: 'produccion' }).producciones;
  for (const rol of ['unknown', 'lider', 'new-role', undefined]) {
    const result = filterReportDataForUser(input, { id: 7, rol, activo: true });
    assert.deepEqual(result.producciones, expected);
    assert.equal(result.producciones.desde, '2026-10-01');
    assert.equal(result.producciones.hasta, '2026-11-01');
    assert.deepEqual(result.usuarios, [{ id: 7, nombre: 'Own' }]);
    for (const key of ['tareas', 'tareasRenderOs', 'historias', 'publicaciones', 'clientes', 'entregasEdicion']) assert.deepEqual(result[key], []);
    assert.deepEqual(result.resumenRenderOsPorDia, {});
    assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL/);
  }
});

test('report reel quotas preserve actual SQL numeric values without financial fields or manufactured defaults', () => {
  const input = { ...data, clientes: [{ id: 11, cuota_reels: 4, cuota_feed_reels: 8, cuota_carruseles: 2,
    grupo_feed_id: 10, abono: 'FINANCE_SENTINEL' }, { id: 12 }] };
  const result = filterReportDataForUser(input, { id: 1, rol: 'diseno' });
  assert.deepEqual(result.clientes[0], { id: 11, cuota_reels: 4, cuota_feed_reels: 8, cuota_carruseles: 2, grupo_feed_id: 10 });
  assert.deepEqual(result.clientes[1], { id: 12 });
  for (const value of [0, 3]) {
    const row = filterReportDataForUser({ ...input, clientes: [{ id: 1, cuota_reels: value, cuota_feed_reels: value }] }, { id: 1, rol: 'diseno' }).clientes[0];
    assert.equal(row.cuota_reels, value);
    assert.equal(row.cuota_feed_reels, value);
  }
  for (const value of [-1, Infinity, NaN, '4', null, { importe: 'FINANCE_SENTINEL' }]) {
    const row = filterReportDataForUser({ ...input, clientes: [{ id: 1, cuota_reels: value, cuota_feed_reels: value }] }, { id: 1, rol: 'diseno' }).clientes[0];
    assert.deepEqual(row, { id: 1 });
  }
});

test('identity and client scope cannot be obtained from inherited task fields or auth claims', () => {
  const inherited = Object.create({ asignado_a_id: 7, colaborador_ids: [7], cliente_id: 11 });
  inherited.id = 55;
  const result = filterReportDataForUser({ ...data, tareas: [inherited], tareasRenderOs: [] }, { id: 7, rol: 'diseno' });
  assert.deepEqual(result.tareas, []);
  assert.deepEqual(result.publicaciones, []);
  assert.deepEqual(filterReportDataForUser(data, Object.create({ id: 1, rol: 'admin' })).tareas, []);
});

test('daily aggregate is computed only after role and task-ID scope; empty own rows reveal no activity', () => {
  const input = { ...data, tareasRenderOs: [
    { id: 1, asignado_a_id: 8, titulo: 'Other carousel', subtipo: 'carrusel', estado: 'finalizada', fecha_vencimiento: '2026-10-19' },
    { id: 2, asignado_a_id: 7, titulo: 'Own carousel', subtipo: 'carrusel', estado: 'pendiente', fecha_vencimiento: '2026-10-20' },
  ] };
  for (const rol of ['diseno', 'produccion', 'edicion', 'programacion']) {
    const result = filterReportDataForUser(input, { id: 7, rol });
    assert.deepEqual(result.resumenRenderOsPorDia, { '2026-10-20': { carruseles: { total: 1, publicadas: 0 } } });
    assert.deepEqual(filterReportDataForUser(input, { id: 99, rol }).resumenRenderOsPorDia, {});
  }
  assert.deepEqual(filterReportDataForUser(input, { id: 7, rol: 'community' }).resumenRenderOsPorDia, {});
  assert.equal(Object.keys(filterReportDataForUser(input, { rol: 'admin' }).resumenRenderOsPorDia).length, 2);
});

test('production registry dedupe evidence survives only as an explicit boolean independent of date range', () => {
  const make = value => ({ ...data, tareasRenderOs: [{ id: 1, asignado_a_id: 7,
    produccion_registro_individual: value, propiedades_extra: {} }], producciones: { desde: '2026-10-01', hasta: '2026-11-01', visitas: [] } });
  for (const value of [true, false]) {
    const result = filterReportDataForUser(make(value), { id: 7, rol: 'produccion' });
    assert.equal(result.tareasRenderOs[0].produccion_registro_individual, value);
  }
  for (const value of ['true', 1, null, {}, ['true']]) {
    assert.equal(Object.hasOwn(filterReportDataForUser(make(value), { id: 7, rol: 'produccion' }).tareasRenderOs[0], 'produccion_registro_individual'), false);
  }
});

test('personal editorial scope uses exact story/publication IDs on current membership in both task sources', () => {
  const input = { ...data, tareas: [{ id: 1, asignado_a_id: 7, historia_id: 5, publicacion_id: 6 }],
    tareasRenderOs: [{ id: 2, asignado_a_id: 8, colaborador_ids: [7], publicacion_id: 7 }],
    historias: [{ id: 5, estado: 'publicada' }, { id: 50, cliente_id: 10, estado: 'publicada' }],
  };
  for (const rol of ['diseno', 'edicion', 'produccion', 'programacion']) {
    const result = filterReportDataForUser(input, { id: 7, rol });
    assert.deepEqual(result.historias.map(row => row.id), [5]);
    assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7]);
    assert.equal(result.tareas[0].historia_id, 5);
    assert.equal(result.tareas[0].publicacion_id, 6);
    assert.deepEqual(filterReportDataForUser(input, { id: 99, rol }).publicaciones, []);
  }
  const community = filterReportDataForUser(input, { id: 99, rol: 'community' });
  assert.deepEqual(community.historias.map(row => row.id), [5, 50]);
  assert.deepEqual(community.publicaciones.map(row => row.id), [6, 7, 8]);
});

test('historical editing credit and malformed task links cannot authorize editorial records', () => {
  for (const id of [null, '5', 0, -1, 1.5, {}, Infinity]) {
    const input = { ...data, tareas: [{ id: 1, asignado_a_id: 7, historia_id: id, publicacion_id: id }], tareasRenderOs: [] };
    const result = filterReportDataForUser(input, { id: 7, rol: 'edicion' });
    assert.deepEqual(result.historias, []);
    assert.deepEqual(result.publicaciones, []);
    assert.equal(Object.hasOwn(result.tareas[0], 'historia_id'), id === null);
    assert.equal(Object.hasOwn(result.tareas[0], 'publicacion_id'), id === null);
  }
  const input = { ...data, tareas: [{ id: 1, asignado_a_id: 8, publicacion_id: 6, historia_id: 5,
    propiedades_extra: { edicion_responsable_id: 7 } }], tareasRenderOs: [] };
  const result = filterReportDataForUser(input, { id: 7, rol: 'edicion' });
  assert.equal(result.tareas.length, 1, 'stable historical work credit remains visible');
  assert.deepEqual(result.historias, []);
  assert.deepEqual(result.publicaciones, []);
});
