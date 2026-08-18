import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import "./BlocNotas.css";

export const CATEGORIAS_NOTA = [
  { id: "todas", label: "Todas" },
  { id: "general", label: "General" },
  { id: "diseno", label: "Diseño" },
  { id: "web", label: "Página web" },
  { id: "reunion", label: "Reunión" },
  { id: "contenido", label: "Contenido" },
];

const CATEGORIAS_EDITABLES = CATEGORIAS_NOTA.filter((categoria) => categoria.id !== "todas");

function categoriaNota(id) {
  return CATEGORIAS_EDITABLES.find((categoria) => categoria.id === id) || CATEGORIAS_EDITABLES[0];
}

function formatRelative(value) {
  if (!value) return "";
  const date = new Date(value);
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Ahora";
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} h`;
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function formatFull(value) {
  return value ? new Date(value).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function BlocNotasPage() {
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(Number(initial.get("note")) || null);
  const [query, setQuery] = useState(initial.get("q") || "");
  const [trash, setTrash] = useState(initial.get("mode") === "trash");
  const [category, setCategory] = useState(initial.get("category") || "todas");
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const latestVersion = useRef(new Map());
  const activeNoteId = useRef(selectedId);
  const selected = notes.find((note) => note.id === selectedId) || null;

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (trash) params.set("papelera", "true");
      if (query.trim()) params.set("q", query.trim());
      if (category !== "todas") params.set("categoria", category);
      const data = await apiRequest(`/api/notas?${params.toString()}`);
      latestVersion.current = new Map(data.map((note) => [note.id, note]));
      setNotes(data);
      setError("");
      if (selectedId && !data.some((note) => note.id === selectedId)) setSelectedId(null);
    } catch (reason) { setError(reason.message || "No se pudieron cargar las notas."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(load, query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [query, trash, category]);

  useEffect(() => {
    activeNoteId.current = selectedId;
    setDraft(selected ? { titulo: selected.titulo, contenido: selected.contenido, categoria: selected.categoria || "general" } : null);
    setSaving("");
  }, [selected?.id]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  useEffect(() => {
    const url = new URL(window.location.href);
    selectedId ? url.searchParams.set("note", String(selectedId)) : url.searchParams.delete("note");
    query ? url.searchParams.set("q", query) : url.searchParams.delete("q");
    trash ? url.searchParams.set("mode", "trash") : url.searchParams.delete("mode");
    category !== "todas" ? url.searchParams.set("category", category) : url.searchParams.delete("category");
    window.history.replaceState(window.history.state, "", url);
  }, [selectedId, query, trash, category]);

  const persist = (nextDraft) => {
    const noteId = selectedId;
    setDraft(nextDraft);
    setSaving("pending");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
        const base = latestVersion.current.get(noteId);
        if (!base) return;
        try {
          const updated = await apiRequest(`/api/notas/${noteId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...nextDraft, expected_updated_at: base.updated_at }),
          });
          latestVersion.current.set(updated.id, updated);
          setNotes((current) => [updated, ...current.filter((note) => note.id !== updated.id)]);
          if (activeNoteId.current === noteId) setSaving("saved");
        } catch (reason) {
          if (activeNoteId.current === noteId) setSaving(reason.status === 409 ? "conflict" : "error");
          setError(reason.message || "No se pudo guardar la nota.");
        }
      });
    }, 650);
  };

  const createNote = async () => {
    try {
      const created = await apiRequest("/api/notas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo: "Nueva nota", contenido: "", categoria: category === "todas" ? "general" : category }) });
      latestVersion.current.set(created.id, created);
      setTrash(false); setQuery(""); setCategory(created.categoria); setNotes((current) => [created, ...current]); setSelectedId(created.id);
    } catch (reason) { setError(reason.message || "No se pudo crear la nota."); }
  };

  const moveToTrash = async () => {
    if (!selected || !window.confirm(`¿Mover “${selected.titulo}” a la Papelera?`)) return;
    await apiRequest(`/api/notas/${selected.id}`, { method: "DELETE" });
    setNotes((current) => current.filter((note) => note.id !== selected.id)); setSelectedId(null);
  };

  const restore = async () => {
    if (!selected) return;
    await apiRequest(`/api/notas/${selected.id}/restaurar`, { method: "POST" });
    setNotes((current) => current.filter((note) => note.id !== selected.id)); setSelectedId(null);
  };

  const removeForever = async () => {
    if (!selected || !window.confirm(`¿Eliminar definitivamente “${selected.titulo}”? Esta acción no se puede deshacer.`)) return;
    await apiRequest(`/api/notas/${selected.id}?permanente=true`, { method: "DELETE" });
    setNotes((current) => current.filter((note) => note.id !== selected.id)); setSelectedId(null);
  };

  return <main className={`notes-page ${selected ? "note-open" : ""}`}>
    <header className="notes-header"><div><span className="notes-kicker">ESPACIO COMPARTIDO</span><h1>Bloc de notas</h1><p>Información importante del equipo, siempre en un mismo lugar.</p></div><button onClick={createNote}>+ Nueva nota</button></header>
    {error && <button className="notes-error" onClick={() => setError("")}>! {error} <span>×</span></button>}
    <section className="notes-shell">
      <aside className="notes-list"><div className="notes-search"><span>⌕</span><input aria-label="Buscar notas" placeholder="Buscar notas…" value={query} onChange={(event) => setQuery(event.target.value)}/></div><div className="notes-category-filters" aria-label="Filtrar notas por categoría">{CATEGORIAS_NOTA.map((item) => <button type="button" key={item.id} className={`is-${item.id} ${category === item.id ? "active" : ""}`} onClick={() => { setCategory(item.id); setSelectedId(null); }}>{item.label}</button>)}</div><div className="notes-list-title"><strong>{trash ? "Papelera" : "Notas"}</strong><small>{notes.length}</small></div><div className="notes-items">{loading ? <div className="notes-empty">Cargando…</div> : notes.map((note) => { const noteCategory = categoriaNota(note.categoria); return <button key={note.id} className={`${note.id === selectedId ? "active" : ""} note-category-${noteCategory.id}`} onClick={() => setSelectedId(note.id)}><span className="notes-item-category">{noteCategory.label}</span><strong>{note.titulo || "Nueva nota"}</strong><p>{note.contenido || "Sin contenido"}</p><small>{formatRelative(note.updated_at)} · {note.modificado_por}</small></button>; })}{!loading && notes.length === 0 && <div className="notes-empty">{query ? "No encontramos notas." : trash ? "La Papelera está vacía." : "Todavía no hay notas en esta categoría."}</div>}</div><button className={`notes-trash-toggle ${trash ? "active" : ""}`} onClick={() => { setTrash((value) => !value); setSelectedId(null); }}>{trash ? "← Volver a Notas" : "⌫ Papelera"}</button></aside>
      <article className="notes-editor">{selected && draft ? <><div className="notes-editor-mobile"><button onClick={() => setSelectedId(null)}>‹ Notas</button></div><div className={`notes-category-picker is-${draft.categoria}`}><span>Categoría</span><select aria-label="Categoría de la nota" value={draft.categoria} onChange={(event) => persist({ ...draft, categoria: event.target.value })}>{CATEGORIAS_EDITABLES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div><input className="notes-title" aria-label="Título de la nota" value={draft.titulo} onChange={(event) => persist({ ...draft, titulo: event.target.value })}/><textarea aria-label="Contenido de la nota" autoFocus value={draft.contenido} placeholder="Empezá a escribir…" onChange={(event) => persist({ ...draft, contenido: event.target.value })}/><footer><div><span>Creada por <strong>{selected.creado_por}</strong></span><span>Última edición: <strong>{selected.modificado_por}</strong> · {formatFull(selected.updated_at)}</span></div><div className={`notes-save-state ${saving}`}>{saving === "pending" ? "Guardando…" : saving === "saved" ? "✓ Guardado" : saving === "conflict" ? "Hay una versión más reciente" : saving === "error" ? "No se pudo guardar" : ""}</div>{trash ? <div className="notes-actions"><button onClick={restore}>Restaurar</button><button className="danger" onClick={removeForever}>Eliminar definitivamente</button></div> : <button className="notes-delete" onClick={moveToTrash}>Mover a Papelera</button>}</footer></> : <div className="notes-welcome"><span>▤</span><strong>{trash ? "Seleccioná una nota eliminada" : "Seleccioná una nota"}</strong><p>{trash ? "Podés restaurarla o eliminarla definitivamente." : "O creá una nueva para registrar algo importante."}</p>{!trash && <button onClick={createNote}>+ Nueva nota</button>}</div>}</article>
    </section>
  </main>;
}
