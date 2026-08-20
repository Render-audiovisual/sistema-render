import React, { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import "./WilsonConversations.css";

export function WilsonConversationsPage() {
  const [users, setUsers] = useState([]); const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [resetOpen, setResetOpen] = useState(false); const [resetting, setResetting] = useState(false); const [notice, setNotice] = useState("");
  const loadUsers = useCallback(() => apiRequest("/api/wilson/conversaciones").then((rows) => {
    setUsers(rows);
    setSelected((current) => rows.find((user) => user.id === current?.id) || rows[0] || null);
  }), []);
  useEffect(() => { loadUsers().catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, [loadUsers]);
  useEffect(() => { if (!selected) return; setLoading(true); apiRequest(`/api/wilson/conversaciones/${selected.id}`).then((result) => setMessages(result.messages || [])).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, [selected]);
  useEffect(() => {
    if (!resetOpen) return undefined;
    const closeWithEscape = (event) => { if (event.key === "Escape" && !resetting) setResetOpen(false); };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [resetOpen, resetting]);
  const resetConversations = async () => {
    setResetting(true); setError(""); setNotice("");
    try {
      const result = await apiRequest("/api/wilson/conversaciones", { method: "DELETE" });
      setUsers([]); setSelected(null); setMessages([]); setResetOpen(false);
      setNotice(`Conversaciones restablecidas. Se eliminaron ${result.conversations_deleted || 0} conversaciones.`);
    } catch (reason) {
      setError(reason.message || "No se pudieron restablecer las conversaciones.");
    } finally { setResetting(false); }
  };
  return <main className="wilson-admin-page">
    <header><div><h1>Conversaciones de Wilson</h1><p>Seguimiento privado del mes actual. Solo visible para líderes.</p></div><button className="wilson-reset-button" type="button" onClick={() => setResetOpen(true)}>Restablecer conversaciones</button></header>
    {error && <div className="wilson-admin-error">{error}</div>}
    {notice && <div className="wilson-admin-notice" role="status">{notice}</div>}
    <div className="wilson-admin-layout">
      <aside aria-label="Personas">{users.length ? users.map((user) => <button type="button" className={selected?.id === user.id ? "active" : ""} key={user.id} onClick={() => setSelected(user)}><strong>{user.nombre}</strong><small>{user.ultimo_mensaje || "Sin conversación este mes"}</small></button>) : <p className="wilson-admin-people-empty">No hay conversaciones activas.</p>}</aside>
      <section aria-live="polite">
        <div className="wilson-admin-chat-header"><div className="wilson-admin-avatar">{selected?.nombre?.slice(0, 1) || "W"}</div><div><strong>{selected?.nombre || "Seleccioná una persona"}</strong><small>{selected?.periodo ? `Conversación de ${selected.periodo}` : "Mes actual"}</small></div></div>
        <div className="wilson-admin-messages">{loading ? <p>Cargando conversación…</p> : messages.length ? messages.map((message) => <article className={message.remitente} key={message.id}><small>{message.remitente === "wilson" ? "Wilson" : selected?.nombre}</small><p>{message.contenido}</p></article>) : <p className="empty">Todavía no hay mensajes este mes.</p>}</div>
      </section>
    </div>
    {resetOpen && <div className="wilson-reset-backdrop" role="presentation" onMouseDown={() => !resetting && setResetOpen(false)}><section className="wilson-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="wilson-reset-title" aria-describedby="wilson-reset-description" onMouseDown={(event) => event.stopPropagation()}><div className="wilson-reset-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68M4 4v4.68h4.68" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></div><h2 id="wilson-reset-title">¿Restablecer todas las conversaciones?</h2><p id="wilson-reset-description">Se eliminarán definitivamente todos los mensajes de Wilson para todo el equipo. Las tareas, reportes y usuarios no cambiarán.</p><div className="wilson-reset-actions"><button type="button" onClick={() => setResetOpen(false)} disabled={resetting} autoFocus>Cancelar</button><button className="danger" type="button" onClick={resetConversations} disabled={resetting}>{resetting ? "Restableciendo…" : "Sí, restablecer todo"}</button></div></section></div>}
  </main>;
}
