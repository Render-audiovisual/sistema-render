import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { PRIORIDADES_TAREA, RESPONSABLES, SECTORES_TAREA } from "../constants.js";

export function NuevaTareaPage() {
  const [clientes, setClientes] = useState([]);
  const [titulo, setTitulo] = useState("");
  const [asignadoA, setAsignadoA] = useState("Augusto");
  const [clienteId, setClienteId] = useState("");
  const [estado, setEstado] = useState("pendiente");
  const [sector, setSector] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [prioridad, setPrioridad] = useState("media");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [requiereAprobacion, setRequiereAprobacion] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch("/api/clientes")
      .then((response) => response.json())
      .then(setClientes)
      .catch(() => setError("No se pudieron cargar los clientes."));
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    setMensaje(null);
    setError(null);
    setEnviando(true);

    fetch("/api/tareas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo,
        asignado_a: asignadoA,
        cliente_id: clienteId ? Number(clienteId) : null,
        estado,
        tipo_tarea: sector || null,
        subtipo: subtipo || null,
        prioridad,
        requiere_aprobacion: requiereAprobacion,
        fecha_vencimiento: fechaVencimiento || null,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudo crear la tarea.");
        }
        return data;
      })
      .then((data) => {
        setMensaje(`Tarea creada: "${data.titulo}" asignada a ${data.asignado_a}.`);
        setTitulo("");
        setClienteId("");
        setEstado("pendiente");
        setSector("");
        setSubtipo("");
        setPrioridad("media");
        setFechaVencimiento("");
        setRequiereAprobacion(false);
      })
      .catch((err) => setError(err.message))
      .finally(() => setEnviando(false));
  };

  return (
    <main aria-label="Render platform nueva tarea">
      <div className="frame">
        <div className="content">
          <div className="section-label">Cargar tarea y asignar responsable</div>
          <div className="box">
            <form onSubmit={handleSubmit}>
              <div className="form-section-title">Qué hay que hacer</div>
              <div className="form-grid">
                <label className="form-field">
                  <span>Título de la tarea *</span>
                  <input
                    type="text"
                    value={titulo}
                    placeholder="Ej: Reel testimonio cliente"
                    onChange={(e) => setTitulo(e.target.value)}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Cliente</span>
                  <select
                    value={clienteId}
                    onChange={(e) => setClienteId(e.target.value)}
                  >
                    <option value="">Sin cliente asociado</option>
                    {clientes.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {cliente.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Sector</span>
                  <select value={sector} onChange={(e) => setSector(e.target.value)}>
                    <option value="">Sin sector</option>
                    {SECTORES_TAREA.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Subtipo</span>
                  <input
                    type="text"
                    value={subtipo}
                    placeholder="reel, historia, carrusel, visita…"
                    onChange={(e) => setSubtipo(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-section-title">Asignación y plazo</div>
              <div className="form-grid cols-2">
                <label className="form-field">
                  <span>Responsable *</span>
                  <select
                    value={asignadoA}
                    onChange={(e) => setAsignadoA(e.target.value)}
                  >
                    {RESPONSABLES.map((nombre) => (
                      <option key={nombre} value={nombre}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Vence el</span>
                  <input
                    type="date"
                    value={fechaVencimiento}
                    onChange={(e) => setFechaVencimiento(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>Estado inicial</span>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="en_progreso">En proceso</option>
                    <option value="en_revision">En revisión</option>
                    <option value="publicada">Publicada</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Prioridad</span>
                  <select
                    value={prioridad}
                    onChange={(e) => setPrioridad(e.target.value)}
                  >
                    {PRIORIDADES_TAREA.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label
                  className="form-field"
                  style={{ flexDirection: "row", alignItems: "center", gap: "8px", marginTop: "18px" }}
                >
                  <input
                    type="checkbox"
                    checked={requiereAprobacion}
                    onChange={(e) => setRequiereAprobacion(e.target.checked)}
                  />
                  <span style={{ textTransform: "none" }}>
                    Requiere aprobación del Líder
                  </span>
                </label>
              </div>

              {error && <div className="caption login-error">{error}</div>}
              {mensaje && (
                <div className="caption" style={{ color: "#333", fontWeight: "bold" }}>
                  {mensaje}
                </div>
              )}

              <div style={{ marginTop: "14px" }}>
                <button className="btn primary" type="submit" disabled={enviando}>
                  {enviando ? "Creando..." : "Crear tarea"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
