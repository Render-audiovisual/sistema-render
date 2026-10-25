import React, {useEffect, useRef, useState} from 'react';
import {createProductionResultIntent} from './productionResultIntent.js';

export function ProductionResultRegister({visit, capture, onState, onSaved, disabled = false, registered = false}) {
  const callbacks = useRef({capture, onState, onSaved});
  callbacks.current = {capture, onState, onSaved};
  const [state, setState] = useState({status:'idle', busy:false, locked:false, error:''});
  const [readbackError, setReadbackError] = useState('');
  const [working,setWorking] = useState(false);
  const active = useRef(true), pending = useRef(false), model = useRef(null), heldScope = useRef(null);
  if (!model.current) model.current = createProductionResultIntent({
    capture: () => {
      const scope = callbacks.current.capture();
      heldScope.current = scope;
      return scope;
    },
    send: (command, scope) => scope.request(command.path, command.method === 'GET' ? {} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(command.body)}),
    onState: next => {
      if (!active.current) return;
      setState(next);
      callbacks.current.onState({...next, busy:next.busy || pending.current});
    },
  });
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; callbacks.current.onState({busy:false, locked:false}); };
  }, []);
  const run = async action => {
    if (!active.current || pending.current) return;
    pending.current = true; setWorking(true); setReadbackError('');
    try {
      const confirmed = await action();
      if (confirmed && active.current) {
        try { heldScope.current.assertCurrent(); await callbacks.current.onSaved(visit.id, heldScope.current); }
        catch { if (active.current) setReadbackError('El resultado está registrado. Actualizá la visita para consultar su versión actual.'); }
      }
    } finally {
      pending.current = false;
      if (active.current) { setWorking(false); callbacks.current.onState(model.current.snapshot); }
    }
  };
  const alreadyCurrent = state.accepted?.revision_resultante >= visit.revision;
  return <section aria-label="Registrar resultado de visita">
    {!state.locked && <button type="button" disabled={disabled || registered || working || state.busy || alreadyCurrent} onClick={() => {if(!disabled && !registered) void run(() => model.current.start({id:visit.id, revision:visit.revision}));}}>Registrar resultado</button>}
    {working && <p role="status">Verificando registro…</p>}
    {registered && state.status !== 'confirmed' && <p role="status">Esta versión ya tiene un resultado registrado.</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {['uncertain','conflict'].includes(state.status) && <button type="button" disabled={working || state.busy} onClick={() => run(() => model.current.verify())}>Verificar resultado</button>}
    {state.status === 'uncertain' && <button type="button" disabled={working || state.busy} onClick={() => run(() => model.current.retry())}>Reintentar mismo intento</button>}
    {state.status === 'confirmed' && <p role="status">Resultado registrado. Los guiones pendientes se conservan para próximas visitas.</p>}
    {readbackError && <p role="alert">{readbackError}</p>}
  </section>;
}
