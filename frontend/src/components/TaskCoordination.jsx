import React, { useEffect, useRef, useState } from 'react';
import { getSesion } from '../utils.jsx';
import { buildCoordinationPatch, canEditTaskCoordination, coordinateSnapshot } from './taskCoordination.js';

// Parent keys this component by task identity and incorporates dirty/busy in its guard.
export function TaskCoordination({ task, sesion, onUpdate, onDraftStateChange }) {
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  const callback = useRef(onDraftStateChange);
  callback.current = onDraftStateChange;
  const allowed = canEditTaskCoordination(task, sesion);
  const current = coordinateSnapshot(task);
  const dirty = Boolean(editor && (editor.draft.horario !== editor.snapshot.horario
    || editor.draft.coordinada !== editor.snapshot.coordinada));

  useEffect(() => { callback.current?.({ dirty, busy }); }, [dirty, busy]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; callback.current?.({ dirty: false, busy: false }); };
  }, []);

  function open() {
    if (!allowed || !current.valid || pending.current) return;
    setEditor({ snapshot: current, draft: { horario: current.horario, coordinada: current.coordinada },
      token: sesion?.token, userId: sesion.usuario.id, role: sesion.usuario.rol });
    setConflict(false); setError('');
  }

  function sessionMatches() {
    const actual = getSesion();
    return Boolean(editor?.token && actual?.token === editor.token && sesion?.token === editor.token
      && actual?.usuario?.id === editor.userId && actual?.usuario?.rol === editor.role
      && sesion?.usuario?.id === editor.userId && sesion?.usuario?.rol === editor.role);
  }

  async function save(event) {
    event.preventDefault();
    if (!editor || !dirty || conflict || pending.current) return;
    if (!allowed || task.id !== editor.snapshot.id || !sessionMatches()) {
      setConflict(true); setError('La sesión o los permisos cambiaron. Cancelá y volvé a abrir la coordinación.'); return;
    }
    let changes;
    try { changes = buildCoordinationPatch(editor.snapshot, editor.draft); }
    catch (reason) { setError(reason.message); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      await onUpdate(editor.snapshot.id, { propiedades_extra: changes }, 'actualizó la coordinación', editor.snapshot.revision);
      if (!mounted.current) return;
      if (!sessionMatches()) { setConflict(true); setError('La sesión cambió. Cancelá y volvé a abrir la coordinación.'); return; }
      setEditor(null);
    } catch (reason) {
      if (!mounted.current) return;
      // Preserve draft and captured revision. Never retry or rebase after a conflict.
      setConflict(true);
      setError(reason?.status === 409
        ? 'La tarea cambió. Cancelá, revisá la versión actual y volvé a abrir la coordinación.'
        : 'No se pudo confirmar el cambio. Cancelá y revisá la tarea antes de volver a editar.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!allowed && !editor) return null;
  return <section className="ros-work-block ros-recorded-context">
    <h3>Coordinación registrada</h3>
    <p>Texto de coordinación de la tarea; no modifica fechas ni registra una visita.</p>
    {!editor ? current.valid
      ? <button type="button" onClick={open}>Editar coordinación</button>
      : <p role="status">Registro histórico de solo lectura: faltan datos de versión o contiene valores no compatibles. No se convertirá automáticamente.</p>
      : <form onSubmit={save}>
        <fieldset disabled={busy || conflict || !allowed}>
          <label>Horario o indicaciones
            <textarea className="ros-detail-input" maxLength={2000} value={editor.draft.horario ?? ''}
              onChange={event => { const horario = event.target.value; setEditor(previous => ({ ...previous,
                draft: { ...previous.draft, horario: horario === '' && previous.snapshot.horario === undefined ? undefined : horario } })); }}/>
          </label>
          <label>Coordinada
            <select value={editor.draft.coordinada === undefined ? '' : editor.draft.coordinada ? 'yes' : 'no'}
              onChange={event => { const coordinada = event.target.value === '' ? undefined : event.target.value === 'yes';
                setEditor(previous => ({ ...previous, draft: { ...previous.draft, coordinada } })); }}>
              <option value="" disabled={editor.snapshot.coordinada !== undefined}>Sin registrar</option>
              <option value="yes">Sí</option><option value="no">No</option>
            </select>
          </label>
          <button type="submit" disabled={!dirty}>{busy ? 'Guardando…' : 'Guardar coordinación'}</button>
        </fieldset>
        <button type="button" disabled={busy} onClick={() => { setEditor(null); setConflict(false); setError(''); }}>Cancelar</button>
      </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default TaskCoordination;
