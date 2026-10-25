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

// Integration369: the human-approved team report supersedes own-only record
// selection. Stable ID validation and financial allowlists remain mandatory;
// this reporting contract does not authorize direct task access or mutations.
test("diseño recibe tareas y piezas de todo el equipo, no solo sus carruseles", () => {
  const result = filterReportDataForUser(data, { id: 1, nombre: "Augusto Aguirre", rol: "diseno" });
  assert.deepEqual(result.tareas.map((item) => item.id), [1, 2]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [6, 7, 8]);
  assert.deepEqual(result.historias.map((item) => item.id), [5]);
  assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [3, 4]);
  assert.deepEqual(result.usuarios.map((item) => item.id), [1, 2]);
});

test("producción recibe tareas y contenido compartido de todos los clientes", () => {
  const result = filterReportDataForUser(data, { id: 2, nombre: "Germán Beltzer", rol: "produccion" });
  assert.deepEqual(result.tareasRenderOs.map((item) => item.id), [3, 4]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [6, 7, 8]);
  assert.deepEqual(result.historias.map((item) => item.id), [5]);
  assert.deepEqual(result.clientes.map(item => item.id), [10, 11]);
});

test("community conserva métricas globales e identidades operativas de todo el equipo", () => {
  const result = filterReportDataForUser(data, { id: 4, nombre: "Oriana", rol: "community" });
  assert.deepEqual(result.historias.map((item) => item.id), [5]);
  assert.deepEqual(result.publicaciones.map((item) => item.id), [6, 7, 8]);
  assert.deepEqual(result.usuarios.map(item => item.id), [1, 2]);
  assert.deepEqual(result.tareasRenderOs.map(item => item.id), [3, 4]);
});

test("el administrador identificado conserva todas las filas operativas por el mismo DTO cerrado", () => {
  const result = filterReportDataForUser(data, { id: 1, rol: "admin" });
  assert.deepEqual(result.tareasRenderOs.map(row => row.id), [3, 4]);
  assert.deepEqual(result.usuarios.map(row => row.id), [1, 2]);
});

test("edición conserva registros con identidad explícita y ve todos los clientes", () => {
  const result = filterReportDataForUser(data, { id: 3, nombre: "Luciano", rol: "edicion" });
  assert.deepEqual(result.entregasEdicion.map((item) => item.id), [9]);
  assert.deepEqual(result.clientes.map(item => item.id), [10, 11]);
});

test('all five operational roles and admin receive the same team/client IDs without assignments, through financial allowlists', () => {
  const secret = { importe: 'FINANCE_SENTINEL', sueldo: 'FINANCE_SENTINEL',
    password_hash: 'FINANCE_SENTINEL', finanzas: { abono: 'FINANCE_SENTINEL' } };
  const input = structuredClone(data);
  Object.assign(input, secret);
  for (const key of ['tareas', 'tareasRenderOs', 'historias', 'publicaciones', 'clientes', 'usuarios', 'entregasEdicion']) {
    input[key] = input[key].map(row => ({...row, ...secret}));
  }
  input.usuarios = [
    {id: 1, usuario: 'qa_team_a', nombre: 'Same Name', rol: 'diseno', ...secret},
    {id: 2, usuario: 'qa_team_b', nombre: 'Same Name', rol: 'produccion', ...secret},
  ];
  input.tareas.push({id: 90, titulo: 'Historical unassigned', asignado_a: 'Same Name',
    propiedades_extra: {...secret}, ...secret});
  input.entregasEdicion.push({id: 91, editor_clave: 'Same Name', cliente_etiqueta: 'Historical record', ...secret});
  input.producciones = productionInput();
  const before = structuredClone(input);
  const ids = {tareas: [1, 2, 90], tareasRenderOs: [3, 4], historias: [5], publicaciones: [6, 7, 8],
    clientes: [10, 11], usuarios: [1, 2], entregasEdicion: [9, 91]};
  for (const rol of ['diseno', 'edicion', 'produccion', 'programacion', 'community', 'admin']) {
    for (const viewer of [{id: 1, nombre: 'Renamed'}, {id: 999, nombre: 'Same Name'}]) {
      const result = filterReportDataForUser(input, {...viewer, rol, activo: true});
      for (const [key, expected] of Object.entries(ids))
        assert.deepEqual(result[key].map(row => row.id), expected, `${rol}: ${key} must not depend on viewer membership/name`);
      assert.deepEqual(result.usuarios.map(row => [row.id, row.usuario, row.nombre, row.rol]), [
        [1, 'qa_team_a', 'Same Name', 'diseno'], [2, 'qa_team_b', 'Same Name', 'produccion'],
      ]);
      const unassigned = result.tareas.find(row => row.id === 90);
      assert.equal(unassigned.asignado_a_id, null); assert.deepEqual(unassigned.colaborador_ids, []);
      assert.equal(Object.hasOwn(result.entregasEdicion.find(row => row.id === 91), 'editor_id'), false);
      assert.equal(result.producciones.visitas.length, 1);
      assert.doesNotMatch(JSON.stringify(result), /FINANCE_SENTINEL/);
      for (const key of Object.keys(secret)) assert.equal(Object.hasOwn(result, key), false);
    }
  }
  assert.deepEqual(input, before, 'Shared reporting sanitizes a copy, never rewrites source identities or assignments');
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

test('team report preserves exact assignment IDs across renames/homonyms without inferring historical labels', () => {
  const input = { ...data, tareas: [
    { id: 1, asignado_a: 'Same Name', asignado_a_id: 8, colaborador_ids: [] },
    { id: 2, asignado_a: 'Renamed', asignado_a_id: 7, colaborador_ids: [] },
    { id: 3, asignado_a: 'Other', asignado_a_id: 8, colaborador_ids: [7] },
    { id: 4, asignado_a: 'Same Name', propiedades_extra: { edicion_responsable: 'Same Name', colaboradores: ['Same Name'] } },
  ], usuarios: [{ id: 7, nombre: 'Renamed' }, { id: 8, nombre: 'Same Name' }] };
  for (const nombre of ['Same Name', 'Renamed', 'Mariano', 'Augusto']) {
    const result = filterReportDataForUser(input, { id: 7, nombre, rol: 'edicion' });
    assert.deepEqual(result.tareas.map(row => row.id), [1, 2, 3, 4]);
    assert.deepEqual(result.usuarios.map(row => row.id), [7, 8]);
    assert.equal(result.tareas[0].asignado_a_id, 8);
    assert.equal(result.tareas[1].asignado_a_id, 7);
    assert.deepEqual(result.tareas[2].colaborador_ids, [7]);
    assert.equal(result.tareas[3].asignado_a_id, null);
    assert.deepEqual(result.tareas[3].colaborador_ids, []);
  }
});

test('malformed assignment IDs remain unverified in shared rows and never fall back to names', () => {
  for (const asignado_a_id of [null, '7', 0, -1, 7.1, Infinity, {}, true]) {
    const result = filterReportDataForUser({ ...data, tareas: [{ id: 1, asignado_a: 'Alex', asignado_a_id,
      colaborador_ids: ['7', null, {}, 0, -1, 7.1] }] }, { id: 7, nombre: 'Alex', rol: 'edicion' });
    assert.equal(result.tareas.length, 1);
    assert.equal(result.tareas[0].asignado_a_id, null);
    assert.deepEqual(result.tareas[0].colaborador_ids, []);
  }
  const result = filterReportDataForUser({ ...data, tareas: [{ id: 1, asignado_a_id: 8, colaborador_ids: [7, '8', {}, -1], cliente_id: '11' }] }, { id: 7, rol: 'diseno' });
  assert.deepEqual(result.tareas[0].colaborador_ids, [7]);
  assert.equal(result.tareas[0].cliente_id, undefined);
});

test('team editorial rows no longer require viewer membership or links to the viewer tasks', () => {
  const input = { ...data, tareas: [{ id: 1, asignado_a_id: 7, cliente_id: 10, publicacion_id: 6 }],
    tareasRenderOs: [{ id: 2, asignado_a_id: 8, colaborador_ids: [7], cliente_id: 11, publicacion_id: 7 },
      { id: 3, asignado_a: 'Mariano', asignado_a_id: 8, cliente_id: 12 }],
    clientes: [...data.clientes, { id: 12, nombre: 'Luzin' }],
    publicaciones: [...data.publicaciones, { id: 9, cliente_id: 12, tipo: 'carrusel' }, { id: 10, cliente_id: 10, tipo: 'carrusel' }] };
  const result = filterReportDataForUser(input, { id: 7, nombre: 'Unknown Designer', rol: 'diseno' });
  assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7, 8, 9, 10]);
  const withoutMembership = filterReportDataForUser({ ...input, tareas: [], tareasRenderOs: [] }, { id: 7, nombre: 'Augusto', rol: 'diseno' });
  assert.deepEqual(withoutMembership.publicaciones.map(row => row.id), [6, 7, 8, 9, 10]);
});

test('legacy delivery labels never invent editor identity; attributed and unassigned history remain visible', () => {
  const input = { ...data, entregasEdicion: [
    { id: 1, editor_clave: 'Alex' }, { id: 2, editor_id: 7, editor_clave: 'Old label' },
    { id: 3, editor_id: 8, editor_clave: 'Alex' }, { id: 4, editor_id: '7', editor_clave: 'Alex' },
  ] };
  const result = filterReportDataForUser(input, { id: 7, nombre: 'Alex', rol: 'edicion' });
  assert.deepEqual(result.entregasEdicion.map(row => row.id), [1, 2, 3, 4]);
  assert.deepEqual(result.entregasEdicion.map(row => row.editor_id), [undefined, 7, 8, undefined]);
  assert.equal(Object.hasOwn(result.entregasEdicion[0], 'editor_id'), false);
  assert.equal(Object.hasOwn(result.entregasEdicion[3], 'editor_id'), false);
  assert.deepEqual(filterReportDataForUser(input, { id: 7, rol: 'community' }).entregasEdicion.map(row => row.id), [1, 2, 3, 4]);
  assert.equal(filterReportDataForUser(input, { id: 1, rol: 'admin' }).entregasEdicion.length, 4);
});

test('every operational role shares attributed and unassigned deliveries but retains financial redaction', () => {
  const input = { ...data, entregasEdicion: [
    { id: 1, editor_id: 7, editor_clave: 'Renamed', cliente_etiqueta: 'Own delivery', importe: 'FINANCE_SENTINEL' },
    { id: 2, editor_id: 8, editor_clave: 'Same name', cliente_etiqueta: 'OTHER_EDITOR_SENTINEL', importe: 'FINANCE_SENTINEL' },
    { id: 3, editor_clave: 'Same name', cliente_etiqueta: 'UNATTRIBUTED_SENTINEL', importe: 'FINANCE_SENTINEL' },
  ] };
  for (const rol of ['community', 'diseno', 'produccion', 'edicion', 'programacion']) {
    const result = filterReportDataForUser(input, { id: 7, nombre: 'Same name', rol });
    assert.deepEqual(result.entregasEdicion.map(row => row.id), [1, 2, 3]);
    assert.doesNotMatch(JSON.stringify(result.entregasEdicion), /FINANCE_SENTINEL/);
    assert.equal(result.entregasEdicion[2].cliente_etiqueta, 'UNATTRIBUTED_SENTINEL');
    assert.equal(Object.hasOwn(result.entregasEdicion[2], 'editor_id'), false);
    assert.equal(Object.hasOwn(result.entregasEdicion[1], 'importe'), false);
    assert.deepEqual(filterReportDataForUser(input, { id: 9, rol }).entregasEdicion.map(row => row.id), [1, 2, 3]);
  }
  const admin = filterReportDataForUser(input, { id: 1, rol: 'admin' });
  assert.deepEqual(admin.entregasEdicion.map(row => row.id), [1, 2, 3]);
  assert.doesNotMatch(JSON.stringify(admin), /FINANCE_SENTINEL/);
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

test('operational result evidence remains shared but nested financial and receipt fields never escape',()=>{
  const evidence={id:videoId,visita_revision:7,revision_resultante:8,registrado_at:'2026-10-25T12:00:00Z',parcial:true,vigente:true};
  for(const rol of ['diseno','edicion','community','produccion','programacion']) {
    const source=productionInput();Object.assign(source.visitas[0],{revision:8,ultimo_resultado:{...evidence,
      sueldo:'FINANCE_SENTINEL',request_id:'FINANCE_SENTINEL',resumen:{abono:'FINANCE_SENTINEL'}}});
    const row=filterReportDataForUser({producciones:source},{id:7,rol}).producciones.visitas[0];
    assert.equal(row.revision,8);assert.deepEqual(row.ultimo_resultado,{...evidence,registrado_at:'2026-10-25T12:00:00.000Z'});
    assert.doesNotMatch(JSON.stringify(row),/FINANCE_SENTINEL|request_id|resumen/);
  }
});

test('malformed or accessor result evidence is unavailable rather than absent or current',()=>{
  for(const raw of [{revision_resultante:999},
    {id:videoId,visita_revision:7,revision_resultante:8,registrado_at:'2026-02-30T12:00:00Z',parcial:false,vigente:true},
    Object.defineProperty({},'id',{get(){assert.fail('Do not invoke nested getters');}})]) {
    const source=productionInput();Object.assign(source.visitas[0],{revision:8,ultimo_resultado:raw});
    const row=filterReportDataForUser({producciones:source},{id:7,rol:'edicion'}).producciones.visitas[0];
    assert.equal(row.revision,8);assert.equal(Object.hasOwn(row,'ultimo_resultado'),false);
  }
  const source=productionInput();Object.assign(source.visitas[0],{revision:8,ultimo_resultado:null});
  assert.equal(filterReportDataForUser({producciones:source},{id:7,rol:'edicion'}).producciones.visitas[0].ultimo_resultado,null);
});

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
  assert.deepEqual(filterReportDataForUser(input, { id: 1, rol: 'admin' }).producciones,
    filterReportDataForUser(input, { id: 7, rol: 'produccion' }).producciones);
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
    { id: 0, rol: 'diseno' }, { id: 7, rol: 'edicion', activo: false }, { rol: 'produccion' },
    {rol: 'admin'}, {id: '7', rol: 'admin'}, {id: 7, rol: 'admin', activo: false}, {}]) {
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

test('shared rows cannot obtain identity or client attribution from inherited fields or inherited auth', () => {
  const inherited = Object.create({ asignado_a_id: 7, colaborador_ids: [7], cliente_id: 11 });
  inherited.id = 55;
  const result = filterReportDataForUser({ ...data, tareas: [inherited], tareasRenderOs: [] }, { id: 7, rol: 'diseno' });
  assert.equal(result.tareas.length, 1); assert.equal(result.tareas[0].id, 55);
  assert.equal(result.tareas[0].asignado_a_id, null);
  assert.deepEqual(result.tareas[0].colaborador_ids, []);
  assert.equal(Object.hasOwn(result.tareas[0], 'cliente_id'), false);
  assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7, 8]);
  assert.deepEqual(filterReportDataForUser(data, Object.create({ id: 1, rol: 'admin' })).tareas, []);
});

test('daily aggregate includes all sanitized team tasks regardless of the viewer assignments', () => {
  const input = { ...data, tareasRenderOs: [
    { id: 1, asignado_a_id: 8, titulo: 'Other carousel', subtipo: 'carrusel', estado: 'finalizada', fecha_vencimiento: '2026-10-19' },
    { id: 2, asignado_a_id: 7, titulo: 'Own carousel', subtipo: 'carrusel', estado: 'pendiente', fecha_vencimiento: '2026-10-20' },
  ] };
  const expected = {
    '2026-10-19': { carruseles: { total: 1, publicadas: 1 } },
    '2026-10-20': { carruseles: { total: 1, publicadas: 0 } },
  };
  for (const rol of ['diseno', 'produccion', 'edicion', 'programacion', 'community']) {
    const result = filterReportDataForUser(input, { id: 7, rol });
    assert.deepEqual(result.resumenRenderOsPorDia, expected);
    assert.deepEqual(filterReportDataForUser(input, { id: 99, rol }).resumenRenderOsPorDia, expected);
  }
  assert.equal(Object.keys(filterReportDataForUser(input, { id: 1, rol: 'admin' }).resumenRenderOsPorDia).length, 2);
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

test('team editorial scope preserves link IDs but does not require viewer membership in either task source', () => {
  const input = { ...data, tareas: [{ id: 1, asignado_a_id: 7, historia_id: 5, publicacion_id: 6 }],
    tareasRenderOs: [{ id: 2, asignado_a_id: 8, colaborador_ids: [7], publicacion_id: 7 }],
    historias: [{ id: 5, estado: 'publicada' }, { id: 50, cliente_id: 10, estado: 'publicada' }],
  };
  for (const rol of ['diseno', 'edicion', 'produccion', 'programacion', 'community']) {
    const result = filterReportDataForUser(input, { id: 7, rol });
    assert.deepEqual(result.historias.map(row => row.id), [5, 50]);
    assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7, 8]);
    assert.equal(result.tareas[0].historia_id, 5);
    assert.equal(result.tareas[0].publicacion_id, 6);
    assert.deepEqual(filterReportDataForUser(input, { id: 99, rol }).publicaciones.map(row => row.id), [6, 7, 8]);
  }
  const community = filterReportDataForUser(input, { id: 99, rol: 'community' });
  assert.deepEqual(community.historias.map(row => row.id), [5, 50]);
  assert.deepEqual(community.publicaciones.map(row => row.id), [6, 7, 8]);
});

test('shared editorial visibility never manufactures valid link IDs or assignments from historical credit', () => {
  for (const id of [null, '5', 0, -1, 1.5, {}, Infinity]) {
    const input = { ...data, tareas: [{ id: 1, asignado_a_id: 7, historia_id: id, publicacion_id: id }], tareasRenderOs: [] };
    const result = filterReportDataForUser(input, { id: 7, rol: 'edicion' });
    assert.deepEqual(result.historias.map(row => row.id), [5]);
    assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7, 8]);
    assert.equal(Object.hasOwn(result.tareas[0], 'historia_id'), id === null);
    assert.equal(Object.hasOwn(result.tareas[0], 'publicacion_id'), id === null);
  }
  const input = { ...data, tareas: [{ id: 1, asignado_a_id: 8, publicacion_id: 6, historia_id: 5,
    propiedades_extra: { edicion_responsable_id: 7 } }], tareasRenderOs: [] };
  const result = filterReportDataForUser(input, { id: 7, rol: 'edicion' });
  assert.equal(result.tareas.length, 1, 'stable historical work credit remains visible');
  assert.deepEqual(result.historias.map(row => row.id), [5]);
  assert.deepEqual(result.publicaciones.map(row => row.id), [6, 7, 8]);
  assert.equal(result.tareas[0].asignado_a_id, 8);
  assert.deepEqual(result.tareas[0].colaborador_ids, []);
  assert.equal(result.tareas[0].propiedades_extra.edicion_responsable_id, 7);
});
