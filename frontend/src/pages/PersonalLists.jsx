import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import "./PersonalLists.css";

const EMOJIS = ["📝", "✅", "📌", "💡", "🗓️", "🎯", "🧠", "🚀", "📚", "🛒", "💬", "⭐"];

function jsonOptions(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function moveBefore(items, draggedId, targetId) {
  const from = items.findIndex((item) => Number(item.id) === Number(draggedId));
  const to = items.findIndex((item) => Number(item.id) === Number(targetId));
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [dragged] = next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next.map((item, position) => ({ ...item, posicion: position }));
}

function SavingStatus({ status }) {
  return <span className={`personal-save-status ${status}`} aria-live="polite">
    <i aria-hidden="true"/>{status === "saving" ? "Guardando…" : status === "error" ? "No se guardó" : "Guardado"}
  </span>;
}

function EmptyLists({ onCreate, creating }) {
  return <section className="personal-list-empty">
    <span aria-hidden="true">📝</span>
    <h1>Tu espacio para no olvidarte de nada</h1>
    <p>Armá listas privadas, ordená tus pendientes y tachalos cuando estén listos.</p>
    <button type="button" onClick={onCreate} disabled={creating}>+ Crear mi primera lista</button>
  </section>;
}

function ItemRow({ item, index, count, onChange, onToggle, onDelete, onMove, onDragStart, onDrop }) {
  return <div
    className={`personal-list-item ${item.completado ? "is-complete" : ""}`}
    draggable
    onDragStart={(event) => onDragStart(event, item.id)}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => onDrop(event, item.id)}
  >
    <button className="personal-drag-handle" type="button" aria-label={`Mover ${item.texto}`} title="Arrastrar para ordenar">⋮⋮</button>
    <label className="personal-checkbox">
      <input type="checkbox" checked={Boolean(item.completado)} onChange={(event) => onToggle(item, event.target.checked)}/>
      <span aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3.5 8 3 3 6-6"/></svg></span>
    </label>
    <input
      value={item.texto}
      aria-label="Pendiente"
      className="personal-item-text"
      onChange={(event) => onChange(item, event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
    <div className="personal-item-actions">
      <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Subir pendiente">↑</button>
      <button type="button" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label="Bajar pendiente">↓</button>
      <button className="danger" type="button" onClick={() => onDelete(item)} aria-label="Eliminar pendiente">×</button>
    </div>
  </div>;
}

function ListSection({ section, sectionIndex, sectionCount, draft, onDraftChange, onCreateItem, onUpdateTitle, onUpdateItem, onToggleItem, onDeleteItem, onDeleteSection, onMoveItem, onMoveSection, onDragSectionStart, onDropSection, onDragItemStart, onDropItem }) {
  return <section
    className="personal-list-section"
    draggable
    onDragStart={(event) => onDragSectionStart(event, section.id)}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => onDropSection(event, section.id)}
  >
    <header>
      <button className="personal-section-handle" type="button" aria-label={`Mover sección ${section.titulo}`}>⋮⋮</button>
      <input value={section.titulo} aria-label="Título de la sección" onChange={(event) => onUpdateTitle(section, event.target.value)}/>
      <div>
        <button type="button" disabled={sectionIndex === 0} onClick={() => onMoveSection(sectionIndex, -1)} aria-label="Subir sección">↑</button>
        <button type="button" disabled={sectionIndex === sectionCount - 1} onClick={() => onMoveSection(sectionIndex, 1)} aria-label="Bajar sección">↓</button>
        <button className="danger" type="button" onClick={() => onDeleteSection(section)} aria-label="Eliminar sección">×</button>
      </div>
    </header>
    <div className="personal-list-items">
      {section.items.map((item, index) => <ItemRow
        key={item.id}
        item={item}
        index={index}
        count={section.items.length}
        onChange={(current, text) => onUpdateItem(section.id, current, text)}
        onToggle={(current, checked) => onToggleItem(section.id, current, checked)}
        onDelete={(current) => onDeleteItem(section.id, current)}
        onMove={(itemIndex, direction) => onMoveItem(section.id, itemIndex, direction)}
        onDragStart={(event, itemId) => onDragItemStart(event, section.id, itemId)}
        onDrop={(event, itemId) => onDropItem(event, section.id, itemId)}
      />)}
      {!section.items.length && <p className="personal-section-empty">Todavía no hay pendientes en esta sección.</p>}
    </div>
    <form className="personal-add-item" onSubmit={(event) => { event.preventDefault(); onCreateItem(section.id); }}>
      <span aria-hidden="true">+</span>
      <input
        value={draft || ""}
        onChange={(event) => onDraftChange(section.id, event.target.value)}
        placeholder="Agregar pendiente"
        aria-label={`Agregar pendiente en ${section.titulo}`}
      />
    </form>
  </section>;
}

export function PersonalListsPage() {
  const [lists, setLists] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const dragged = useRef(null);
  const saveTimers = useRef(new Map());
  const pendingSaves = useRef(0);

  const activeList = useMemo(() => lists.find((list) => Number(list.id) === Number(activeId)) || lists[0] || null, [lists, activeId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest("/api/listas-personales");
      setLists(Array.isArray(data) ? data : []);
      setActiveId((current) => data.some((list) => Number(list.id) === Number(current)) ? current : data[0]?.id || null);
      setError("");
    } catch (reason) {
      setError(reason.message || "No se pudo abrir tu lista.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => saveTimers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const runSaving = useCallback(async (operation) => {
    pendingSaves.current += 1;
    setStatus("saving");
    try {
      const result = await operation();
      setError("");
      return result;
    } catch (reason) {
      setStatus("error");
      setError(reason.message || "No se pudieron guardar los cambios.");
      throw reason;
    } finally {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) setStatus((current) => current === "error" ? current : "saved");
    }
  }, []);

  const replaceList = useCallback((listId, transform) => {
    setLists((current) => current.map((list) => Number(list.id) === Number(listId) ? transform(list) : list));
  }, []);

  const createList = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await runSaving(() => apiRequest("/api/listas-personales", jsonOptions("POST", { titulo: "Sin título", emoji: "📝" })));
      setLists((current) => [...current, created]);
      setActiveId(created.id);
    } catch { /* El mensaje ya queda visible. */ } finally { setCreating(false); }
  };

  const saveListMeta = async (changes) => {
    if (!activeList) return;
    const clean = { ...changes };
    if (Object.hasOwn(clean, "titulo")) clean.titulo = clean.titulo.trim() || "Sin título";
    replaceList(activeList.id, (list) => ({ ...list, ...clean }));
    try {
      const updated = await runSaving(() => apiRequest(`/api/listas-personales/${activeList.id}`, jsonOptions("PATCH", clean)));
      replaceList(activeList.id, (list) => ({ ...list, ...updated }));
    } catch { load(); }
  };

  const deleteList = async () => {
    if (!activeList || !window.confirm(`¿Eliminar “${activeList.titulo}” y todos sus pendientes?`)) return;
    try {
      await runSaving(() => apiRequest(`/api/listas-personales/${activeList.id}`, { method: "DELETE" }));
      setLists((current) => current.filter((list) => list.id !== activeList.id));
      setActiveId(null);
    } catch { /* El mensaje ya queda visible. */ }
  };

  const createSection = async () => {
    if (!activeList) return;
    try {
      const section = await runSaving(() => apiRequest(`/api/listas-personales/${activeList.id}/secciones`, jsonOptions("POST", { titulo: "Nueva sección" })));
      replaceList(activeList.id, (list) => ({ ...list, secciones: [...list.secciones, section] }));
    } catch { /* El mensaje ya queda visible. */ }
  };

  const updateSectionTitle = (section, title) => {
    replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((current) => current.id === section.id ? { ...current, titulo: title } : current) }));
    const key = `section-${section.id}`;
    window.clearTimeout(saveTimers.current.get(key));
    saveTimers.current.set(key, window.setTimeout(async () => {
      if (!title.trim()) return load();
      try {
        const updated = await runSaving(() => apiRequest(`/api/listas-personales/secciones/${section.id}`, jsonOptions("PATCH", { titulo: title })));
        replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((current) => current.id === section.id ? { ...current, ...updated } : current) }));
      } catch { load(); }
    }, 550));
  };

  const deleteSection = async (section) => {
    const detail = section.items.length ? ` También se eliminarán ${section.items.length} pendientes.` : "";
    if (!window.confirm(`¿Eliminar la sección “${section.titulo}”?${detail}`)) return;
    try {
      await runSaving(() => apiRequest(`/api/listas-personales/secciones/${section.id}`, { method: "DELETE" }));
      replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.filter((current) => current.id !== section.id) }));
    } catch { /* El mensaje ya queda visible. */ }
  };

  const createItem = async (sectionId) => {
    const text = String(drafts[sectionId] || "").trim();
    if (!text) return;
    setDrafts((current) => ({ ...current, [sectionId]: "" }));
    try {
      const item = await runSaving(() => apiRequest(`/api/listas-personales/secciones/${sectionId}/items`, jsonOptions("POST", { texto: text })));
      replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((section) => section.id === sectionId ? { ...section, items: [...section.items, item] } : section) }));
    } catch { setDrafts((current) => ({ ...current, [sectionId]: text })); }
  };

  const updateItem = (sectionId, item, text) => {
    replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((section) => section.id === sectionId ? { ...section, items: section.items.map((current) => current.id === item.id ? { ...current, texto: text } : current) } : section) }));
    const key = `item-${item.id}`;
    window.clearTimeout(saveTimers.current.get(key));
    saveTimers.current.set(key, window.setTimeout(async () => {
      if (!text.trim()) return load();
      try {
        const updated = await runSaving(() => apiRequest(`/api/listas-personales/items/${item.id}`, jsonOptions("PATCH", { texto: text })));
        replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((section) => section.id === sectionId ? { ...section, items: section.items.map((current) => current.id === item.id ? { ...current, ...updated } : current) } : section) }));
      } catch { load(); }
    }, 550));
  };

  const toggleItem = async (sectionId, item, checked) => {
    window.clearTimeout(saveTimers.current.get(`item-${item.id}`));
    replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((section) => section.id === sectionId ? { ...section, items: section.items.map((current) => current.id === item.id ? { ...current, completado: checked } : current) } : section) }));
    try {
      const updated = await runSaving(() => apiRequest(`/api/listas-personales/items/${item.id}`, jsonOptions("PATCH", { texto: item.texto, completado: checked })));
      replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((section) => section.id === sectionId ? { ...section, items: section.items.map((current) => current.id === item.id ? { ...current, ...updated } : current) } : section) }));
    } catch { load(); }
  };

  const deleteItem = async (sectionId, item) => {
    try {
      await runSaving(() => apiRequest(`/api/listas-personales/items/${item.id}`, { method: "DELETE" }));
      replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((section) => section.id === sectionId ? { ...section, items: section.items.filter((current) => current.id !== item.id) } : section) }));
    } catch { /* El mensaje ya queda visible. */ }
  };

  const persistOrder = async (type, parentId, ids) => {
    try {
      await runSaving(() => apiRequest("/api/listas-personales/orden/reordenar", jsonOptions("PATCH", { tipo: type, parent_id: parentId, ids })));
    } catch { load(); }
  };

  const moveSection = (index, direction) => {
    const next = [...activeList.secciones];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    replaceList(activeList.id, (list) => ({ ...list, secciones: next }));
    persistOrder("secciones", activeList.id, next.map((section) => section.id));
  };

  const moveItem = (sectionId, index, direction) => {
    const section = activeList.secciones.find((current) => current.id === sectionId);
    const next = [...section.items];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((current) => current.id === sectionId ? { ...current, items: next } : current) }));
    persistOrder("items", sectionId, next.map((item) => item.id));
  };

  const dropSection = (event, targetId) => {
    event.preventDefault(); event.stopPropagation();
    if (dragged.current?.kind !== "section") return;
    const next = moveBefore(activeList.secciones, dragged.current.id, targetId);
    replaceList(activeList.id, (list) => ({ ...list, secciones: next }));
    persistOrder("secciones", activeList.id, next.map((section) => section.id));
    dragged.current = null;
  };

  const dropItem = (event, sectionId, targetId) => {
    event.preventDefault(); event.stopPropagation();
    if (dragged.current?.kind !== "item" || dragged.current.parentId !== sectionId) return;
    const section = activeList.secciones.find((current) => current.id === sectionId);
    const next = moveBefore(section.items, dragged.current.id, targetId);
    replaceList(activeList.id, (list) => ({ ...list, secciones: list.secciones.map((current) => current.id === sectionId ? { ...current, items: next } : current) }));
    persistOrder("items", sectionId, next.map((item) => item.id));
    dragged.current = null;
  };

  if (loading) return <main className="personal-lists-page is-empty"><div className="personal-list-loading"><i/><span>Cargando tu espacio…</span></div></main>;
  if (!lists.length) return <main className="personal-lists-page is-empty"><EmptyLists onCreate={createList} creating={creating}/>{error && <div className="personal-list-toast error">{error}</div>}</main>;

  return <main className="personal-lists-page">
    <aside className="personal-list-rail" aria-label="Mis listas">
      <div className="personal-list-rail-heading"><span>Mis listas</span><button type="button" onClick={createList} disabled={creating} aria-label="Crear lista">+</button></div>
      <div className="personal-list-tabs">
        {lists.map((list) => <button key={list.id} className={list.id === activeList.id ? "active" : ""} type="button" onClick={() => setActiveId(list.id)}><span>{list.emoji}</span><strong>{list.titulo}</strong></button>)}
      </div>
      <p>Solo vos podés ver este espacio.</p>
    </aside>
    <article className="personal-list-document">
      <div className="personal-list-toolbar">
        <span>Lista personal</span>
        <div><SavingStatus status={status}/><button className="personal-more-button" type="button" onClick={deleteList} aria-label="Eliminar lista">•••</button></div>
      </div>
      {error && <div className="personal-list-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(""); load(); }}>Reintentar</button></div>}
      <div className="personal-list-cover"/>
      <div className="personal-list-content">
        <div className="personal-emoji-wrap">
          <button className="personal-list-emoji" type="button" onClick={() => setEmojiOpen((current) => !current)} aria-label="Cambiar emoji">{activeList.emoji}</button>
          {emojiOpen && <div className="personal-emoji-picker" role="dialog" aria-label="Elegir emoji">{EMOJIS.map((emoji) => <button key={emoji} type="button" onClick={() => { setEmojiOpen(false); saveListMeta({ emoji }); }}>{emoji}</button>)}</div>}
        </div>
        <input className="personal-list-title" value={activeList.titulo} aria-label="Título de la lista" onChange={(event) => replaceList(activeList.id, (list) => ({ ...list, titulo: event.target.value }))} onBlur={(event) => saveListMeta({ titulo: event.target.value })}/>
        <p className="personal-list-hint">Escribí lo que no querés olvidar. Todo se guarda automáticamente.</p>
        <div className="personal-sections">
          {activeList.secciones.map((section, index) => <ListSection
            key={section.id}
            section={section}
            sectionIndex={index}
            sectionCount={activeList.secciones.length}
            draft={drafts[section.id]}
            onDraftChange={(sectionId, value) => setDrafts((current) => ({ ...current, [sectionId]: value }))}
            onCreateItem={createItem}
            onUpdateTitle={updateSectionTitle}
            onUpdateItem={updateItem}
            onToggleItem={toggleItem}
            onDeleteItem={deleteItem}
            onDeleteSection={deleteSection}
            onMoveItem={moveItem}
            onMoveSection={moveSection}
            onDragSectionStart={(event, id) => { dragged.current = { kind: "section", id }; event.dataTransfer.effectAllowed = "move"; }}
            onDropSection={dropSection}
            onDragItemStart={(event, parentId, id) => { event.stopPropagation(); dragged.current = { kind: "item", parentId, id }; event.dataTransfer.effectAllowed = "move"; }}
            onDropItem={dropItem}
          />)}
        </div>
        <button className="personal-add-section" type="button" onClick={createSection}><span>+</span> Nueva sección</button>
      </div>
    </article>
  </main>;
}
