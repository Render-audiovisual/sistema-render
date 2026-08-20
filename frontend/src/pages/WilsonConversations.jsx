import React, { useEffect, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import "./WilsonConversations.css";

export function WilsonConversationsPage() {
  const [users, setUsers] = useState([]); const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { apiRequest("/api/wilson/conversaciones").then((rows) => { setUsers(rows); setSelected(rows[0] || null); }).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!selected) return; setLoading(true); apiRequest(`/api/wilson/conversaciones/${selected.id}`).then((result) => setMessages(result.messages || [])).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, [selected]);
  return <main className="wilson-admin-page">
    <header><h1>Conversaciones de Wilson</h1><p>Seguimiento privado del mes actual. Solo visible para líderes.</p></header>
    {error && <div className="wilson-admin-error">{error}</div>}
    <div className="wilson-admin-layout">
      <aside aria-label="Personas">{users.map((user) => <button type="button" className={selected?.id === user.id ? "active" : ""} key={user.id} onClick={() => setSelected(user)}><strong>{user.nombre}</strong><small>{user.ultimo_mensaje || "Sin conversación este mes"}</small></button>)}</aside>
      <section aria-live="polite">
        <div className="wilson-admin-chat-header"><div className="wilson-admin-avatar">{selected?.nombre?.slice(0, 1) || "W"}</div><div><strong>{selected?.nombre || "Seleccioná una persona"}</strong><small>{selected?.periodo ? `Conversación de ${selected.periodo}` : "Mes actual"}</small></div></div>
        <div className="wilson-admin-messages">{loading ? <p>Cargando conversación…</p> : messages.length ? messages.map((message) => <article className={message.remitente} key={message.id}><small>{message.remitente === "wilson" ? "Wilson" : selected?.nombre}</small><p>{message.contenido}</p></article>) : <p className="empty">Todavía no hay mensajes este mes.</p>}</div>
      </section>
    </div>
  </main>;
}
