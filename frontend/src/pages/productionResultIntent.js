const MAX = 2147483647;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= MAX;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX;
const uuid = value => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const invalid = () => new Error('No pudimos verificar el resultado. Conservá el intento y verificá antes de continuar.');
const check = condition => { if (!condition) throw invalid(); };
const id = value => { check(uuid(value)); return value.toLowerCase(); };
const text = (value, max = 20000, required = false) => {
  check(typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()))); return value;
};
const link = value => {
  text(value, 4000);
  if (value) { let parsed; try { parsed = new URL(value); } catch { throw invalid(); }
    check(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password); }
  return value;
};
const date = value => {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const parsed = new Date(`${value}T00:00:00Z`);
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value); return value;
};
const unique = values => { check(new Set(values).size === values.length); };
const freeze = value => {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Validate server evidence, then copy only the journal's public columns. Never
 * return raw rows, receipts, financial fields or mutable caller-owned objects.
 */
export function verifyProductionResult(row, { visitId, expectedRevision, actorId } = {}) {
  check(object(row)); const expectedVisit = id(visitId);
  check(id(row.visita_id) === expectedVisit && positive(row.visita_revision) && row.visita_revision < MAX
    && row.revision_resultante === row.visita_revision + 1 && positive(row.registrado_por_id)
    && typeof row.vigente === 'boolean');
  if (expectedRevision !== undefined) check(positive(expectedRevision) && row.visita_revision === expectedRevision);
  if (actorId !== undefined) check(positive(actorId) && row.registrado_por_id === actorId);
  check(typeof row.registrado_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(row.registrado_at)
    && Number.isFinite(Date.parse(row.registrado_at)));
  date(row.registrado_at.slice(0, 10));
  const summary = row.resumen; check(object(summary) && summary.version === 1 && object(summary.visita));
  const source = summary.visita;
  check(id(source.id) === expectedVisit && (source.tarea_origen_id === null || positive(source.tarea_origen_id))
    && positive(source.cliente_id) && Array.isArray(source.participante_ids) && source.participante_ids.every(positive));
  unique(source.participante_ids);
  const visita = { id: expectedVisit, tarea_origen_id: source.tarea_origen_id, cliente_id: source.cliente_id,
    fecha: date(source.fecha), titulo: text(source.titulo, 250, true), participante_ids: [...source.participante_ids],
    drive_url: link(source.drive_url), observaciones: text(source.observaciones) };
  check(Array.isArray(summary.videos) && Array.isArray(summary.fotos) && summary.videos.length + summary.fotos.length > 0
    && count(summary.previstos) && summary.videos.length >= summary.previstos);
  const videos = summary.videos.map(video => {
    check(object(video) && ['grabado', 'pendiente', 'repetir'].includes(video.estado));
    const result = { id: id(video.id), video_origen_id: video.video_origen_id === null ? null : id(video.video_origen_id),
      titulo: text(video.titulo, 250, true), guion: text(video.guion), estado: video.estado,
      material_url: link(video.material_url), observaciones: text(video.observaciones) };
    check(video.estado === 'grabado' || Boolean(result.guion.trim())); return result;
  });
  const fotos = summary.fotos.map(photo => {
    check(object(photo) && ['realizada', 'pendiente', 'repetir'].includes(photo.estado));
    return { id: id(photo.id), tipo: text(photo.tipo, 250, true), estado: photo.estado,
      drive_url: link(photo.drive_url), observaciones: text(photo.observaciones) };
  });
  unique(videos.map(video => video.id)); unique(fotos.map(photo => photo.id));
  const numberOf = (items, state) => items.filter(item => item.estado === state).length;
  const conteos = { videos_grabados: numberOf(videos, 'grabado'), videos_pendientes: numberOf(videos, 'pendiente'),
    videos_repetir: numberOf(videos, 'repetir'), fotos_realizadas: numberOf(fotos, 'realizada'),
    fotos_pendientes: numberOf(fotos, 'pendiente'), fotos_repetir: numberOf(fotos, 'repetir') };
  check(object(summary.conteos) && Object.entries(conteos).every(([key, value]) => summary.conteos[key] === value));
  const parcial = conteos.videos_pendientes + conteos.videos_repetir + conteos.fotos_pendientes + conteos.fotos_repetir > 0;
  check(summary.parcial === parcial);
  return freeze({ id: id(row.id), visita_id: expectedVisit, visita_revision: row.visita_revision,
    revision_resultante: row.revision_resultante, registrado_por_id: row.registrado_por_id, registrado_at: row.registrado_at,
    resumen: { version: 1, visita, videos, fotos, previstos: summary.previstos, conteos, parcial }, vigente: row.vigente });
}

export function verifyProductionResultPage(body, visitId) {
  check(object(body) && id(body.visita_id) === id(visitId) && positive(body.revision)
    && Array.isArray(body.resultados) && body.resultados.length <= 20);
  const resultados = body.resultados.map(row => verifyProductionResult(row, { visitId }));
  unique(resultados.map(row => row.id));
  resultados.forEach((row, index) => {
    check(row.revision_resultante <= body.revision && row.vigente === (row.revision_resultante === body.revision));
    if (index) check(resultados[index - 1].visita_revision > row.visita_revision);
  });
  const cursor = body.next_before_revision;
  check(cursor === null || (positive(cursor) && resultados.length === 20 && cursor === resultados.at(-1).visita_revision));
  return freeze({ visita_id: id(visitId), revision: body.revision, resultados, next_before_revision: cursor });
}

// A single human intent, kept only in document memory. send receives a frozen
// JSON body object (POST) or undefined (GET), and the original captured scope.
export function createProductionResultIntent({ capture, send, onState = () => {}, randomUUID = () => globalThis.crypto.randomUUID() }) {
  let held = null, status = 'idle', busy = false, accepted = null, error = '', disposed = false;
  const snapshot = () => Object.freeze({ status, busy, locked: !['idle', 'confirmed'].includes(status), accepted, error });
  const current = () => {
    try { if (disposed) return false; if (held) { if (!held.scope.current()) return false; held.scope.assertCurrent?.(); } return true; }
    catch { return false; }
  };
  const publish = () => { if (current()) try { onState(snapshot()); } catch { /* Observers cannot alter admission. */ } };
  const retire = () => { status = 'blocked'; error = 'La sesión cambió. No enviaremos más cambios desde este intento.'; };
  async function run(method, initial = false) {
    if (busy || !held || disposed) return false;
    if (!current()) { retire(); return false; }
    const attempt = held, wasConflict = status === 'conflict';
    busy = true; status = method === 'GET' ? 'checking' : 'writing'; error = ''; publish();
    try {
      if (!current()) { retire(); return false; }
      const response = await send(Object.freeze({ method,
        path: method === 'POST' ? attempt.path : `${attempt.path}/intentos/${attempt.requestId}`,
        body: method === 'POST' ? attempt.body : undefined }), attempt.scope);
      if (!current() || held !== attempt) { retire(); return false; }
      check(object(response) && (method === 'GET' || typeof response.created === 'boolean'));
      const result = verifyProductionResult(response.resultado, { visitId: attempt.visitId,
        expectedRevision: attempt.revision, actorId: attempt.actorId });
      if (accepted && accepted.visita_id === result.visita_id && accepted.visita_revision === result.visita_revision) check(accepted.id === result.id);
      accepted = result; status = 'confirmed'; return true;
    } catch (reason) {
      if (!current() || held !== attempt) { retire(); return false; }
      if ([401, 403].includes(reason?.status) || reason?.code === 'session_binding_obsolete'
        || ['BrowserSessionError', 'BrowserSessionControllerError', 'ApplicationSessionError'].includes(reason?.name)) retire();
      else if (reason?.status === 409) { status = 'conflict'; error = 'El resultado cambió o este intento no coincide. Verificá el intento antes de continuar.'; }
      else if (initial && method === 'POST' && [400, 413, 422].includes(reason?.status)) {
        status = 'idle'; held = null; error = 'Revisá el material y actualizá la visita antes de registrar el resultado.';
      } else { status = wasConflict ? 'conflict' : 'uncertain'; error = invalid().message; }
      return false;
    } finally { busy = false; publish(); }
  }
  return Object.freeze({ get snapshot() { return snapshot(); },
    start(visit) {
      if (disposed || busy || !['idle', 'confirmed'].includes(status)) return Promise.resolve(false);
      if (held && !current()) { retire(); return Promise.resolve(false); }
      busy = true;
      try {
        const visitId = id(visit?.id), revision = visit?.revision;
        check(positive(revision) && revision < MAX);
        if (accepted && accepted.visita_id === visitId) check(revision > accepted.revision_resultante);
        const scope = capture(); check(scope && typeof scope.current === 'function' && positive(scope.actorId));
        try { if (!scope.current()) { retire(); busy = false; return Promise.resolve(false); } scope.assertCurrent?.(); }
        catch { retire(); busy = false; return Promise.resolve(false); }
        const requestId = id(randomUUID());
        const serialized = JSON.stringify({ request_id: requestId, expected_revision: revision });
        held = Object.freeze({ scope, actorId: scope.actorId, visitId, revision, requestId,
          body: freeze(JSON.parse(serialized)), path: `/api/producciones/${visitId}/resultados` });
        accepted = null;
      } catch { error = 'Actualizá la visita y revisá la sesión antes de registrar el resultado.'; busy = false; publish(); return Promise.resolve(false); }
      busy = false; return run('POST', true);
    },
    verify() { if (!current()) { retire(); return Promise.resolve(false); } return status === 'confirmed' ? Promise.resolve(true)
      : ['uncertain', 'conflict'].includes(status) ? run('GET') : Promise.resolve(false); },
    retry() { return status === 'uncertain' ? run('POST') : Promise.resolve(false); },
    dispose() { disposed = true; busy = false; retire(); },
  });
}
