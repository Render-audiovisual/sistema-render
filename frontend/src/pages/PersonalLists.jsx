import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../features/render-os/services/render-os-api.js";
import "./PersonalLists.css";

const EMOJI_OPTIONS = [
  ["📝", "nota escribir"], ["✅", "listo tarea"], ["📌", "importante pin"], ["💡", "idea"], ["🗓️", "calendario semana"], ["🎯", "objetivo"], ["🧠", "mente ideas"], ["🚀", "proyecto"],
  ["📚", "estudio libros"], ["🛒", "compras"], ["💬", "mensajes"], ["⭐", "favorito"], ["☀️", "día sol"], ["🌙", "noche"], ["⚡", "rápido energía"], ["🔥", "urgente fuego"],
  ["❤️", "corazón"], ["🎨", "diseño arte"], ["🎬", "video cine"], ["📷", "foto cámara"], ["📣", "comunicación anuncio"], ["💼", "trabajo"], ["🏠", "casa"], ["✈️", "viaje"],
  ["🍔", "comida"], ["💪", "entrenamiento"], ["💰", "dinero"], ["🔒", "privado"], ["🧩", "plantilla"], ["🌱", "crecimiento"], ["👀", "revisar"], ["🎉", "evento"],
];
const BLOCK_LABELS = { texto: "Texto", listado: "Listado", checklist: "Checklist", tabla: "Tabla" };

function uid(prefix = "item") {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}
function jsonOptions(method, body) { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

function newTableContent(title = "Plan semanal") {
  const columnas = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((titulo) => ({ id: uid("col"), titulo }));
  const filas = Array.from({ length: 3 }, () => ({ id: uid("row"), celdas: Object.fromEntries(columnas.map((column) => [column.id, { texto: "", completado: false }])) }));
  return { titulo: title, columnas, filas };
}
function newBlock(tipo) {
  if (tipo === "texto") return { tipo, contenido: { texto: "" } };
  if (tipo === "tabla") return { tipo, contenido: newTableContent("Tabla") };
  return { tipo, contenido: { titulo: tipo === "checklist" ? "Pendientes" : "Listado", items: [] } };
}

const SYSTEM_TEMPLATES = [
  { key: "blank", emoji: "📄", titulo: "Página vacía", descripcion: "Empezá desde cero", bloques: [] },
  { key: "week", emoji: "🗓️", titulo: "Semana", descripcion: "Organizá cada día", bloques: [{ tipo: "tabla", contenido: newTableContent() }] },
  { key: "tasks", emoji: "✅", titulo: "Pendientes", descripcion: "Una checklist simple", bloques: [newBlock("checklist")] },
  { key: "day", emoji: "☀️", titulo: "Plan diario", descripcion: "Foco y pendientes", bloques: [{ tipo: "texto", contenido: { texto: "Objetivo del día" } }, { tipo: "checklist", contenido: { titulo: "Para hoy", items: [] } }] },
];

function cloneTemplateBlocks(blocks) {
  return blocks.map((block) => {
    if (block.tipo === "tabla") {
      const columnas = block.contenido.columnas.map((column) => ({ id: uid("col"), titulo: column.titulo }));
      return { tipo: "tabla", contenido: { titulo: block.contenido.titulo, columnas, filas: block.contenido.filas.map((row) => ({ id: uid("row"), celdas: Object.fromEntries(columnas.map((column, index) => [column.id, { ...(row.celdas?.[block.contenido.columnas[index].id] || { texto: "", completado: false }) }])) })) } };
    }
    if (block.tipo === "texto") return { tipo: "texto", contenido: { texto: block.contenido.texto || "" } };
    return { tipo: block.tipo, contenido: { titulo: block.contenido.titulo, items: (block.contenido.items || []).map((item) => ({ ...item, id: uid("item") })) } };
  });
}

function SavingStatus({ status }) {
  return <span className={`personal-save-status ${status}`} aria-live="polite"><i aria-hidden="true"/>{status === "saving" ? "Guardando…" : status === "error" ? "No se guardó" : "Guardado"}</span>;
}

function EmojiPicker({ value, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const results = EMOJI_OPTIONS.filter(([emoji, tags]) => `${emoji} ${tags}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="personal-emoji-popover" role="dialog" aria-label="Elegir emoji">
    <header><strong>Elegí un emoji</strong><button type="button" onClick={onClose} aria-label="Cerrar">×</button></header>
    <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar emoji" aria-label="Buscar emoji"/>
    <div className="personal-emoji-grid">{results.map(([emoji]) => <button className={emoji === value ? "selected" : ""} key={emoji} type="button" onClick={() => onSelect(emoji)}>{emoji}</button>)}</div>
    <form className="personal-emoji-manual" onSubmit={(event) => { event.preventDefault(); if (manual.trim()) onSelect(manual.trim()); }}><input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="O pegá cualquier emoji" aria-label="Pegar emoji"/><button type="submit" disabled={!manual.trim()}>Usar</button></form>
  </div>;
}

function TemplateDialog({ templates, creating, onChoose, onClose, onDelete }) {
  return <div className="personal-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="personal-template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title">
      <header><div><span>Nueva página</span><h2 id="template-title">¿Cómo querés empezar?</h2></div><button type="button" onClick={onClose} aria-label="Cerrar">×</button></header>
      <div className="personal-template-grid">{SYSTEM_TEMPLATES.map((template) => <button key={template.key} type="button" onClick={() => onChoose(template)} disabled={creating}><span>{template.emoji}</span><strong>{template.titulo}</strong><small>{template.descripcion}</small></button>)}</div>
      {!!templates.length && <div className="personal-custom-templates"><h3>Mis plantillas</h3>{templates.map((template) => <div key={template.id}><button type="button" onClick={() => onChoose(template)} disabled={creating}><span>{template.emoji}</span><strong>{template.titulo}</strong></button><button className="danger" type="button" onClick={() => onDelete(template)} aria-label={`Eliminar plantilla ${template.titulo}`}>×</button></div>)}</div>}
    </section>
  </div>;
}

function NameTemplateDialog({ defaultName, onSave, onClose, saving }) {
  const [name, setName] = useState(defaultName || "Mi plantilla");
  return <div className="personal-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="personal-name-modal" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}><h2>Guardar como plantilla</h2><p>La plantilla será privada y podrás reutilizarla cuando quieras.</p><label>Nombre<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120}/></label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" type="submit" disabled={!name.trim() || saving}>Guardar plantilla</button></footer></form></div>;
}

function BlockActions({ block, index, count, onMove, onDelete }) {
  return <div className="personal-block-actions"><span className="personal-block-type">{BLOCK_LABELS[block.tipo]}</span><div><button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Mover bloque hacia arriba">↑</button><button type="button" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label="Mover bloque hacia abajo">↓</button><button className="danger" type="button" onClick={() => onDelete(block)} aria-label={`Eliminar bloque ${BLOCK_LABELS[block.tipo]}`}>Eliminar</button></div></div>;
}
function TextBlock({ content, onChange }) { return <textarea className="personal-text-block" rows="4" value={content.texto || ""} onChange={(event) => onChange({ texto: event.target.value })} placeholder="Escribí algo…" aria-label="Bloque de texto"/>; }

function ItemsBlock({ type, content, onChange }) {
  const [draft, setDraft] = useState("");
  const withChecks = type === "checklist";
  const items = content.items || [];
  const updateItem = (id, changes) => onChange({ ...content, items: items.map((item) => item.id === id ? { ...item, ...changes } : item) });
  const removeItem = (id) => onChange({ ...content, items: items.filter((item) => item.id !== id) });
  const moveItem = (index, direction) => { const target = index + direction; if (target < 0 || target >= items.length) return; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; onChange({ ...content, items: next }); };
  const addItem = (event) => { event.preventDefault(); if (!draft.trim()) return; onChange({ ...content, items: [...items, { id: uid("item"), texto: draft.trim(), ...(withChecks ? { completado: false } : {}) }] }); setDraft(""); };
  return <div className="personal-items-block">
    <input className="personal-block-title" value={content.titulo || ""} onChange={(event) => onChange({ ...content, titulo: event.target.value })} aria-label="Título del bloque"/>
    <div className="personal-block-items">{items.map((item, index) => <div className={`personal-block-item ${item.completado ? "complete" : ""}`} key={item.id}>{withChecks ? <label className="personal-checkbox"><input type="checkbox" checked={Boolean(item.completado)} onChange={(event) => updateItem(item.id, { completado: event.target.checked })}/><span aria-hidden="true">✓</span></label> : <span className="personal-list-bullet">•</span>}<input value={item.texto} onChange={(event) => updateItem(item.id, { texto: event.target.value })} aria-label="Elemento"/><div className="personal-row-actions"><button type="button" disabled={index === 0} onClick={() => moveItem(index, -1)} aria-label="Subir elemento">↑</button><button type="button" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} aria-label="Bajar elemento">↓</button><button className="danger" type="button" onClick={() => removeItem(item.id)} aria-label="Eliminar elemento">×</button></div></div>)}</div>
    <form className="personal-add-row" onSubmit={addItem}><span>+</span><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={withChecks ? "Agregar pendiente" : "Agregar elemento"} aria-label="Agregar elemento"/></form>
  </div>;
}

function TableActions({ label, children }) {
  return <details className="personal-table-actions" name="personal-table-actions" onClickCapture={(event) => { if (event.target.closest("button") && !event.target.disabled) event.currentTarget.removeAttribute("open"); }}>
    <summary aria-label={label}>•••</summary>
    <div>{children}</div>
  </details>;
}

function TableBlock({ content, onChange }) {
  const columns = content.columnas || [];
  const rows = content.filas || [];
  const tableScrollRef = useRef(null);
  const [activeColumn, setActiveColumn] = useState(0);
  const setColumns = (nextColumns, nextRows = rows) => onChange({ ...content, columnas: nextColumns, filas: nextRows });
  const updateColumn = (id, title) => setColumns(columns.map((column) => column.id === id ? { ...column, titulo: title } : column));
  const addColumn = () => { if (columns.length >= 14) return; const column = { id: uid("col"), titulo: `Columna ${columns.length + 1}` }; setColumns([...columns, column], rows.map((row) => ({ ...row, celdas: { ...row.celdas, [column.id]: { texto: "", completado: false } } }))); };
  const removeColumn = (column) => { if (columns.length === 1 || !window.confirm(`¿Eliminar la columna “${column.titulo}” y su contenido?`)) return; setColumns(columns.filter((current) => current.id !== column.id), rows.map((row) => { const celdas = { ...row.celdas }; delete celdas[column.id]; return { ...row, celdas }; })); };
  const moveColumn = (index, direction) => { const target = index + direction; if (target < 0 || target >= columns.length) return; const next = [...columns]; [next[index], next[target]] = [next[target], next[index]]; setColumns(next); };
  const addRow = () => onChange({ ...content, filas: [...rows, { id: uid("row"), celdas: Object.fromEntries(columns.map((column) => [column.id, { texto: "", completado: false }])) }] });
  const removeRow = (row) => onChange({ ...content, filas: rows.filter((current) => current.id !== row.id) });
  const moveRow = (index, direction) => { const target = index + direction; if (target < 0 || target >= rows.length) return; const next = [...rows]; [next[index], next[target]] = [next[target], next[index]]; onChange({ ...content, filas: next }); };
  const updateCell = (rowId, columnId, changes) => onChange({ ...content, filas: rows.map((row) => row.id === rowId ? { ...row, celdas: { ...row.celdas, [columnId]: { ...row.celdas[columnId], ...changes } } } : row) });
  useEffect(() => setActiveColumn((current) => Math.min(current, Math.max(0, columns.length - 1))), [columns.length]);
  const scrollToColumn = (index) => {
    const next = Math.max(0, Math.min(index, columns.length - 1));
    const container = tableScrollRef.current;
    const headers = container?.querySelectorAll("thead th");
    const target = headers?.[next + 1];
    if (container && target) container.scrollTo({ left: Math.max(0, target.offsetLeft - 50), behavior: "smooth" });
    setActiveColumn(next);
  };
  const detectVisibleColumn = () => {
    const container = tableScrollRef.current;
    const headers = container?.querySelectorAll("thead th");
    if (!container || !headers?.length) return;
    const marker = container.scrollLeft + 54;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    columns.forEach((_, index) => { const current = Math.abs((headers[index + 1]?.offsetLeft || 0) - marker); if (current < distance) { distance = current; closest = index; } });
    setActiveColumn((current) => current === closest ? current : closest);
  };
  return <div className="personal-table-block">
    <div className="personal-table-heading"><div className="personal-table-title"><span>Tabla</span><input className="personal-block-title" value={content.titulo || ""} onChange={(event) => onChange({ ...content, titulo: event.target.value })} aria-label="Título de la tabla"/></div><div className="personal-table-primary-actions"><button type="button" onClick={addRow}><span>+</span> Fila</button><button type="button" onClick={addColumn} disabled={columns.length >= 14}><span>+</span> Columna</button></div></div>
    <p className="personal-table-mobile-hint">Deslizá para ver todas las columnas →</p>
    {columns.length > 1 && <div className="personal-table-navigator" role="group" aria-label="Navegar por las columnas"><button type="button" disabled={activeColumn === 0} onClick={() => scrollToColumn(activeColumn - 1)} aria-label="Columna anterior">‹</button><div><span>Columna</span><strong>{columns[activeColumn]?.titulo || `Columna ${activeColumn + 1}`}</strong><small>{activeColumn + 1} de {columns.length}</small></div><button type="button" disabled={activeColumn === columns.length - 1} onClick={() => scrollToColumn(activeColumn + 1)} aria-label="Columna siguiente">›</button></div>}
    <div ref={tableScrollRef} className="personal-table-scroll" tabIndex="0" aria-label="Tabla desplazable" onScroll={detectVisibleColumn}><table style={{ minWidth: `${Math.max(560, columns.length * 178 + 50)}px` }}><thead><tr><th className="personal-table-row-tools"><span aria-hidden="true">#</span></th>{columns.map((column, index) => <th key={column.id}><div className="personal-table-column-head"><input value={column.titulo} onChange={(event) => updateColumn(column.id, event.target.value)} aria-label="Nombre de columna"/><TableActions label={`Opciones de ${column.titulo || "columna"}`}><button type="button" disabled={index === 0} onClick={() => moveColumn(index, -1)} aria-label="Mover columna a la izquierda">←</button><button type="button" disabled={index === columns.length - 1} onClick={() => moveColumn(index, 1)} aria-label="Mover columna a la derecha">→</button><button className="danger" type="button" disabled={columns.length === 1} onClick={() => removeColumn(column)} aria-label="Eliminar columna">×</button></TableActions></div></th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={row.id}><td className="personal-table-row-tools"><TableActions label={`Opciones de la fila ${rowIndex + 1}`}><button type="button" disabled={rowIndex === 0} onClick={() => moveRow(rowIndex, -1)} aria-label="Subir fila">↑</button><button type="button" disabled={rowIndex === rows.length - 1} onClick={() => moveRow(rowIndex, 1)} aria-label="Bajar fila">↓</button><button className="danger" type="button" onClick={() => removeRow(row)} aria-label="Eliminar fila">×</button></TableActions></td>{columns.map((column) => { const cell = row.celdas?.[column.id] || { texto: "", completado: false }; return <td key={column.id} className={cell.completado ? "complete" : ""}><label className="personal-cell-check"><input type="checkbox" checked={Boolean(cell.completado)} onChange={(event) => updateCell(row.id, column.id, { completado: event.target.checked })}/><span>✓</span></label><textarea rows="2" value={cell.texto} onChange={(event) => updateCell(row.id, column.id, { texto: event.target.value })} placeholder="Agregar nota…" aria-label={`${column.titulo}, fila ${rowIndex + 1}`}/></td>; })}</tr>)}</tbody></table></div>
    {!rows.length && <button className="personal-table-empty" type="button" onClick={addRow}>+ Agregar la primera fila</button>}
  </div>;
}

function BlockEditor({ block, index, count, onChange, onMove, onDelete }) {
  return <section className="personal-editor-block"><BlockActions block={block} index={index} count={count} onMove={onMove} onDelete={onDelete}/>{block.tipo === "texto" && <TextBlock content={block.contenido} onChange={onChange}/>} {(block.tipo === "listado" || block.tipo === "checklist") && <ItemsBlock type={block.tipo} content={block.contenido} onChange={onChange}/>} {block.tipo === "tabla" && <TableBlock content={block.contenido} onChange={onChange}/>}</section>;
}

function AddBlockMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  return <div className="personal-add-block-wrap"><button className="personal-add-block" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}><span>+</span> Agregar bloque</button>{open && <div className="personal-block-menu">{Object.entries(BLOCK_LABELS).map(([type, label]) => <button key={type} type="button" onClick={() => { setOpen(false); onAdd(type); }}><span>{type === "texto" ? "T" : type === "listado" ? "•" : type === "checklist" ? "✓" : "▦"}</span><div><strong>{label}</strong><small>{type === "tabla" ? "Filas y columnas personalizables" : type === "texto" ? "Una nota libre" : "Elementos ordenados"}</small></div></button>)}</div>}</div>;
}

export function PersonalListsPage() {
  const [lists, setLists] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(() => globalThis.matchMedia?.("(min-width: 981px)").matches ?? true);
  const timers = useRef(new Map());
  const pendingSaves = useRef(0);
  const activeList = useMemo(() => lists.find((list) => Number(list.id) === Number(activeId)) || lists[0] || null, [lists, activeId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listData, templateData] = await Promise.all([apiRequest("/api/listas-personales"), apiRequest("/api/listas-personales/plantillas")]);
      const nextLists = Array.isArray(listData) ? listData : [];
      setLists(nextLists); setTemplates(Array.isArray(templateData) ? templateData : []);
      setActiveId((current) => nextLists.some((list) => Number(list.id) === Number(current)) ? current : nextLists[0]?.id || null); setError("");
    } catch (reason) { setError(reason.message || "No se pudo abrir tu espacio."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const runSaving = useCallback(async (operation) => {
    pendingSaves.current += 1; setStatus("saving");
    try { const result = await operation(); setError(""); return result; }
    catch (reason) { setStatus("error"); setError(reason.message || "No se pudieron guardar los cambios."); throw reason; }
    finally { pendingSaves.current -= 1; if (!pendingSaves.current) setStatus((current) => current === "error" ? current : "saved"); }
  }, []);
  const replaceList = useCallback((listId, transform) => setLists((current) => current.map((list) => Number(list.id) === Number(listId) ? transform(list) : list)), []);
  const replaceBlock = useCallback((listId, blockId, transform) => replaceList(listId, (list) => ({ ...list, bloques: (list.bloques || []).map((block) => Number(block.id) === Number(blockId) ? transform(block) : block) })), [replaceList]);

  const createList = async (template) => {
    if (creating) return; setCreating(true);
    try { const created = await runSaving(() => apiRequest("/api/listas-personales", jsonOptions("POST", { titulo: template.titulo === "Página vacía" ? "Sin título" : template.titulo, emoji: template.emoji, bloques: cloneTemplateBlocks(template.bloques || []) }))); setLists((current) => [...current, created]); setActiveId(created.id); setTemplateOpen(false); }
    catch { /* El error queda visible. */ } finally { setCreating(false); }
  };
  const saveListMeta = async (changes) => {
    if (!activeList) return; const listId = activeList.id; const clean = { ...changes }; if (Object.hasOwn(clean, "titulo")) clean.titulo = clean.titulo.trim() || "Sin título"; replaceList(listId, (list) => ({ ...list, ...clean }));
    try { const updated = await runSaving(() => apiRequest(`/api/listas-personales/${listId}`, jsonOptions("PATCH", clean))); replaceList(listId, (list) => ({ ...list, ...updated })); } catch { load(); }
  };
  const deleteList = async () => {
    if (!activeList || !window.confirm(`¿Eliminar “${activeList.titulo}” y todo su contenido? Esta acción no se puede deshacer.`)) return; const listId = activeList.id;
    try { await runSaving(() => apiRequest(`/api/listas-personales/${listId}`, { method: "DELETE" })); setLists((current) => current.filter((list) => Number(list.id) !== Number(listId))); setActiveId(null); } catch { /* El error queda visible. */ }
  };
  const addBlock = async (type) => {
    if (!activeList) return; const listId = activeList.id;
    try { const block = await runSaving(() => apiRequest(`/api/listas-personales/${listId}/bloques`, jsonOptions("POST", newBlock(type)))); replaceList(listId, (list) => ({ ...list, bloques: [...(list.bloques || []), block] })); } catch { /* El error queda visible. */ }
  };
  const changeBlock = (block, content) => {
    const listId = activeList.id; replaceBlock(listId, block.id, (current) => ({ ...current, contenido: content })); const key = `block-${block.id}`; window.clearTimeout(timers.current.get(key));
    timers.current.set(key, window.setTimeout(async () => { try { const updated = await runSaving(() => apiRequest(`/api/listas-personales/bloques/${block.id}`, jsonOptions("PATCH", { tipo: block.tipo, contenido: content }))); replaceBlock(listId, block.id, (current) => ({ ...current, version: updated.version, updated_at: updated.updated_at })); } catch { load(); } }, 650));
  };
  const deleteBlock = async (block) => {
    if (!window.confirm(`¿Eliminar este bloque de ${BLOCK_LABELS[block.tipo].toLowerCase()}?`)) return; const listId = activeList.id; window.clearTimeout(timers.current.get(`block-${block.id}`));
    try { await runSaving(() => apiRequest(`/api/listas-personales/bloques/${block.id}`, { method: "DELETE" })); replaceList(listId, (list) => ({ ...list, bloques: list.bloques.filter((current) => current.id !== block.id) })); } catch { /* El error queda visible. */ }
  };
  const moveBlock = (index, direction) => {
    const listId = activeList.id; const blocks = [...activeList.bloques]; const target = index + direction; if (target < 0 || target >= blocks.length) return; [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; replaceList(listId, (list) => ({ ...list, bloques: blocks })); runSaving(() => apiRequest("/api/listas-personales/orden/reordenar", jsonOptions("PATCH", { tipo: "bloques", parent_id: listId, ids: blocks.map((block) => block.id) }))).catch(load);
  };
  const saveAsTemplate = async (name) => {
    if (!activeList) return;
    try { const template = await runSaving(() => apiRequest("/api/listas-personales/plantillas", jsonOptions("POST", { titulo: name, emoji: activeList.emoji, bloques: activeList.bloques.map(({ tipo, contenido }) => ({ tipo, contenido })) }))); setTemplates((current) => [template, ...current]); setSaveTemplateOpen(false); } catch { /* El error queda visible. */ }
  };
  const deleteTemplate = async (template) => {
    if (!window.confirm(`¿Eliminar la plantilla “${template.titulo}”?`)) return;
    try { await runSaving(() => apiRequest(`/api/listas-personales/plantillas/${template.id}`, { method: "DELETE" })); setTemplates((current) => current.filter((item) => item.id !== template.id)); } catch { /* El error queda visible. */ }
  };

  if (loading) return <main className="personal-lists-page is-empty"><div className="personal-list-loading"><i/><span>Cargando tu espacio…</span></div></main>;
  if (!lists.length) return <main className="personal-lists-page is-empty"><section className="personal-list-empty"><span>📝</span><h1>Tu espacio, a tu manera</h1><p>Creá páginas privadas con tablas, listas y checklists.</p><button type="button" onClick={() => setTemplateOpen(true)}>+ Crear mi primera página</button></section>{templateOpen && <TemplateDialog templates={templates} creating={creating} onChoose={createList} onClose={() => setTemplateOpen(false)} onDelete={deleteTemplate}/>} {error && <div className="personal-list-toast error">{error}</div>}</main>;

  return <main className={`personal-lists-page ${railOpen ? "rail-open" : "rail-closed"}`}>
    <button className="personal-list-rail-scrim" type="button" onClick={() => setRailOpen(false)} aria-label="Cerrar páginas" tabIndex={railOpen ? 0 : -1}/>
    <aside id="personal-list-pages" className="personal-list-rail" aria-label="Mis páginas" aria-hidden={!railOpen} inert={!railOpen ? true : undefined}><div className="personal-list-rail-heading"><span>Mis páginas</span><div><button type="button" onClick={() => setTemplateOpen(true)} aria-label="Crear página">+</button><button className="personal-list-rail-close" type="button" onClick={() => setRailOpen(false)} aria-label="Cerrar panel de páginas">‹</button></div></div><div className="personal-list-tabs">{lists.map((list) => <button key={list.id} className={Number(list.id) === Number(activeList.id) ? "active" : ""} type="button" onClick={() => { setActiveId(list.id); if (globalThis.matchMedia?.("(max-width: 980px)").matches) setRailOpen(false); }}><span>{list.emoji}</span><strong>{list.titulo}</strong></button>)}</div><p>Privado · solo vos podés verlo</p></aside>
    <article className="personal-list-document">
      <div className="personal-list-toolbar"><div className="personal-list-toolbar-start"><button className="personal-list-rail-toggle" type="button" onClick={() => setRailOpen((current) => !current)} aria-expanded={railOpen} aria-controls="personal-list-pages"><span aria-hidden="true">{railOpen ? "‹" : "☰"}</span><strong>{railOpen ? "Ocultar" : "Páginas"}</strong></button><span>Página personal</span></div><div><SavingStatus status={status}/><button type="button" onClick={() => setSaveTemplateOpen(true)}>Guardar plantilla</button><button className="danger" type="button" onClick={deleteList}>Eliminar página</button></div></div>
      {error && <div className="personal-list-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Reintentar</button></div>}
      <div className="personal-list-cover"/><div className="personal-list-content"><div className="personal-emoji-wrap"><button className="personal-list-emoji" type="button" onClick={() => setEmojiOpen((current) => !current)} aria-label="Cambiar emoji">{activeList.emoji}</button>{emojiOpen && <EmojiPicker value={activeList.emoji} onClose={() => setEmojiOpen(false)} onSelect={(emoji) => { setEmojiOpen(false); saveListMeta({ emoji }); }}/>}</div>
        <input className="personal-list-title" value={activeList.titulo} aria-label="Título de la página" onChange={(event) => replaceList(activeList.id, (list) => ({ ...list, titulo: event.target.value }))} onBlur={(event) => saveListMeta({ titulo: event.target.value })}/><p className="personal-list-hint">Combiná bloques y ordenalos como te resulte más cómodo. Todo se guarda automáticamente.</p>
        <div className="personal-editor-blocks">{(activeList.bloques || []).map((block, index) => <BlockEditor key={block.id} block={block} index={index} count={activeList.bloques.length} onChange={(content) => changeBlock(block, content)} onMove={moveBlock} onDelete={deleteBlock}/>)}{!activeList.bloques?.length && <div className="personal-page-empty"><span>Una página en blanco.</span><small>Agregá el primer bloque para empezar.</small></div>}</div><AddBlockMenu onAdd={addBlock}/>
      </div>
    </article>
    {templateOpen && <TemplateDialog templates={templates} creating={creating} onChoose={createList} onClose={() => setTemplateOpen(false)} onDelete={deleteTemplate}/>}
    {saveTemplateOpen && <NameTemplateDialog defaultName={activeList.titulo} onSave={saveAsTemplate} onClose={() => setSaveTemplateOpen(false)} saving={status === "saving"}/>}</main>;
}
