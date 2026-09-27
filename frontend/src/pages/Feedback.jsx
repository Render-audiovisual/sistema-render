import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import { CATEGORIAS_NOTA } from "./BlocNotas.jsx";
import { markFeedbackSeen } from "../features/render-os/utils/feedback-notifications.js";
import "./Feedback.css";

const EDITABLE_CATEGORIES = CATEGORIAS_NOTA.filter((category) => category.id !== "todas");
const CATEGORY_LABELS = Object.fromEntries(EDITABLE_CATEGORIES.map((category) => [category.id, category.label]));
const normalize = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const isClientNote = (note) => Boolean(String(note?.feedback?.cliente || "").trim());
const emptyDraft = (section) => ({
  titulo: "",
  contenido: "",
  categoria: section === "team" ? "reunion" : "general",
  feedback: { cliente: "", responsable: "", referencia: "" },
});

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

function Reference({ text }) {
  let href;
  try { const url = new URL(text); if (["https:", "http:"].includes(url.protocol)) href = url.href; } catch { /* Plain references are valid. */ }
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{text}<span aria-hidden="true">↗</span></a> : <p>{text}</p>;
}

export function FeedbackPage({ request = apiRequest, sesion = null }) {
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [notes, setNotes] = useState([]);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [section, setSection] = useState(initialParams.get("section") === "team" ? "team" : "clients");
  const [query, setQuery] = useState("");
  const [trash, setTrash] = useState(initialParams.get("mode") === "trash");
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  const titleRef = useRef(null);
  const lock = useRef(false);
  const linkedNoteId = useRef(Number(initialParams.get("note")) || null);
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const panelOpen = Boolean(selected || draft);

  useEffect(() => {
    const warn = (event) => { if (dirty || lock.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!panelOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [panelOpen]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    request(`/api/notas?${trash ? "papelera=true" : ""}`).then((rows) => {
      if (!active) return;
      setNotes(rows);
      if (!trash) markFeedbackSeen(sesion?.usuario);
      const noteId = linkedNoteId.current;
      const linkedNote = rows.find((note) => note.id === noteId);
      if (linkedNote) {
        setSection(isClientNote(linkedNote) ? "clients" : "team");
        setSelected(linkedNote);
      }
      linkedNoteId.current = null;
    }).catch((reason) => { if (active) setError(reason.message || "No pudimos cargar los feedbacks."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, trash, reload, sesion?.usuario]);

  useEffect(() => {
    let active = true;
    Promise.all([request("/api/clientes"), request("/api/usuarios")]).then(([clientRows, userRows]) => {
      if (active) { setClients(clientRows); setUsers(userRows); }
    }).catch(() => { if (active) setMessage("No pudimos cargar las sugerencias, pero podés escribir los datos manualmente."); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => { if (draft) titleRef.current?.focus(); }, [draft?.id, Boolean(draft)]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    trash ? url.searchParams.set("mode", "trash") : url.searchParams.delete("mode");
    selected?.id ? url.searchParams.set("note", String(selected.id)) : url.searchParams.delete("note");
    window.history.replaceState(window.history.state, "", url);
  }, [section, trash, selected?.id]);

  function canLeave() {
    return !lock.current && (!dirty || window.confirm("Tenés cambios sin guardar. ¿Querés descartarlos?"));
  }

  function openNote(note) {
    if (!canLeave()) return;
    setSelected(note);
    setDraft(null);
    setBaseline("");
    setError("");
    setMessage("");
    setConflict(false);
  }

  function createNote() {
    if (!canLeave()) return;
    const next = emptyDraft(section);
    setSelected(null);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setConflict(false);
  }

  function editNote(note) {
    const next = { ...note, feedback: { ...emptyDraft(section).feedback, ...note.feedback } };
    setSelected(note);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setError("");
    setConflict(false);
  }

  function closePanel() {
    if (!canLeave()) return;
    setSelected(null);
    setDraft(null);
    setBaseline("");
    setConflict(false);
  }

  async function save(event) {
    event.preventDefault();
    const clientName = String(draft?.feedback?.cliente || "").trim();
    if (lock.current || conflict || !draft?.titulo.trim() || !draft?.contenido.trim() || (section === "clients" && !clientName)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const body = {
        titulo: draft.titulo.trim(),
        contenido: draft.contenido,
        categoria: draft.categoria,
        feedback: { ...draft.feedback, cliente: section === "team" ? "" : clientName },
        ...(draft.id ? { expected_updated_at: draft.updated_at } : {}),
      };
      const saved = await request(draft.id ? `/api/notas/${draft.id}` : "/api/notas", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setNotes((rows) => [saved, ...rows.filter((note) => note.id !== saved.id)]);
      markFeedbackSeen(sesion?.usuario);
      setSelected(saved);
      setDraft(null);
      setBaseline("");
      setMessage("Feedback guardado y disponible para el equipo.");
    } catch (reason) {
      setError(reason.message || "No se pudo guardar. Tu texto sigue acá.");
      setConflict(reason.status === 409);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function trashAction(note) {
    if (lock.current || !canLeave()) return;
    if (!trash && !window.confirm(`¿Mover “${note.titulo}” a la Papelera? Podés restaurarlo después.`)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await request(`/api/notas/${note.id}${trash ? "/restaurar" : ""}`, { method: trash ? "POST" : "DELETE" });
      setNotes((rows) => rows.filter((item) => item.id !== note.id));
      setSelected(null);
      setDraft(null);
      setMessage(trash ? "Feedback restaurado." : "Feedback movido a la Papelera.");
    } catch (reason) {
      setError(reason.message || "No se pudo completar la acción.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const clientOptions = useMemo(() => [...new Set([
    ...clients.map((item) => item.nombre),
    ...notes.map((note) => note.feedback?.cliente),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "es")), [clients, notes]);

  const visible = useMemo(() => notes.filter((note) => {
    const belongsToSection = section === "clients" ? isClientNote(note) : !isClientNote(note);
    const searchable = [note.titulo, note.contenido, note.categoria, ...Object.values(note.feedback || {})].join(" ");
    return belongsToSection && normalize(searchable).includes(normalize(query));
  }), [notes, section, query]);

  const change = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const changeMeta = (key, value) => setDraft((current) => ({ ...current, feedback: { ...current.feedback, [key]: value } }));
  const sectionTitle = section === "clients" ? "Feedback de clientes" : "Feedback del equipo";
  const sectionCopy = section === "clients" ? "Pedidos, correcciones y comentarios de cada cliente." : "Conclusiones y acuerdos de nuestras reuniones internas.";

  return <main className="render-feedback">
    <header className="rf-header">
      <div><span className="rf-eyebrow">NOTAS Y SEGUIMIENTO</span><h1>Feedback</h1><p>Todo lo importante, ordenado y fácil de consultar.</p></div>
      <button className="rf-primary" disabled={busy || trash} onClick={createNote}>+ Nuevo feedback</button>
    </header>

    <nav className="rf-section-switch" aria-label="Tipo de feedback">
      <button type="button" aria-pressed={section === "team"} className={section === "team" ? "active" : ""} onClick={() => { if (canLeave()) { setSection("team"); setSelected(null); setDraft(null); } }}><span>♙</span><b>Equipo</b></button>
      <button type="button" aria-pressed={section === "clients"} className={section === "clients" ? "active" : ""} onClick={() => { if (canLeave()) { setSection("clients"); setSelected(null); setDraft(null); } }}><span>◎</span><b>Clientes</b></button>
    </nav>

    <section className="rf-intro"><div><h2>{trash ? `Papelera · ${sectionTitle}` : sectionTitle}</h2><p>{sectionCopy}</p></div><button className="rf-trash-toggle" disabled={busy} onClick={() => { if (canLeave()) { setSelected(null); setDraft(null); setTrash(!trash); setQuery(""); } }}>{trash ? "← Volver" : "Papelera"}</button></section>

    <div className="rf-toolbar">
      <label className="rf-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar feedback" type="search" placeholder="Buscar por título, contenido o responsable…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <small>{visible.length} {visible.length === 1 ? "nota" : "notas"}</small>
    </div>

    {error && <div className="rf-error" role="alert">{error}{!panelOpen && <button onClick={() => setReload((current) => current + 1)}>Reintentar</button>}</div>}
    {message && <p className="rf-message" role="status">{message}</p>}

    {loading ? <div className="rf-loading" role="status"><span/><span/><span/></div> : <div className="rf-grid">
      {visible.map((note) => <button type="button" className="rf-note-card" key={note.id} onClick={() => openNote(note)}>
        <span className="rf-note-icon" aria-hidden="true">▤</span>
        <span className="rf-note-copy"><small>{section === "clients" ? note.feedback?.cliente : CATEGORY_LABELS[note.categoria] || "General"}</small><strong>{note.titulo || "Sin título"}</strong><em>{note.feedback?.responsable || note.modificado_por || "Equipo RENDER"} · {formatDate(note.updated_at)}</em></span>
        <span className="rf-note-arrow" aria-hidden="true">›</span>
      </button>)}
      {!visible.length && !error && <div className="rf-empty"><span>▤</span><strong>{query ? "No encontramos resultados" : trash ? "La Papelera está vacía" : `Todavía no hay feedback de ${section === "clients" ? "clientes" : "equipo"}`}</strong><p>{query ? "Probá con otra búsqueda." : "Creá una nota para guardar la información importante."}</p></div>}
    </div>}

    {panelOpen && <div className="rf-panel-backdrop" role="presentation" onMouseDown={closePanel}>
      <section className={`rf-panel ${draft ? "is-editing" : ""}`} role="dialog" aria-modal="true" aria-label={draft ? (draft.id ? "Editar feedback" : "Nuevo feedback") : selected?.titulo} onMouseDown={(event) => event.stopPropagation()}>
        <header className="rf-panel-header"><div><span>{section === "clients" ? "CLIENTE" : "EQUIPO"}</span><strong>{draft ? (draft.id ? "Editar feedback" : "Nuevo feedback") : selected?.titulo}</strong></div><button type="button" aria-label="Cerrar" onClick={closePanel}>×</button></header>

        {draft ? <form className="rf-editor" onSubmit={save}>
          <fieldset disabled={busy}>
            <div className="rf-fields">
              {section === "clients" && <label className="rf-wide">Cliente<input ref={!draft.id ? titleRef : undefined} required list="rf-clients" maxLength={200} value={draft.feedback.cliente} onChange={(event) => changeMeta("cliente", event.target.value)}/><datalist id="rf-clients">{clientOptions.map((name) => <option key={name} value={name}/>)}</datalist></label>}
              <label className="rf-wide">Título<input ref={section === "team" || draft.id ? titleRef : undefined} required value={draft.titulo} placeholder={section === "team" ? "Ej.: Reunión semanal de comunicación" : "Ej.: Corrección de campaña de septiembre"} onChange={(event) => change("titulo", event.target.value)}/></label>
              <label className="rf-wide">Detalle<textarea required rows={9} value={draft.contenido} placeholder="Escribí el feedback completo…" onChange={(event) => change("contenido", event.target.value)}/></label>
              <label>Responsable · opcional<input list="rf-users" maxLength={200} value={draft.feedback.responsable} onChange={(event) => changeMeta("responsable", event.target.value)}/><datalist id="rf-users">{users.map((user) => <option key={user.id || user.usuario} value={user.nombre || user.usuario}/>)}</datalist></label>
              <label>Categoría<select value={draft.categoria} onChange={(event) => change("categoria", event.target.value)}>{EDITABLE_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
              <label className="rf-wide">Referencia · opcional<input maxLength={2000} placeholder="Enlace, mensaje o dato relacionado" value={draft.feedback.referencia} onChange={(event) => changeMeta("referencia", event.target.value)}/></label>
            </div>
            <div className="rf-form-actions"><button type="button" onClick={closePanel}>Cancelar</button><button className="rf-primary" disabled={conflict} type="submit">{busy ? "Guardando…" : "Guardar feedback"}</button></div>
          </fieldset>
          {conflict && <p className="rf-conflict" role="alert">Otra persona guardó una versión más reciente. Tu texto sigue acá para que puedas copiarlo antes de volver a cargar.</p>}
        </form> : selected && <div className="rf-detail">
          <div className="rf-detail-heading"><span>{isClientNote(selected) ? selected.feedback.cliente : CATEGORY_LABELS[selected.categoria] || "Reunión"}</span><h2>{selected.titulo}</h2><p>Actualizado por {selected.modificado_por} · {formatDate(selected.updated_at)}</p></div>
          <div className="rf-detail-content">{selected.contenido || "Sin contenido."}</div>
          {selected.feedback?.referencia && <section className="rf-reference"><span>REFERENCIA</span><Reference text={selected.feedback.referencia}/></section>}
          <dl className="rf-detail-meta"><div><dt>Responsable</dt><dd>{selected.feedback?.responsable || "Sin asignar"}</dd></div><div><dt>Categoría</dt><dd>{CATEGORY_LABELS[selected.categoria] || "General"}</dd></div><div><dt>Creado por</dt><dd>{selected.creado_por}</dd></div></dl>
          <footer className="rf-detail-actions">{trash ? <button className="rf-primary" disabled={busy} onClick={() => trashAction(selected)}>Restaurar feedback</button> : <><button className="rf-danger" disabled={busy} onClick={() => trashAction(selected)}>Mover a Papelera</button><button className="rf-primary" disabled={busy} onClick={() => editNote(selected)}>Editar feedback</button></>}</footer>
        </div>}
      </section>
    </div>}

    {notes.length >= 500 && <p className="rf-limit">Se muestran las 500 notas más recientes. Las demás no se eliminaron.</p>}
  </main>;
}
