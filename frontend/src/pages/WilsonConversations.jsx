import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { getSesion } from '../utils.jsx';
import { useSessionView } from '../shared/session/use-session-view.js';
import { createCapturedRequest } from '../shared/session/captured-request.js';
import "./WilsonConversations.css";

export function WilsonConversationsPage() {
  const view = useSessionView(getSesion());
  const currentView = useRef(view); currentView.current = view;
  return <ConversationsSession key={view.key} session={view.session} view={view} currentView={currentView}/>;
}

function ConversationsSession({ session, view, currentView }) {
  const mounted = useRef(false), controllers = useRef(new Set()), pendingReset = useRef(false);
  const usersGeneration = useRef(0), messagesGeneration = useRef(0), selectedRef = useRef(null);
  const captureRequest = useCallback((isActive = () => true) => {
    const controller = new AbortController();
    return createCapturedRequest({ session, readSession: getSesion,
      isActive: () => mounted.current && currentView.current === view && !controller.signal.aborted && isActive(),
      request: async (url, options) => {
        controllers.current.add(controller);
        try { return await apiRequest(url, { ...options, signal: controller.signal }); }
        finally { controllers.current.delete(controller); }
      } });
  }, [session, view, currentView]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingReset.current = false; ++usersGeneration.current; ++messagesGeneration.current;
      for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  }, []);
  const [users, setUsers] = useState([]); const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [resetOpen, setResetOpen] = useState(false); const [resetting, setResetting] = useState(false); const [notice, setNotice] = useState("");
  const loadUsers = useCallback(async () => {
    const generation = ++usersGeneration.current;
    const guard = captureRequest(() => generation === usersGeneration.current && !pendingReset.current);
    if (!guard.current()) return;
    try {
      const rows = await guard.request('/api/wilson/conversaciones');
      guard.assertCurrent(); setUsers(rows);
      const next = rows.find(user => user.id === selectedRef.current?.id) || rows[0] || null;
      selectedRef.current = next; setSelected(next);
    } catch (reason) { if (guard.current()) setError(reason.message); }
    finally { if (guard.current()) setLoading(false); }
  }, [captureRequest]);
  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => {
    if (!selected) return undefined;
    let active = true; const generation = ++messagesGeneration.current;
    const guard = captureRequest(() => active && generation === messagesGeneration.current && selectedRef.current?.id === selected.id && !pendingReset.current);
    if (!guard.current()) return undefined;
    setLoading(true); setMessages([]);
    guard.request(`/api/wilson/conversaciones/${encodeURIComponent(selected.id)}`)
      .then(result => { if (guard.current()) setMessages(result.messages || []); })
      .catch(reason => { if (guard.current()) setError(reason.message); })
      .finally(() => { if (guard.current()) setLoading(false); });
    return () => { active = false; };
  }, [selected, captureRequest]);
  useEffect(() => {
    if (!resetOpen) return undefined;
    const closeWithEscape = (event) => { if (event.key === "Escape" && !resetting) setResetOpen(false); };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [resetOpen, resetting]);
  const resetConversations = async () => {
    const guard = captureRequest();
    if (!guard.current() || pendingReset.current) return;
    pendingReset.current = true; ++usersGeneration.current; ++messagesGeneration.current;
    setResetting(true); setError(""); setNotice("");
    try {
      const result = await guard.request("/api/wilson/conversaciones", { method: "DELETE" });
      guard.assertCurrent();
      setUsers([]); selectedRef.current = null; setSelected(null); setMessages([]); setResetOpen(false); setLoading(false);
      setNotice(`Conversaciones restablecidas. Se eliminaron ${result.conversations_deleted || 0} conversaciones.`);
    } catch (reason) {
      if (guard.current()) { setError(reason.message || "No se pudieron restablecer las conversaciones."); setLoading(false); }
    } finally { if (guard.current()) { pendingReset.current = false; setResetting(false); } }
  };
  return <main className="wilson-admin-page">
    <header><div><h1>Conversaciones de Wilson</h1><p>Seguimiento privado del mes actual. Solo visible para líderes.</p></div><button className="wilson-reset-button" type="button" onClick={() => setResetOpen(true)}>Restablecer conversaciones</button></header>
    {error && <div className="wilson-admin-error">{error}</div>}
    {notice && <div className="wilson-admin-notice" role="status">{notice}</div>}
    <div className="wilson-admin-layout">
      <aside aria-label="Personas">{users.length ? users.map((user) => <button type="button" className={selected?.id === user.id ? "active" : ""} key={user.id} disabled={resetting} onClick={() => { selectedRef.current = user; setSelected(user); }}><strong>{user.nombre}</strong><small>{user.ultimo_mensaje || "Sin conversación este mes"}</small></button>) : <p className="wilson-admin-people-empty">No hay conversaciones activas.</p>}</aside>
      <section aria-live="polite">
        <div className="wilson-admin-chat-header"><div className="wilson-admin-avatar">{selected?.nombre?.slice(0, 1) || "W"}</div><div><strong>{selected?.nombre || "Seleccioná una persona"}</strong><small>{selected?.periodo ? `Conversación de ${selected.periodo}` : "Mes actual"}</small></div></div>
        <div className="wilson-admin-messages">{loading ? <p>Cargando conversación…</p> : messages.length ? messages.map((message) => <article className={message.remitente} key={message.id}><small>{message.remitente === "wilson" ? "Wilson" : selected?.nombre}</small><p>{message.contenido}</p></article>) : <p className="empty">Todavía no hay mensajes este mes.</p>}</div>
      </section>
    </div>
    {resetOpen && <div className="wilson-reset-backdrop" role="presentation" onMouseDown={() => !resetting && setResetOpen(false)}><section className="wilson-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="wilson-reset-title" aria-describedby="wilson-reset-description" onMouseDown={(event) => event.stopPropagation()}><div className="wilson-reset-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68M4 4v4.68h4.68" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></div><h2 id="wilson-reset-title">¿Restablecer todas las conversaciones?</h2><p id="wilson-reset-description">Se eliminarán definitivamente todos los mensajes de Wilson para todo el equipo. Las tareas, reportes y usuarios no cambiarán.</p><div className="wilson-reset-actions"><button type="button" onClick={() => setResetOpen(false)} disabled={resetting} autoFocus>Cancelar</button><button className="danger" type="button" onClick={resetConversations} disabled={resetting}>{resetting ? "Restableciendo…" : "Sí, restablecer todo"}</button></div></section></div>}
  </main>;
}
