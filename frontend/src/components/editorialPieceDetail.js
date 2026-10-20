import { canReadEditorialControl, homeEditorialRecordPiece } from './homeEditorialControl.js';

const fields = ['idea', 'copy', 'material_referencia', 'aclaraciones'];
export function parseEditorialPieceDetail(value, expected) {
  const piece = value?.piece, content = value?.content;
  const identity = homeEditorialRecordPiece(piece);
  if (value?.version !== 1 || !identity || piece.domain !== expected.domain || piece.id !== expected.id
    || identity.cliente_id !== expected.cliente.id || typeof piece.titulo !== 'string' || piece.titulo.length > 160
    || (piece.domain === 'historia' ? piece.tipo !== 'historia' : !['video', 'reel', 'carrusel', 'flyer'].includes(piece.tipo))
    || typeof piece.cliente.nombre !== 'string' || piece.cliente.nombre.length > 250
    || !['no_publicada', 'historica_sin_confirmacion', 'confirmada_manualmente'].includes(piece.publication_classification)
    || (piece.publication_classification === 'confirmada_manualmente' && (piece.estado !== 'publicada' || !piece.fecha_programada))
    || (piece.publication_classification === 'no_publicada' && piece.estado === 'publicada')
    || !content || fields.some(key => !(content[key] === null || typeof content[key] === 'string')))
    throw new Error('La pieza cambió o el detalle no es válido.');
  return { version: 1, piece: { domain: piece.domain, id: piece.id, titulo: piece.titulo, tipo: piece.tipo,
    estado: piece.estado, cliente: { id: identity.cliente_id, nombre: piece.cliente.nombre },
    fecha_programada: piece.fecha_programada, publication_classification: piece.publication_classification },
  content: Object.fromEntries(fields.map(key => [key, content[key]])) };
}

export function createEditorialPieceDetailLoader({ sesion, piece, readSession, request, onChange }) {
  const captured = { id: sesion?.usuario?.id, role: sesion?.usuario?.rol, active: sesion?.usuario?.activo, token: sesion?.token };
  const expected = { domain: piece?.domain, id: piece?.id, cliente: { id: piece?.cliente?.id } };
  const validPiece = homeEditorialRecordPiece(piece);
  let controller, generation = 0, disposed = false;
  const authorized = () => {
    const current = readSession();
    return canReadEditorialControl(current) && current.usuario.id === captured.id && current.usuario.rol === captured.role
      && current.usuario.activo === captured.active && current.token === captured.token;
  };
  async function refresh() {
    if (disposed) return false;
    if (!validPiece || !authorized()) {
      ++generation; controller?.abort();
      onChange({ status: 'error', data: null, error: 'La sesión o la pieza cambió. Volvé a abrir el detalle.' }); return false;
    }
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, version = ++generation;
    const stale = () => disposed || signal.aborted || generation !== version;
    onChange({ status: 'loading', data: null, error: '' });
    try {
      const value = await request(`/api/editorial-control/${expected.domain}/${expected.id}`, { method: 'GET', signal });
      if (stale()) return false;
      if (!authorized()) throw new Error('Session changed');
      onChange({ status: 'ready', data: parseEditorialPieceDetail(value, expected), error: '' });
    } catch {
      if (stale()) return false;
      onChange({ status: 'error', data: null, error: 'No pudimos consultar esta pieza. Actualizá la lista o reintentá.' });
    }
    return true;
  }
  return { refresh, dispose() { disposed = true; ++generation; controller?.abort(); } };
}
