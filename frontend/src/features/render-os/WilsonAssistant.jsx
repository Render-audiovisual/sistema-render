import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./services/render-os-api.js";

const POSITION_KEY = "render_wilson_position";
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;
const EDGE = 16;

function BubbleIcon({ size = 22 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.48 8.8 8.8 0 0 1-3.42-.9L4 20l1.45-3.88A7.5 7.5 0 1 1 20 11.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8.3 11.7h.01m3.68 0H12m3.68 0h.01" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/></svg>;
}

function BellIcon({ size = 18 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function messageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function clampPosition(position) {
  return {
    x: Math.max(EDGE, Math.min(position.x, window.innerWidth - PANEL_WIDTH - EDGE)),
    y: Math.max(EDGE, Math.min(position.y, window.innerHeight - PANEL_HEIGHT - EDGE)),
  };
}

function initialPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return clampPosition(saved);
  } catch { /* Se usa la posición inicial. */ }
  return clampPosition({ x: window.innerWidth - PANEL_WIDTH - 24, y: window.innerHeight - PANEL_HEIGHT - 24 });
}

function shouldOpenFromUrl() {
  return new URLSearchParams(window.location.search).get("wilson") === "open";
}

function TaskSuggestion({ task, onOpen, onChoose, chooseLabel }) {
  return <button className="wilson-task" type="button" onClick={() => onChoose ? onChoose(task) : onOpen(task.id)}>
    <span className={`wilson-priority ${task.dynamic_priority.toLowerCase()}`}>{task.dynamic_priority}</span>
    <span><strong>{task.titulo}</strong><small>{task.cliente_nombre || "Sin cliente"} · {task.priority_reasons?.join(" · ") || "Sin motivos disponibles"}</small></span>
    {chooseLabel ? <em>{chooseLabel}</em> : <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
  </button>;
}

export function WilsonAssistant({ onOpenTask }) {
  const [open, setOpen] = useState(shouldOpenFromUrl);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(initialPosition);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const messagesRef = useRef(null);
  const dragRef = useRef(null);
  const positionRef = useRef(position);
  const attemptedRef = useRef(false);
  const launcherRef = useRef(null);

  const markAsRead = useCallback(async () => {
    setUnread(0);
    try { await apiRequest("/api/wilson/conversacion/leida", { method: "POST" }); }
    catch { /* La lectura se vuelve a intentar al abrir el chat. */ }
  }, []);

  const loadUnread = useCallback(async () => {
    try {
      const result = await apiRequest("/api/wilson/notificaciones");
      setUnread(Math.max(0, Number(result.no_leidos) || 0));
    } catch { /* El chat sigue disponible aunque falle el indicador. */ }
  }, []);

  const loadRecommendations = useCallback(async () => {
    attemptedRef.current = true;
    setLoading(true); setError("");
    try {
      const result = await apiRequest("/api/wilson/conversacion");
      setData(result.priorities);
      const tasksById = new Map((result.priorities?.recommendations || []).map((task) => [Number(task.id), task]));
      const persisted = (result.messages || []).map((message) => ({
        id: message.id,
        role: message.remitente === "wilson" ? "assistant" : "user",
        text: message.contenido,
        intent: message.metadata?.intent || null,
        confirmation: message.metadata?.token ? { token: message.metadata.token, task_id: message.metadata.task_id } : null,
        tasks: (message.metadata?.task_ids || []).map((id) => tasksById.get(Number(id))).filter(Boolean),
        createdAt: message.created_at,
      }));
      setMessages(persisted.length ? persisted : [{ role: "assistant", text: "Hola. Estoy mirando solamente tus tareas. Preguntame qué conviene hacer primero.", tasks: [] }]);
      await markAsRead();
    } catch (reason) {
      setError(reason.message || "No pude analizar tus tareas.");
    } finally { setLoading(false); }
  }, [markAsRead]);

  useEffect(() => { if (open && !data && !loading && !attemptedRef.current) void loadRecommendations(); }, [open, data, loading, loadRecommendations]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => {
    void loadUnread();
    const timer = window.setInterval(() => { if (!open && document.visibilityState === "visible") void loadUnread(); }, 30000);
    const refresh = () => { if (!open) void loadUnread(); };
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [loadUnread, open]);
  useEffect(() => {
    const container = messagesRef.current;
    if (open && container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, open]);
  useEffect(() => {
    const resize = () => setPosition((current) => clampPosition(current));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const submit = async (question) => {
    const clean = String(question || input).trim();
    if (!clean || !data) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", text: clean, createdAt: new Date().toISOString() }]);
    setLoading(true); setError("");
    try {
      const result = await apiRequest("/api/wilson/mensajes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido: clean }) });
      setData(result.priorities);
      setMessages((current) => [...current, {
        id: result.assistantMessage.id,
        role: "assistant",
        text: result.assistantMessage.contenido,
        tasks: result.tasks || [],
        intent: result.assistantMessage.metadata?.intent || null,
        confirmation: result.assistantMessage.metadata?.token
          ? { token: result.assistantMessage.metadata.token, task_id: result.assistantMessage.metadata.task_id }
          : null,
        createdAt: result.assistantMessage.created_at,
      }]);
      await markAsRead();
    } catch (reason) { setError(reason.message || "No pude responderte."); }
    finally { setLoading(false); }
  };
  const prepareProduction = async (task, intent) => {
    setLoading(true); setError("");
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const result = await apiRequest("/api/wilson/produccion/preparar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tarea_id: task.id, cantidad: intent.amount, fecha: today }) });
      setMessages((current) => [...current, { id: result.message.id, role: "assistant", text: result.message.contenido, confirmation: result.confirmation, createdAt: result.message.created_at }]);
      await markAsRead();
    } catch (reason) { setError(reason.message || "No pude preparar el registro."); }
    finally { setLoading(false); }
  };
  const confirmAction = async (confirmation) => {
    setLoading(true); setError("");
    try {
      const result = await apiRequest(`/api/wilson/confirmaciones/${confirmation.token}`, { method: "POST" });
      setMessages((current) => [
        ...current.map((message) => message.confirmation?.token === confirmation.token ? { ...message, confirmation: null } : message),
        { id: result.message.id, role: "assistant", text: result.message.contenido, createdAt: result.message.created_at },
      ]);
      await markAsRead();
    } catch (reason) { setError(reason.message || "No pude confirmar la acción."); }
    finally { setLoading(false); }
  };
  const beginDrag = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
  };
  const drag = (event) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setPosition(clampPosition({ x: state.origin.x + event.clientX - state.x, y: state.origin.y + event.clientY - state.y }));
  };
  const endDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current = null;
    localStorage.setItem(POSITION_KEY, JSON.stringify(positionRef.current));
  };
  const moveWithKeyboard = (event) => {
    const movement = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    if (!movement && event.key !== "Home") return;
    event.preventDefault();
    const next = event.key === "Home"
      ? initialPosition()
      : clampPosition({ x: positionRef.current.x + movement[0], y: positionRef.current.y + movement[1] });
    positionRef.current = next;
    setPosition(next);
    localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  };
  const hide = () => {
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  };
  const summary = useMemo(() => data?.summary || {}, [data]);

  if (!open) return <button ref={launcherRef} className="wilson-launcher" type="button" aria-label={unread ? `Abrir chat de Wilson, ${unread} mensaje${unread === 1 ? "" : "s"} sin leer` : "Abrir chat de Wilson"} onClick={() => { setOpen(true); setMinimized(false); setUnread(0); }}><span className="wilson-launcher-icon"><BubbleIcon/>{unread > 0 && <span className="wilson-unread-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}</span><span>Wilson</span>{unread > 0 && <BellIcon size={16}/>}</button>;

  return <aside className={`wilson-assistant ${minimized ? "is-minimized" : ""}`} style={{ left: position.x, top: position.y }} aria-label="Wilson, asistente operativo">
    <header className="wilson-header" tabIndex="0" aria-label="Mover Wilson con las flechas; Inicio restablece su posición" onKeyDown={moveWithKeyboard} onPointerDown={beginDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <span className="wilson-mark"><BubbleIcon size={18}/></span><div><strong>Wilson</strong><small>Asistente operativo · disponible</small></div>
      <span className={`wilson-header-notification ${unread > 0 ? "" : "is-empty"}`} aria-label={unread > 0 ? `${unread} mensajes sin leer` : undefined} aria-hidden={unread === 0}><BellIcon size={15}/>{unread > 99 ? "99+" : unread}</span>
      <button type="button" aria-label={minimized ? "Expandir Wilson" : "Minimizar Wilson"} onClick={() => setMinimized((current) => !current)}>{minimized ? "+" : "−"}</button>
      <button type="button" aria-label="Ocultar Wilson" onClick={hide}>×</button>
    </header>
    {!minimized && <>
      <div className="wilson-status"><span>{summary.critical || 0} críticas</span><span>{summary.overdue || 0} vencidas</span><button type="button" onClick={loadRecommendations} disabled={loading} aria-label="Actualizar recomendaciones">Actualizar</button></div>
      <div className="wilson-messages" ref={messagesRef} aria-live="polite">
        {loading && !data && <div className="wilson-thinking"><i/><i/><i/><span>Analizando tus tareas…</span></div>}
        {error && <div className="wilson-error"><strong>No pude cargar las recomendaciones.</strong><span>{error}</span><button type="button" onClick={loadRecommendations}>Reintentar</button></div>}
        {messages.map((message, index) => <div className={`wilson-message ${message.role}`} key={message.id || `${message.role}-${index}`}>
          <p>{message.text}</p><time dateTime={message.createdAt || undefined}>{messageTime(message.createdAt)}</time>
          {message.tasks?.length > 0 && <div className="wilson-task-list">{message.tasks.map((task) => <TaskSuggestion key={task.id} task={task} onOpen={(taskId) => { setMinimized(true); onOpenTask(taskId); }} onChoose={message.intent?.type === "production" ? (chosen) => prepareProduction(chosen, message.intent) : null} chooseLabel={message.intent?.type === "production" ? "Registrar" : ""}/>)}</div>}
          {message.confirmation && <div className="wilson-confirm-actions"><button type="button" onClick={() => confirmAction(message.confirmation)} disabled={loading}>Sí, confirmar</button><button type="button" onClick={() => setMessages((current) => current.filter((item) => item !== message))}>Cancelar</button></div>}
        </div>)}
      </div>
      <div className="wilson-prompts"><button type="button" onClick={() => submit("¿Qué hago ahora?")}>Qué hago ahora</button><button type="button" onClick={() => submit("¿Qué tengo atrasado?")}>Atrasadas</button><button type="button" onClick={() => submit("¿Qué puede esperar?")}>Puede esperar</button></div>
      <form className="wilson-input" onSubmit={(event) => { event.preventDefault(); submit(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Preguntale a Wilson…" aria-label="Mensaje para Wilson"/><button type="submit" disabled={!input.trim() || !data} aria-label="Enviar pregunta"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m5 12 14-7-4 14-3-6-7-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg></button></form>
    </>}
  </aside>;
}
