import React, { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { captureSessionBinding, sessionBindingMatches } from '../shared/session/session-binding.js';
import { getSesion } from '../utils.jsx';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';
import { navigateWithinApp } from '../shared/navigation/location.js';
import { createGoalDraftMemory, makeGoalDraftHref } from '../shared/navigation/goalDraftMemory.js';
import './GoalDraftMemoryProvider.css';

const GoalDraftMemoryContext = createContext(null);
export const useGoalDraftMemory = () => useContext(GoalDraftMemoryContext);

// Document-only form memory, never operational persistence. The authenticated
// shell keys this provider by observation, not by a person's name or numeric ID.
export function GoalDraftMemoryProvider({ session, children }) {
  const binding = useRef(captureSessionBinding(session)), mounted = useRef(true), memoryRef = useRef(null);
  if (!memoryRef.current) memoryRef.current = createGoalDraftMemory({
    isCurrent: () => mounted.current && sessionBindingMatches(binding.current, getSesion()),
  });
  const memory = memoryRef.current;
  useLayoutEffect(() => {
    mounted.current = true;
    // Clear before withdrawing the lease, so StrictMode's cleanup/setup probe
    // cannot make a synchronous subscriber permanently retire a fresh store.
    return () => { memory.reset(); mounted.current = false; };
  }, [memory]);
  useNavigationGuard(context => ({ dirty: context?.type === 'unload' && Boolean(memory.getSnapshot()), busy: false }));
  return <GoalDraftMemoryContext.Provider value={memory}>
    <GoalDraftRecoveryNotice memory={memory} />
    {children}
  </GoalDraftMemoryContext.Provider>;
}

export function GoalDraftRecoveryNotice({ memory }) {
  const draft = useSyncExternalStore(memory.subscribe, memory.getSnapshot, memory.getServerSnapshot);
  if (!draft) return null;
  const saving = draft.status === 'saving';
  return <aside className="render-goal-draft-notice" aria-label="Borrador de contenido">
    <div role="status"><strong>Contenido sin guardar</strong>
      <p>{saving ? 'El guardado está en curso. No cierres esta pestaña.' : draft.status === 'uncertain'
        ? 'No se pudo confirmar el guardado. Retomá el borrador para revisar el contenido.'
        : 'Podés retomar el borrador en esta pestaña. Todavía no se guardó en la tarea.'}</p>
    </div>
    <div className="render-goal-draft-actions">
      <button type="button" disabled={saving} onClick={() => {
        if (memory.getSnapshot() !== draft) return;
        const href = makeGoalDraftHref(draft); if (!href) return;
        const target = new URL(href, window.location.href), current = new URL(window.location.href);
        target.searchParams.sort(); current.searchParams.sort();
        if (target.href === current.href) window.dispatchEvent(new CustomEvent('render:retry-goal-draft'));
        else navigateWithinApp(window, href);
      }}>Retomar</button>
      <button type="button" disabled={saving} onClick={() => {
        if (memory.getSnapshot() === draft && window.confirm('¿Descartar este borrador de contenido sin guardar?')) memory.clear(draft);
      }}>Descartar</button>
    </div>
  </aside>;
}
