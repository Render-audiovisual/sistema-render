import React, { useEffect, useState } from "react";

export function CargaAgostoPage() {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const loadPreview = () => {
    setLoading(true);
    fetch("/api/planificacion-agosto-2026")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo revisar el plan.");
        return body;
      })
      .then(setPreview)
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  };

  useEffect(loadPreview, []);

  const execute = () => {
    setExecuting(true);
    setError("");
    fetch("/api/planificacion-agosto-2026", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmacion: "CARGAR_AGOSTO_2026" }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo ejecutar la carga.");
        return body;
      })
      .then((body) => { setResult(body); loadPreview(); })
      .catch((reason) => setError(reason.message))
      .finally(() => setExecuting(false));
  };

  return <main aria-label="Carga controlada de agosto"><div className="frame"><div className="content august-import-page">
    <div className="section-label">Herramienta temporal · Solo Líder</div>
    <h2>Plan de publicaciones · Agosto 2026</h2>
    <p>Vista previa protegida. La carga conserva lo existente y crea únicamente las piezas faltantes.</p>
    {loading && <div className="august-import-state">Revisando publicaciones existentes…</div>}
    {error && <div className="august-import-state is-error">{error}</div>}
    {preview && <>
      <div className="august-import-summary">
        <div><span>Plan total</span><strong>{preview.summary.total}</strong></div>
        <div><span>Reels faltantes</span><strong>{preview.missing.videos}</strong></div>
        <div><span>Carruseles faltantes</span><strong>{preview.missing.carousels}</strong></div>
        <div><span>Por crear</span><strong>{preview.missing.total}</strong></div>
      </div>
      <div className="august-import-checks"><span>✓ Lunes a sábado</span><span>✓ Máximo {preview.summary.maxPerDay} piezas por día</span><span>✓ EOS y Joyería excluidos</span><span>✓ Todo comienza pendiente</span></div>
      {result ? <div className="august-import-success"><strong>Carga completada</strong><span>{result.created} publicaciones y {result.created} tareas creadas.</span></div> : <button className="btn primary august-import-action" type="button" onClick={execute} disabled={executing || preview.missing.total === 0}>{executing ? "Cargando…" : `Crear ${preview.missing.total} publicaciones y tareas`}</button>}
      <div className="august-import-table"><div><b>Fecha</b><b>Cliente</b><b>Pieza</b><b>Responsable</b></div>{preview.rows.slice(0, 30).map((row) => <div key={`${row.clientId}-${row.type}-${row.number}`}><span>{row.date}</span><span>{row.client}</span><span>{row.label}</span><span>{row.assignee}</span></div>)}</div>
      {preview.rows.length > 30 && <small>Vista resumida: se muestran 30 de {preview.rows.length} filas.</small>}
    </>}
  </div></div></main>;
}
