import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../features/render-os/services/render-os-api.js';
import { CATEGORIAS_NOTA } from './BlocNotas.jsx';
import './Feedback.css';

const emptyDraft = () => ({ titulo: '', contenido: '', categoria: 'general', feedback: { cliente: '', responsable: '', referencia: '' } });
const normalized = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function Reference({ text }) {
  let href;
  try { const url = new URL(text); if (['https:', 'http:'].includes(url.protocol)) href = url.href; } catch { /* Plain references are valid. */ }
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> : <span>{text}</span>;
}

// Same shared notes, no task states, deadlines, notifications or automatic task creation.
export function FeedbackPage({ request = apiRequest, taskBase = '/workspace/tareas', feedbackHref = '/feedback', externalTasks = false }) {
  const [notes, setNotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [client, setClient] = useState('');
  const [trash, setTrash] = useState(new URLSearchParams(window.location.search).get('mode') === 'trash');
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  const titleRef = useRef(null);
  const lock = useRef(false);
  const dirty = draft && JSON.stringify(draft) !== baseline;
  useEffect(() => {
    const warn = (event) => { if (dirty || lock.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    request(`/api/notas?${trash ? 'papelera=true' : ''}`).then((rows) => {
      if (!active) return;
      setNotes(rows);
      const id = Number(new URLSearchParams(window.location.search).get('note'));
      const note = rows.find((row) => row.id === id);
      if (note && !trash) open(note);
    }).catch((reason) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, trash, reload]);
  useEffect(() => {
    let active = true;
    Promise.all([request('/api/clientes'), request('/api/usuarios')]).then(([c, u]) => {
      if (active) { setClients(c); setUsers(u); }
    }).catch(() => { if (active) setMessage('No pudimos cargar las sugerencias. Podés escribir cliente y responsable manualmente.'); });
    return () => { active = false; };
  }, [request]);
  useEffect(() => { if (draft) titleRef.current?.focus(); }, [draft?.id, Boolean(draft)]);
  function canLeave() { return !lock.current && (!dirty || window.confirm('Tenés cambios sin guardar. ¿Querés descartarlos?')); }
  function open(note) {
    if (!canLeave()) return;
    const next = note ? { ...note, feedback: { ...emptyDraft().feedback, ...note.feedback } } : emptyDraft();
    setDraft(next); setBaseline(JSON.stringify(next)); setError(''); setMessage(''); setConflict(false);
  }
  function close() { if (canLeave()) { setDraft(null); setConflict(false); } }
  async function save(event) {
    event.preventDefault();
    if (lock.current || conflict || !draft.titulo.trim() || !draft.contenido.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const body = { titulo: draft.titulo.trim(), contenido: draft.contenido, categoria: draft.categoria, feedback: draft.feedback, ...(draft.id ? { expected_updated_at: draft.updated_at } : {}) };
      const saved = await request(draft.id ? `/api/notas/${draft.id}` : '/api/notas', { method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setNotes((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setDraft(null); setQuery(''); setClient(''); setMessage('Nota guardada. Ya está disponible para el equipo.');
    } catch (reason) { setError(reason.message || 'No se pudo guardar. Tu texto sigue acá.'); setConflict(reason.status === 409); }
    finally { lock.current = false; setBusy(false); }
  }
  async function trashAction(note) {
    if (lock.current || !canLeave()) return;
    if (!trash && !window.confirm(`¿Mover “${note.titulo}” a la Papelera? Podés restaurarla después.`)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await request(`/api/notas/${note.id}${trash ? '/restaurar' : ''}`, { method: trash ? 'POST' : 'DELETE' });
      setNotes((rows) => rows.filter((row) => row.id !== note.id)); setDraft(null); setMessage(trash ? 'Nota restaurada.' : 'Nota movida a la Papelera.');
    } catch (reason) { setError(reason.message); }
    finally { lock.current = false; setBusy(false); }
  }
  const clientOptions = useMemo(() => [...new Set([...clients.map((c) => c.nombre), ...notes.map((n) => n.feedback?.cliente)].filter(Boolean))].sort((a,b) => a.localeCompare(b)), [clients, notes]);
  const visible = notes.filter((note) => (!client || (client === '__none' ? !note.feedback?.cliente : note.feedback?.cliente === client)) && normalized([note.titulo, note.contenido, ...Object.values(note.feedback || {})].join(' ')).includes(normalized(query)));
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const changeMeta = (key, value) => setDraft((d) => ({ ...d, feedback: { ...d.feedback, [key]: value } }));
  return <main className="render-feedback">
    <header className="rf-header"><div><h1>Tareas</h1><p>El trabajo del equipo, en orden.</p></div><button className="rf-primary" disabled={busy || trash} onClick={() => open(null)}>Nueva nota</button></header>
    <nav className="rf-tabs" aria-label="Vista de tareas">{[['Tablero', ''], ['Lista', '?view=list'], ['Calendario', '?view=calendar'], ['Por cliente', '?view=clients']].map(([label, search]) => <a key={label} href={`${taskBase}${search}`} target={externalTasks ? '_blank' : undefined} rel={externalTasks ? 'noopener noreferrer' : undefined}>{label}</a>)}<a href={feedbackHref} aria-current="page">Feedback</a></nav>
    <section className="rf-intro"><div><h2>{trash ? 'Papelera de feedback' : 'Feedback de clientes'}</h2><p>Comentarios, correcciones e ideas. Sin estados ni vencimientos.</p></div><button disabled={busy} onClick={() => { if (canLeave()) { setDraft(null); setTrash(!trash); setClient(''); setQuery(''); } }}>{trash ? 'Volver a las notas' : 'Papelera'}</button></section>
    <div className="rf-filters"><label>Buscar<input type="search" placeholder="Nota, cliente o responsable" value={query} onChange={(e) => setQuery(e.target.value)}/></label><label>Filtrar por cliente<select value={client} onChange={(e) => setClient(e.target.value)}><option value="">Todos</option><option value="__none">Sin cliente</option>{clientOptions.map((name) => <option key={name}>{name}</option>)}</select></label><span>{visible.length} notas</span></div>
    {error && <div className="rf-error" role="alert">{error}{!draft && <button onClick={() => setReload((n) => n + 1)}>Reintentar</button>}</div>}
    {message && <p className="rf-message" role="status">{message}</p>}
    {draft && <form className="rf-editor" onSubmit={save}><h2>{draft.id ? 'Editar nota' : 'Nueva nota'}</h2><fieldset disabled={busy}><div className="rf-fields"><label>Cliente · opcional<input list="rf-clients" maxLength={200} value={draft.feedback.cliente} onChange={(e) => changeMeta('cliente', e.target.value)}/><datalist id="rf-clients">{clientOptions.map((name) => <option key={name} value={name}/>)}</datalist></label><label>Responsable · opcional<input list="rf-users" maxLength={200} value={draft.feedback.responsable} onChange={(e) => changeMeta('responsable', e.target.value)}/><datalist id="rf-users">{users.map((u) => <option key={u.id || u.usuario} value={u.nombre || u.usuario}/>)}</datalist></label><label className="rf-wide">Título<input ref={titleRef} required value={draft.titulo} onChange={(e) => change('titulo', e.target.value)}/></label><label className="rf-wide">Comentario o pedido<textarea required rows={5} value={draft.contenido} onChange={(e) => change('contenido', e.target.value)}/></label><label className="rf-wide">Referencia · opcional<input maxLength={2000} value={draft.feedback.referencia} onChange={(e) => changeMeta('referencia', e.target.value)}/></label><label>Categoría<select value={draft.categoria} onChange={(e) => change('categoria', e.target.value)}>{CATEGORIAS_NOTA.filter((c) => c.id !== 'todas').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label></div><div className="rf-form-actions"><button type="button" onClick={close}>Cancelar</button><button className="rf-primary" disabled={conflict} type="submit">{busy ? 'Guardando…' : 'Guardar nota'}</button></div></fieldset>{conflict && <p role="alert">Copiá tus cambios antes de cancelar y volver a cargar las notas. Otra persona guardó una versión más reciente; no la sobrescribimos.</p>}</form>}
    {loading ? <p role="status">Cargando notas…</p> : <div className="rf-grid">{visible.map((note) => <article className="rf-card" key={note.id}><div className="rf-card-main"><span className="rf-client">{note.feedback?.cliente || 'Sin cliente'}</span><h3>{note.titulo}</h3><p>{note.contenido || 'Sin contenido'}</p>{note.feedback?.referencia && <details><summary>Ver referencia</summary><Reference text={note.feedback.referencia}/></details>}</div><footer><span>{note.feedback?.responsable || 'Sin asignar'}</span><div>{!trash && <button disabled={busy} onClick={() => open(note)} aria-label={`Editar ${note.titulo}`}>Editar nota</button>}<button disabled={busy} onClick={() => trashAction(note)} aria-label={`${trash ? 'Restaurar' : 'Mover a Papelera'} ${note.titulo}`}>{trash ? 'Restaurar' : 'A Papelera'}</button></div></footer><small>Última edición: {note.modificado_por} · {new Date(note.updated_at).toLocaleDateString('es-AR')}</small></article>)}{!visible.length && !error && <p className="rf-empty">{query || client ? 'No hay notas con estos filtros.' : trash ? 'La Papelera está vacía.' : 'Todavía no hay notas. Creá una para registrar el feedback de un cliente.'}</p>}</div>}
    {notes.length >= 500 && <p>Se muestran las 500 notas más recientes. Las demás no se eliminaron.</p>}
  </main>;
}
