import React, { useEffect, useRef, useState } from 'react';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { useNavigationGuard } from '../shared/navigation/useNavigationGuard.js';

function contractRevision(value, id) {
  if (typeof value !== 'string') return null;
  const match = /^fc1:([1-9]\d*):([1-9]\d*)$/.exec(value);
  if (!match || match[0] !== value) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(n => n <= 2147483647) && (id === undefined || String(parts[0]) === String(id)) ? parts : null;
}
function contractDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function contractRow(row) {
  return row && Number.isSafeInteger(row.id) && row.id > 0 && row.id <= 2147483647
    && contractRevision(row.contract_revision, row.id) && typeof row.nombre === 'string' && row.nombre.trim()
    && ['number', 'string'].includes(typeof row.importe_mensual) && String(row.importe_mensual).trim() === String(row.importe_mensual)
    && /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(String(row.importe_mensual))
    && Number.isFinite(Number(row.importe_mensual)) && Number(row.importe_mensual) >= 0
    && contractDate(row.inicia_el) && (row.finaliza_el === null || contractDate(row.finaliza_el)) && typeof row.activo === 'boolean';
}
function contractDraft(row) {
  return { nombre: row.nombre, importe_mensual: String(row.importe_mensual), inicia_el: row.inicia_el, finaliza_el: row.finaliza_el || '' };
}
function contractPayload(draft) {
  if (!draft.nombre.trim() || draft.nombre.trim().length > 250
    || String(draft.importe_mensual).trim() !== String(draft.importe_mensual)
    || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(draft.importe_mensual) || !contractDate(draft.inicia_el)
    || draft.finaliza_el && !contractDate(draft.finaliza_el)) throw new Error('Completá nombre, monto y fechas válidas del contrato financiero.');
  return { nombre: draft.nombre.trim(), importe_mensual: String(draft.importe_mensual), inicia_el: draft.inicia_el, finaliza_el: draft.finaliza_el || null };
}
function assertContractAck(row, intent) {
  if (!contractRow(row)) throw new Error('La respuesta no confirmó el contrato financiero.');
  if (intent.kind !== 'create') {
    const before = contractRevision(intent.revision, intent.id), after = contractRevision(row.contract_revision, intent.id);
    if (!before || !after || after[1] <= before[1]) throw new Error('La respuesta no confirmó una nueva revisión del contrato financiero.');
  }
  for (const [key, value] of Object.entries(intent.payload)) {
    if (key === 'importe_mensual' ? Number(row[key]) !== Number(value) : row[key] !== value) throw new Error('La respuesta no confirmó los valores guardados.');
  }
  if (intent.kind === 'create' && row.activo !== true) throw new Error('La respuesta no confirmó el alta del contrato.');
  if (intent.kind === 'toggle' && row.activo === true && row.finaliza_el !== null) throw new Error('La respuesta no confirmó la reactivación.');
  return row;
}
const emptyContract = () => ({ nombre: '', importe_mensual: '', inicia_el: new Date().toISOString().slice(0, 10), finaliza_el: '' });

export function FinanceContractsPanel({ sesion, ...props }) {
  const { view, epoch } = useScopedRequest(sesion, 'financial-contracts');
  return <ContractsSession key={`${view.key}:${epoch}`} {...props} sesion={view.session}/>;
}
export default FinanceContractsPanel;

function ContractsSession({ contracts = [], sesion, ars, onSaved, onActivityChange, disabled = false, onBeforeEdit }) {
  const [editing, setEditing] = useState(null), [draft, setDraft] = useState(null);
  const [newContract, setNewContract] = useState(emptyContract);
  const newBaseline = useRef(JSON.stringify(newContract));
  const [rows, setRows] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [blocked, setBlocked] = useState(null);
  const pending = useRef(false), blockedRef = useRef(null), createConsumed = useRef(null), activityCallback = useRef(onActivityChange);
  activityCallback.current = onActivityChange;
  const { capture } = useScopedRequest(sesion, editing ? `contract:${editing.id}` : 'contract:create');
  const dirty = Boolean(blocked || editing && JSON.stringify(draft) !== JSON.stringify(contractDraft(editing))
    || JSON.stringify(newContract) !== newBaseline.current);
  const contractNavigationStatus = () => !capture().current() ? {dirty:false,busy:false} : {dirty:dirty || Boolean(blockedRef.current),busy:pending.current};
  useNavigationGuard(contractNavigationStatus);
  useEffect(() => { activityCallback.current?.(loading || dirty || Boolean(editing)); }, [loading, dirty, editing]);
  useEffect(() => () => { activityCallback.current?.(false); }, []);
  useEffect(() => { if (!pending.current && !dirty) setRows(null); }, [contracts]);
  const visible = rows || contracts;
  const admitEdit = () => !disabled && capture().current() && onBeforeEdit?.() !== false;

  const openEdit = row => {
    const guard = capture();
    if (pending.current || blockedRef.current || editing || dirty || !guard.current() || !admitEdit()) return;
    if (!contractRow(row)) { setError('Cargá una versión válida del contrato financiero antes de editar.'); return; }
    setEditing({ ...row }); setDraft(contractDraft(row)); setError('');
  };
  const cancelEdit = () => {
    const guard = capture();
    if (pending.current || disabled || !guard.current()) return;
    if (dirty && !window.confirm('¿Descartar los cambios del contrato financiero?')) return;
    guard.assertCurrent(); const empty = emptyContract(); newBaseline.current = JSON.stringify(empty);
    setEditing(null); setDraft(null); setNewContract(empty);
    // An uncertain operation still requires a reviewed server read before another write.
  };
  const saveContract = async (kind, heldRow = null) => {
    if (pending.current || blockedRef.current || !admitEdit()) return;
    const guard = capture(); if (!guard.current()) return;
    let intent;
    try {
      const row = kind === 'edit' ? editing : heldRow;
      if (kind !== 'create' && !contractRow(row)) throw new Error('Falta una revisión válida del contrato financiero.');
      const payload = kind === 'toggle' ? { activo: !row.activo } : contractPayload(kind === 'create' ? newContract : draft);
      intent = Object.freeze({ kind, id: row?.id, revision: row?.contract_revision, payload: Object.freeze({ ...payload }) });
      if (kind === 'create' && createConsumed.current === JSON.stringify(payload)) return;
    } catch (reason) { setError(reason.message); return; }
    pending.current = true; setLoading(true); setError(''); activityCallback.current?.(true);
    let confirmed = false;
    try {
      const row = await guard.request(intent.kind === 'create' ? '/api/contratos' : `/api/contratos/${intent.id}`, {
        method: intent.kind === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...intent.payload, ...(intent.kind === 'create' ? {} : { expected_revision: intent.revision }) }),
      });
      guard.assertCurrent(); assertContractAck(row, intent); confirmed = true;
      if (intent.kind === 'create') createConsumed.current = JSON.stringify(intent.payload);
      setRows(previous => {
        const current = previous || contracts;
        return intent.kind === 'create' ? [...current, row] : current.map(item => String(item.id) === String(row.id) ? row : item);
      });
      if (intent.kind === 'create') { const empty = emptyContract(); newBaseline.current = JSON.stringify(empty); setNewContract(empty); }
      await onSaved(row, guard); guard.assertCurrent();
    } catch (reason) {
      if (guard.current()) {
        if (!confirmed) { blockedRef.current = intent; setBlocked(intent); }
        setError(confirmed ? 'El contrato financiero se guardó, pero no se pudo actualizar la vista. No repitas el alta o guardado.'
          : `No se confirmó el guardado. Se conservan tus cambios. ${reason.message || ''}`);
      }
    } finally { if (guard.current()) { pending.current = false; setLoading(false); if (confirmed && intent.kind === 'edit') { setEditing(null); setDraft(null); } } }
  };
  const recoverContract = async () => {
    if (pending.current || !blockedRef.current || !admitEdit()) return;
    const guard = capture(); if (!guard.current()) return;
    const held = blockedRef.current;
    pending.current = true; setLoading(true); activityCallback.current?.(true);
    try {
      const result = await guard.request('/api/contratos'); guard.assertCurrent();
      if (!Array.isArray(result) || !result.every(contractRow)
        || new Set(result.map(row => row.id)).size !== result.length) throw new Error('No se pudo verificar la lista guardada.');
      const row = held.kind === 'create' ? null : result.find(item => String(item.id) === String(held.id));
      if (held.kind !== 'create' && !row) throw new Error('El contrato ya no está disponible. Se conserva el borrador.');
      setRows(result);
      if (held.kind === 'edit') { setEditing({ ...row }); setDraft(contractDraft(row)); }
      else { setEditing(null); setDraft(null); }
      if (held.kind === 'create') { const empty = emptyContract(); newBaseline.current = JSON.stringify(empty); setNewContract(empty); }
      blockedRef.current = null; setBlocked(null); setError('Versión guardada cargada. Revisá los contratos antes de otra operación.');
    } catch (reason) { if (guard.current()) setError(`No se descartaron tus cambios. ${reason.message}`); }
    finally { if (guard.current()) { pending.current = false; setLoading(false); } }
  };
  const fields = (value, update, create = false) => <>
    <label className={create ? undefined : 'finance-contract-field is-name'}><span>Contrato financiero</span><input aria-label="Contrato financiero" disabled={disabled || loading} type="text" value={value.nombre} onChange={e => { if (!pending.current && admitEdit()) update({ ...value, nombre: e.target.value }); }}/></label>
    <label className={create ? undefined : 'finance-contract-field is-amount'}><span>Monto mensual</span><input aria-label="Monto mensual" disabled={disabled || loading} type="number" min="0" step="0.01" value={value.importe_mensual} onChange={e => { if (!pending.current && admitEdit()) update({ ...value, importe_mensual: e.target.value }); }}/></label>
    <label className={create ? undefined : 'finance-contract-field'}><span>Inicia</span><input aria-label="Inicia" disabled={disabled || loading} type="date" value={value.inicia_el} onChange={e => { if (!pending.current && admitEdit()) update({ ...value, inicia_el: e.target.value }); }}/></label>
    <label className={create ? undefined : 'finance-contract-field'}><span>Finaliza <small>(opcional)</small></span><input aria-label="Finaliza" disabled={disabled || loading} type="date" value={value.finaliza_el} onChange={e => { if (!pending.current && admitEdit()) update({ ...value, finaliza_el: e.target.value }); }}/></label>
  </>;
  return <div className="finance-contracts">
    {error && <div className="salary-state is-error" role="status"><span>{error}</span></div>}
    {blocked && <button type="button" className="finance-contract-secondary" disabled={disabled || loading} onClick={recoverContract}>Descartar mis cambios y cargar versión guardada</button>}
    <section className="finance-contract-add" aria-labelledby="finance-add-client-title">
      <h3 id="finance-add-client-title">Agregar contrato financiero</h3>
      <div className="finance-contract-add-grid">{fields(newContract, value => { createConsumed.current = null; setNewContract(value); }, true)}
        <button type="button" className="finance-contract-primary" disabled={disabled || loading || Boolean(blocked) || Boolean(editing) || !newContract.nombre || newContract.importe_mensual === ''} onClick={() => saveContract('create')}>{loading ? 'Guardando…' : '+ Agregar'}</button>
        <button type="button" className="finance-contract-secondary" disabled={disabled || loading} onClick={cancelEdit}>Descartar cambios</button>
      </div>
    </section>
    <div className="finance-contract-list">
      <div className="finance-contract-list-heading" aria-hidden="true"><span>Contrato financiero</span><span>Monto mensual</span><span>Inicia</span><span>Finaliza</span><span>Estado</span><span>Acciones</span></div>
      {visible.map(row => editing && String(editing.id) === String(row.id) ? <article className="finance-contract-card is-editing" key={row.id}>
        {fields(draft, setDraft)}<div className="finance-contract-field is-status"><span>Estado</span><strong>{editing.activo ? 'Activo' : 'Inactivo'}</strong></div>
        <div className="finance-contract-actions"><button type="button" className="finance-contract-primary" disabled={disabled || loading || Boolean(blocked)} onClick={() => saveContract('edit')}>Guardar</button><button type="button" className="finance-contract-secondary" disabled={disabled || loading} onClick={cancelEdit}>Cancelar</button></div>
      </article> : <article className={`finance-contract-card${row.activo ? '' : ' is-inactive'}`} key={row.id}>
        <div className="finance-contract-field is-name"><span>Contrato financiero</span><strong>{row.nombre}</strong></div>
        <div className="finance-contract-field is-amount"><span>Monto mensual</span><strong>{ars.format(row.importe_mensual)}</strong></div>
        <div className="finance-contract-field"><span>Inicia</span><b>{row.inicia_el}</b></div><div className="finance-contract-field"><span>Finaliza</span><b>{row.finaliza_el || 'Sin fecha'}</b></div>
        <div className="finance-contract-field is-status"><span>Estado</span><button type="button" className={`finance-contract-status ${row.activo ? 'is-active' : 'is-disabled'}`} disabled={disabled || loading || dirty || Boolean(editing)} onClick={() => saveContract('toggle', { ...row })} aria-label={`${row.activo ? 'Dar de baja' : 'Reactivar'} contrato financiero ${row.nombre}`}>{row.activo ? 'Activo' : 'Baja'}</button></div>
        <div className="finance-contract-actions"><button type="button" className="finance-contract-secondary" disabled={disabled || loading || dirty || Boolean(editing)} onClick={() => openEdit(row)}>Editar</button></div>
      </article>)}
      {!visible.length && <div className="finance-empty">Todavía no hay contratos financieros cargados.</div>}
    </div>
  </div>;
}
