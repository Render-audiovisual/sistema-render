import React, { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "render-publicaciones-preview-v1";

function readPreviewQueue() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePreviewQueue(items) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function dateTimeLabel(date, time) {
  if (!date) return "Sin fecha";
  const parsed = new Date(`${date}T${time || "09:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return `${date} · ${time || "09:00"}`;
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function platformLabel(platforms) {
  if (platforms.instagram && platforms.facebook) return "Instagram + Facebook";
  if (platforms.instagram) return "Instagram";
  if (platforms.facebook) return "Facebook";
  return "Sin plataforma";
}

function emptyDraft(publication, clients) {
  const client = clients.find((item) => item.id === publication?.cliente_id);
  return {
    publicationId: publication?.id || "",
    clientId: publication?.cliente_id || client?.id || clients[0]?.id || "",
    type: publication?.tipo === "video" ? "reel" : publication?.tipo || "reel",
    material: publication?.material_referencia || "",
    caption: publication?.copy || "",
    firstComment: "",
    collaborators: "",
    location: "",
    tags: "",
    date: publication?.fecha_programada || new Date().toISOString().slice(0, 10),
    time: "09:00",
    platforms: { instagram: true, facebook: true },
  };
}

function materialCount(draft) {
  return draft.material.split(/\n+/).map((item) => item.trim()).filter(Boolean).length;
}

function suggestionFor(draft, clients, publications) {
  const client = clients.find((item) => Number(item.id) === Number(draft.clientId));
  const publication = publications.find((item) => Number(item.id) === Number(draft.publicationId));
  const idea = publication?.idea?.trim();
  const subject = idea || (draft.type === "carrusel" ? "este nuevo carrusel" : "este nuevo reel");
  return `${client?.nombre || "Nuestro cliente"} presenta ${subject}.\n\nDescubrí todos los detalles y contanos qué te parece. ✨`;
}

function PublicationPreview({ draft, clients }) {
  const client = clients.find((item) => Number(item.id) === Number(draft.clientId));
  const assets = materialCount(draft);
  return (
    <aside className="publisher-preview" aria-label="Vista previa de la publicación">
      <div className="publisher-preview-head">
        <div className="publisher-avatar">{client?.nombre?.slice(0, 1) || "R"}</div>
        <div><strong>{client?.nombre || "Elegí un cliente"}</strong><span>{platformLabel(draft.platforms)}</span></div>
        <span className="publisher-preview-menu">•••</span>
      </div>
      <div className={`publisher-preview-media is-${draft.type}`}>
        <span aria-hidden="true">{draft.type === "carrusel" ? "▧" : "▶"}</span>
        <strong>{draft.type === "carrusel" ? `${assets || 0} piezas` : "Vista previa del reel"}</strong>
        <small>{draft.material ? "Material listo para validar" : "Agregá el material de Drive"}</small>
      </div>
      <div className="publisher-preview-copy">
        <strong>{client?.nombre || "Cliente"}</strong>
        <p>{draft.caption || "El copy aparecerá acá antes de publicar."}</p>
        {draft.location && <span>⌖ {draft.location}</span>}
      </div>
    </aside>
  );
}

export function PublicationComposer({ publications, clients, canPublish }) {
  const candidates = useMemo(
    () => publications
      .filter((item) => item.estado !== "publicada" && ["video", "reel", "carrusel"].includes(item.tipo))
      .sort((a, b) => String(a.fecha_programada || "").localeCompare(String(b.fecha_programada || ""))),
    [publications],
  );
  const [draft, setDraft] = useState(() => emptyDraft(null, clients));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!draft.clientId && clients.length) setDraft((current) => ({ ...current, clientId: clients[0].id }));
  }, [clients, draft.clientId]);

  const selectPublication = (id) => {
    const publication = candidates.find((item) => Number(item.id) === Number(id));
    setDraft(emptyDraft(publication, clients));
    setNotice("");
  };

  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const setPlatform = (platform, value) => setDraft((current) => ({
    ...current,
    platforms: { ...current.platforms, [platform]: value },
  }));

  const validation = useMemo(() => {
    if (!draft.clientId) return "Elegí un cliente.";
    if (!draft.platforms.instagram && !draft.platforms.facebook) return "Elegí al menos una plataforma.";
    if (!draft.material.trim()) return "Agregá el enlace del material de Drive.";
    if (draft.type === "carrusel" && materialCount(draft) < 2) return "Un carrusel necesita al menos dos piezas.";
    if (!draft.caption.trim()) return "Escribí o generá el copy.";
    if (!draft.date || !draft.time) return "Elegí fecha y hora.";
    return "";
  }, [draft]);

  const simulate = (mode) => {
    if (!canPublish) {
      setNotice("Solo una community manager o un Líder puede preparar envíos.");
      return;
    }
    if (validation) {
      setNotice(validation);
      return;
    }
    const client = clients.find((item) => Number(item.id) === Number(draft.clientId));
    const next = {
      ...draft,
      id: `preview-${Date.now()}`,
      clientName: client?.nombre || "Cliente",
      status: mode === "now" ? "lista_para_publicar" : "programada",
      createdAt: new Date().toISOString(),
      previewOnly: true,
    };
    const queue = [next, ...readPreviewQueue()].slice(0, 40);
    savePreviewQueue(queue);
    window.dispatchEvent(new CustomEvent("render:publication-preview-updated"));
    setNotice(mode === "now"
      ? "Simulación lista. No se envió nada a Meta."
      : "Programación simulada. No se modificó el calendario real.");
  };

  return (
    <section className="publisher-composer" aria-label="Preparar publicación">
      <div className="publisher-mode-banner">
        <span>Prototipo local</span>
        <p>Podés probar todo el recorrido. Ningún botón publica contenido real.</p>
      </div>

      <div className="publisher-layout">
        <div className="publisher-form">
          <div className="publisher-section-head">
            <div><span>Paso 1</span><h3>Elegí qué vas a publicar</h3></div>
            <span className="publisher-access">{canPublish ? "Podés preparar y publicar" : "Vista de consulta"}</span>
          </div>

          <label className="publisher-field publisher-field-wide">
            <span>Publicación planificada</span>
            <select value={draft.publicationId} onChange={(event) => selectPublication(event.target.value)}>
              <option value="">Nueva publicación sin planificación</option>
              {candidates.map((item) => {
                const client = clients.find((candidate) => candidate.id === item.cliente_id);
                return <option key={item.id} value={item.id}>{item.fecha_programada} · {client?.nombre || "Cliente"} · {item.tipo === "carrusel" ? "Carrusel" : "Reel"}</option>;
              })}
            </select>
          </label>

          <div className="publisher-fields-grid">
            <label className="publisher-field"><span>Cliente</span><select value={draft.clientId} onChange={(event) => setField("clientId", Number(event.target.value))}>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}</select></label>
            <label className="publisher-field"><span>Formato</span><select value={draft.type} onChange={(event) => setField("type", event.target.value)}><option value="reel">Reel</option><option value="carrusel">Carrusel</option></select></label>
          </div>

          <label className="publisher-field publisher-field-wide">
            <span>{draft.type === "carrusel" ? "Piezas desde Drive" : "Video desde Drive"}</span>
            <textarea rows={draft.type === "carrusel" ? 4 : 2} value={draft.material} onChange={(event) => setField("material", event.target.value)} placeholder={draft.type === "carrusel" ? "Pegá un enlace por línea, en el orden del carrusel" : "Pegá el enlace del video final"}/>
            <small>{draft.type === "carrusel" ? `${materialCount(draft)} piezas cargadas` : "El servidor validará formato, duración y acceso antes de publicar."}</small>
          </label>

          <div className="publisher-divider" />
          <div className="publisher-section-head"><div><span>Paso 2</span><h3>Prepará el mensaje</h3></div><button type="button" className="publisher-secondary" onClick={() => setField("caption", suggestionFor(draft, clients, publications))}>✦ Proponer con Mía</button></div>
          <label className="publisher-field publisher-field-wide"><span>Copy</span><textarea rows="5" value={draft.caption} onChange={(event) => setField("caption", event.target.value)} placeholder="Escribí el copy o pedile una propuesta a Mía"/><small>{draft.caption.length} caracteres</small></label>
          <label className="publisher-field publisher-field-wide"><span>Primer comentario <em>Opcional</em></span><textarea rows="2" value={draft.firstComment} onChange={(event) => setField("firstComment", event.target.value)} placeholder="Hashtags, información adicional o enlaces"/></label>

          <div className="publisher-divider" />
          <div className="publisher-section-head"><div><span>Paso 3</span><h3>Elegí destino y momento</h3></div></div>
          <div className="publisher-platforms">
            <label className={draft.platforms.instagram ? "active" : ""}><input type="checkbox" checked={draft.platforms.instagram} onChange={(event) => setPlatform("instagram", event.target.checked)}/><span className="platform-icon">◎</span><strong>Instagram</strong><small>Feed profesional</small></label>
            <label className={draft.platforms.facebook ? "active" : ""}><input type="checkbox" checked={draft.platforms.facebook} onChange={(event) => setPlatform("facebook", event.target.checked)}/><span className="platform-icon">f</span><strong>Facebook</strong><small>Página del cliente</small></label>
          </div>
          <div className="publisher-fields-grid">
            <label className="publisher-field"><span>Fecha</span><input type="date" value={draft.date} onChange={(event) => setField("date", event.target.value)}/></label>
            <label className="publisher-field"><span>Hora</span><input type="time" value={draft.time} onChange={(event) => setField("time", event.target.value)}/></label>
            <label className="publisher-field"><span>Colaboradores <em>Opcional</em></span><input value={draft.collaborators} onChange={(event) => setField("collaborators", event.target.value)} placeholder="@usuario, @usuario"/></label>
            <label className="publisher-field"><span>Ubicación <em>Opcional</em></span><input value={draft.location} onChange={(event) => setField("location", event.target.value)} placeholder="Local o ciudad"/></label>
            <label className="publisher-field publisher-field-wide"><span>Etiquetas <em>Opcional</em></span><input value={draft.tags} onChange={(event) => setField("tags", event.target.value)} placeholder="Personas o cuentas para etiquetar"/></label>
          </div>

          {notice && <div className="publisher-notice" role="status">{notice}</div>}
          <div className="publisher-actions">
            <button type="button" className="publisher-secondary" disabled={!canPublish} onClick={() => simulate("schedule")}>Probar programación</button>
            <button type="button" className="publisher-primary" disabled={!canPublish} onClick={() => simulate("now")}>Probar “Publicar ahora”</button>
          </div>
        </div>

        <div className="publisher-sticky-preview">
          <div className="publisher-preview-label"><span>Vista previa</span><small>{dateTimeLabel(draft.date, draft.time)}</small></div>
          <PublicationPreview draft={draft} clients={clients}/>
          <div className="publisher-checklist">
            <strong>Antes de publicar</strong>
            <span className={draft.clientId ? "done" : ""}>Cliente y cuenta</span>
            <span className={draft.material.trim() ? "done" : ""}>Material de Drive</span>
            <span className={draft.caption.trim() ? "done" : ""}>Copy revisado</span>
            <span className={!validation ? "done" : ""}>Configuración completa</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublicationPreviewQueue({ mode }) {
  const [items, setItems] = useState(readPreviewQueue);
  useEffect(() => {
    const refresh = () => setItems(readPreviewQueue());
    window.addEventListener("render:publication-preview-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("render:publication-preview-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const filtered = items.filter((item) => mode === "history" ? item.status === "lista_para_publicar" : item.status === "programada");
  return (
    <section className="publisher-queue">
      <div className="publisher-mode-banner"><span>Prototipo local</span><p>Estos registros son simulaciones guardadas solamente en este navegador.</p></div>
      {filtered.length === 0 ? (
        <div className="publisher-empty"><span>{mode === "history" ? "✓" : "◷"}</span><h3>{mode === "history" ? "Todavía no hay pruebas de publicación" : "Todavía no hay pruebas programadas"}</h3><p>Prepará una publicación para comprobar cómo se verá esta bandeja.</p></div>
      ) : (
        <div className="publisher-queue-list">{filtered.map((item) => <article key={item.id}><div className="publisher-avatar">{item.clientName?.slice(0, 1)}</div><div><strong>{item.clientName}</strong><span>{item.type === "carrusel" ? "Carrusel" : "Reel"} · {platformLabel(item.platforms)}</span></div><time>{dateTimeLabel(item.date, item.time)}</time><b>{mode === "history" ? "Simulada" : "Programada"}</b></article>)}</div>
      )}
    </section>
  );
}
