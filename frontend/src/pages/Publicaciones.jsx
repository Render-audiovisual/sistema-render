import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { etiquetaCortaPublicacion, fechaISODesde, getCheckPublicacionLabel, getEstadoHistoriaLabel, getGrillaMes, getHoyLocalISO, getTipoPublicacionLabel, payloadColumnaPublicacion, sumarDiasISO } from "../utils.jsx";
import { COLUMNAS_PUBLICACION, DIAS_SEMANA, ESTADOS_PUBLICACION, MESES, RESPONSABLES_EQUIPO, TIPOS_PUBLICACION } from "../constants.js";
import { ClientesRail } from "../pages/Historias.jsx";
import { Modal } from "../components/Modal.jsx";

export function PublicacionesCalendarioTab({ onIrAPlanilla }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth());
  const [piezas, setPiezas] = useState([]);
  const [error, setError] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [piezaSel, setPiezaSel] = useState(null);
  const [diaSel, setDiaSel] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((publicaciones) => {
        setPiezas(
          publicaciones.map((p) => ({
            ...p,
            tipoLabel: getTipoPublicacionLabel(p.tipo),
          }))
        );
      })
      .catch((err) => {
        console.error("No se pudo cargar el calendario editorial", err);
        setError("No se pudo cargar el calendario editorial.");
      });
  }, []);

  const piezasFiltradas = useMemo(() => piezas.filter((pz) => {
    if (filtroTipo !== "todos" && pz.tipo !== filtroTipo) return false;
    if (filtroEstado === "pendientes" && pz.estado === "publicada") return false;
    if (
      filtroEstado !== "todos" &&
      filtroEstado !== "pendientes" &&
      pz.estado !== filtroEstado
    ) {
      return false;
    }
    return true;
  }), [piezas, filtroTipo, filtroEstado]);

  const porFecha = useMemo(() => {
    const tmp = {};
    piezasFiltradas.forEach((pz) => {
      if (!pz.fecha_programada) return;
      (tmp[pz.fecha_programada] = tmp[pz.fecha_programada] || []).push(pz);
    });
    Object.values(tmp).forEach((items) => {
      items.sort((a, b) => {
        if (a.estado === b.estado) return a.cliente_nombre.localeCompare(b.cliente_nombre);
        if (a.estado === "publicada") return 1;
        if (b.estado === "publicada") return -1;
        return a.estado.localeCompare(b.estado);
      });
    });
    return tmp;
  }, [piezasFiltradas]);

  const semanas = useMemo(() => getGrillaMes(year, month), [year, month]);
  const hoyISO = getHoyLocalISO();
  const finProximos7 = sumarDiasISO(hoyISO, 7);
  const mesISO = fechaISODesde(year, month, 1).slice(0, 7);

  const estadisticas = useMemo(() => {
    const piezasDelMes = piezas.filter(
      (pz) => pz.fecha_programada?.slice(0, 7) === mesISO,
    );
    const pendientesDelMes = piezasDelMes.filter((pz) => pz.estado !== "publicada");
    const publicadasDelMes = piezasDelMes.filter((pz) => pz.estado === "publicada");
    const pendientesVencidas = piezas.filter(
      (pz) => pz.fecha_programada < hoyISO && pz.estado !== "publicada",
    );
    const pendientesHoy = piezas.filter(
      (pz) => pz.fecha_programada === hoyISO && pz.estado !== "publicada",
    );
    const proximos7 = piezas.filter(
      (pz) =>
        pz.fecha_programada >= hoyISO &&
        pz.fecha_programada <= finProximos7 &&
        pz.estado !== "publicada",
    );
    return { piezasDelMes, pendientesDelMes, publicadasDelMes, pendientesVencidas, pendientesHoy, proximos7 };
  }, [piezas, mesISO, hoyISO, finProximos7]);

  const irMes = useCallback((delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }, [month, year]);

  const FILTROS = useMemo(() => [
    { key: "todos", label: "Todo" },
    { key: "video", label: "Reels" },
    { key: "carrusel", label: "Carruseles" },
  ], []);

  const FILTROS_ESTADO = useMemo(() => [
    { key: "todos", label: "Todos" },
    { key: "pendientes", label: "Pendientes" },
    { key: "publicada", label: "Publicadas" },
    { key: "bloqueada", label: "No publicado / revisar" },
  ], []);

  const cambiarEstadoPublicacion = useCallback(async (publicacion, nuevoEstado) => {
    setGuardandoId(publicacion.id);
    setError(null);
    try {
      const res = await fetch(`/api/publicaciones/${publicacion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      if (!res.ok) throw new Error("No se pudo guardar el check de publicación.");
      const actualizada = await res.json();
      const piezaActualizada = {
        ...publicacion,
        ...actualizada,
        tipoLabel: getTipoPublicacionLabel(actualizada.tipo),
      };
      setPiezas((prev) =>
        prev.map((pz) => (pz.id === publicacion.id ? piezaActualizada : pz)),
      );
      setPiezaSel(piezaActualizada);
      setDiaSel((dia) =>
        dia?.fecha === piezaActualizada.fecha_programada
          ? {
              ...dia,
              items: dia.items.map((pz) =>
                pz.id === piezaActualizada.id ? piezaActualizada : pz,
              ),
            }
          : dia,
      );
    } catch (err) {
      console.error("No se pudo guardar el check de publicación", err);
      setError(err.message);
    } finally {
      setGuardandoId(null);
    }
  }, []);

  const abrirDia = useCallback((fecha, items) => {
    if (!items.length) return;
    setDiaSel({ fecha, items });
  }, []);

  return (
    <>
      <div className="cal-toolbar">
        <div className="cal-monthnav">
          <button
            aria-label="Mes anterior"
            className="btn cal-navbtn"
            type="button"
            onClick={() => irMes(-1)}
          >
            ‹
          </button>
          <span className="cal-title">
            {MESES[month]} {year}
          </span>
          <button
            aria-label="Mes siguiente"
            className="btn cal-navbtn"
            type="button"
            onClick={() => irMes(1)}
          >
            ›
          </button>
        </div>

        <div className="cal-filters" aria-label="Filtros de calendario">
          <label>
            Tipo
            <select
              value={filtroTipo}
              onChange={(event) => setFiltroTipo(event.target.value)}
            >
              {FILTROS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select
              value={filtroEstado}
              onChange={(event) => setFiltroEstado(event.target.value)}
            >
              {FILTROS_ESTADO.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="publication-check-summary">
        <div>
          <strong>{estadisticas.publicadasDelMes.length}</strong>
          <span>Publicadas del mes</span>
        </div>
        <div>
          <strong>{estadisticas.pendientesDelMes.length}</strong>
          <span>Pendientes del mes</span>
        </div>
        <div className={estadisticas.pendientesVencidas.length ? "alert" : ""}>
          <strong>{estadisticas.pendientesVencidas.length}</strong>
          <span>Vencidas sin check</span>
        </div>
        <div>
          <strong>{estadisticas.pendientesHoy.length}</strong>
          <span>Para publicar hoy</span>
        </div>
        <div>
          <strong>{estadisticas.proximos7.length}</strong>
          <span>Próximos 7 días</span>
        </div>
      </div>

      {error && <div className="caption">{error}</div>}

      <div className="cal-grid">
        {DIAS_SEMANA.map((dia) => (
          <div className="cal-dow" key={dia}>
            {dia}
          </div>
        ))}
        {semanas.map((semana, si) =>
          semana.map((dia, di) => {
            if (dia === null) {
              return (
                <div className="cal-cell empty" key={`${si}-${di}`}></div>
              );
            }
            const iso = fechaISODesde(year, month, dia);
            const items = porFecha[iso] || [];
            const visibles = items.slice(0, 3);
            const ocultos = Math.max(items.length - visibles.length, 0);
            return (
              <div
                className={`cal-cell ${iso === hoyISO ? "today" : ""} ${items.length ? "has-items" : ""}`}
                key={`${si}-${di}`}
                onClick={() => abrirDia(iso, items)}
              >
                <div className="cal-cell-head">
                  <span className="cal-daynum">{dia}</span>
                  {items.length > 0 && <span className="cal-count">{items.length}</span>}
                </div>
                <div className="cal-chip-stack">
                  {visibles.map((pz) => (
                    <div
                      className={`cal-chip ${pz.estado}`}
                      key={pz.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPiezaSel(pz);
                      }}
                      title={`${pz.tipoLabel} · ${pz.cliente_nombre} · ${getEstadoHistoriaLabel(
                        pz.estado,
                      )}`}
                    >
                      {etiquetaCortaPublicacion(pz)}
                    </div>
                  ))}
                  {ocultos > 0 && (
                    <button
                      className="cal-more"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        abrirDia(iso, items);
                      }}
                    >
                      +{ocultos} más
                    </button>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <div className="cal-legend">
        <span className="lg-pend">Pendiente / en diseño</span>
        <span className="lg-rev">En revisión</span>
        <span className="lg-bloq">Bloqueada</span>
        <span className="lg-pub">Publicada</span>
      </div>
      <div className="caption">
        Cada casilla muestra un resumen limpio. Tocá una fecha para ver todas
        las publicaciones del día y marcar el check correspondiente.
      </div>

      {diaSel && (
        <Modal
          onClose={() => setDiaSel(null)}
          title={<span>Publicaciones del {diaSel.fecha}</span>}
          className="day-modal"
        >
            <div className="modal-body">
              <div className="day-publication-list">
                {diaSel.items.map((pz) => (
                  <button
                    className={`day-publication-row ${pz.estado}`}
                    key={pz.id}
                    type="button"
                    onClick={() => setPiezaSel(pz)}
                  >
                    <span className="day-publication-main">
                      <strong>{pz.cliente_nombre}</strong>
                      <span>{pz.tipoLabel} · {getCheckPublicacionLabel(pz.estado)}</span>
                    </span>
                    <span className="day-publication-badge">
                      {pz.estado === "publicada" ? "✓" : pz.tipo === "carrusel" ? "C" : "V"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
        </Modal>
      )}

      {piezaSel && (
        <Modal
          onClose={() => setPiezaSel(null)}
          title={
            <span>
              {piezaSel.cliente_nombre} · {piezaSel.idea || "Sin idea cargada"}
            </span>
          }
        >
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-label">Tipo</div>
                  <div>{piezaSel.tipoLabel}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Estado</div>
                  <div>{getEstadoHistoriaLabel(piezaSel.estado)}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Check publicación</div>
                  <div>
                    {getCheckPublicacionLabel(piezaSel.estado)}
                  </div>
                </div>
                {piezaSel.fecha_publicación_real && (
                  <div className="detail-field">
                    <div className="detail-label">Marcada publicada</div>
                    <div>{piezaSel.fecha_publicación_real}</div>
                  </div>
                )}
                <div className="detail-field">
                  <div className="detail-label">Fecha programada</div>
                  <div>{piezaSel.fecha_programada}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-label">Responsable</div>
                  <div>{piezaSel.responsable || "—"}</div>
                </div>
                {piezaSel.copy && (
                  <div className="detail-field">
                    <div className="detail-label">Copy</div>
                    <div>{piezaSel.copy}</div>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "publicada"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "publicada")}
                >
                  {guardandoId === piezaSel.id ? "Guardando..." : "Marcar publicado"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "lista"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "lista")}
                >
                  Volver a pendiente
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={guardandoId === piezaSel.id || piezaSel.estado === "bloqueada"}
                  onClick={() => cambiarEstadoPublicacion(piezaSel, "bloqueada")}
                >
                  No publicado / revisar
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    onIrAPlanilla(piezaSel.cliente_id);
                    setPiezaSel(null);
                  }}
                >
                  Editar en la planilla →
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  );
}

export function PublicacionesGeneralTab({ clientes, onIrACliente }) {
  const [publicaciones, setPublicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtroCliente, setFiltroCliente] = useState("todos");
  const [filtroMes, setFiltroMes] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => {
        setPublicaciones(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando publicaciones", err);
        setError("No se pudieron cargar las publicaciones.");
      })
      .finally(() => setCargando(false));
  }, []);

  const mesesDisponibles = [
    ...new Set(publicaciones.map((p) => p.fecha_programada?.slice(0, 7)).filter(Boolean)),
  ].sort();

  const responsablesDisponibles = [
    ...new Set(publicaciones.map((p) => p.responsable).filter(Boolean)),
  ].sort();

  const filtradas = publicaciones.filter((p) => {
    if (filtroCliente !== "todos" && p.cliente_id !== Number(filtroCliente)) return false;
    if (filtroMes !== "todos" && !p.fecha_programada?.startsWith(filtroMes)) return false;
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (filtroResponsable !== "todos" && p.responsable !== filtroResponsable) return false;
    if (filtroTipo !== "todos" && p.tipo !== filtroTipo) return false;
    return true;
  });

  const selectStyle = { fontSize: "12px", padding: "6px 8px" };

  return (
    <>
      <div className="section-label">Control de publicaciones</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        <select style={selectStyle} value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
          <option value="todos">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <select style={selectStyle} value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
          <option value="todos">Todos los meses</option>
          {mesesDisponibles.map((m) => (
            <option key={m} value={m}>
              {MESES[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todos">Todos los estados</option>
          {ESTADOS_PUBLICACION.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <select style={selectStyle} value={filtroResponsable} onChange={(e) => setFiltroResponsable(e.target.value)}>
          <option value="todos">Todos los responsables</option>
          {responsablesDisponibles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select style={selectStyle} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {TIPOS_PUBLICACION.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <span style={{ fontSize: "12px", color: "#777", alignSelf: "center", marginLeft: "auto" }}>
          {filtradas.length} publicaciones
        </span>
      </div>

      {error && (
        <div className="alert is-error">{error}</div>
      )}

      {cargando ? (
        <div className="state-empty">Cargando publicaciones…</div>
      ) : (
        <div className="box" style={{ padding: 0, overflow: "auto", maxHeight: "70vh" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "100px" }}>Fecha</th>
                <th style={{ width: "180px" }}>Cliente</th>
                <th style={{ width: "90px" }}>Tipo</th>
                <th>Idea</th>
                <th style={{ width: "120px" }}>Responsable</th>
                <th style={{ width: "120px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin publicaciones para estos filtros.
                  </td>
                </tr>
              )}
              {filtradas.map((p) => {
                const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado) || ESTADOS_PUBLICACION[0];
                return (
                  <tr
                    key={p.id}
                    className="row-clickable"
                    onClick={() => onIrACliente(p.cliente_id)}
                    title="Ver la planilla de este cliente"
                  >
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{p.fecha_programada}</td>
                    <td style={{ padding: "6px 10px", fontSize: "13px", fontWeight: "600" }}>{p.cliente_nombre}</td>
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{getTipoPublicacionLabel(p.tipo)}</td>
                    <td style={{ padding: "6px 10px", fontSize: "13px", color: p.idea ? "#222" : "#bbb" }}>
                      {p.idea || "Sin idea cargada"}
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: "12px" }}>{p.responsable || "—"}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ background: est.bg, color: est.fg, fontWeight: "600", fontSize: "11px", padding: "3px 8px", borderRadius: "10px" }}>
                        {est.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PublicacionesPlanillaTab({ clienteId, clienteNombre, year, month }) {
  const [publicaciones, setPublicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const gridRef = useRef(null);
  const enfocarProximoId = useRef(null);

  const cargar = () => {
    setCargando(true);
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => {
        setPublicaciones(data.filter((p) => p.cliente_id === clienteId));
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando publicaciones", err);
        setError("No se pudieron cargar las publicaciones.");
      })
      .finally(() => setCargando(false));
  };

  useEffect(cargar, [clienteId]);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const filasVisibles = publicaciones
    .filter((p) => p.fecha_programada && p.fecha_programada.startsWith(mesPrefix))
    .slice()
    .sort((a, b) => a.fecha_programada.localeCompare(b.fecha_programada));

  useEffect(() => {
    if (!enfocarProximoId.current) return;
    const idx = filasVisibles.findIndex((p) => p.id === enfocarProximoId.current);
    if (idx === -1) return;
    enfocarProximoId.current = null;
    requestAnimationFrame(() => enfocarCelda(idx, "fecha"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicaciones]);

  const actualizarLocal = (id, campos) => {
    setPublicaciones((prev) => prev.map((p) => (p.id === id ? { ...p, ...campos } : p)));
  };

  const guardarEnServidor = async (id, campos) => {
    try {
      const res = await fetch(`/api/publicaciones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
    } catch (err) {
      console.error("Error guardando", err);
      setError("No se pudo guardar un cambio — reintentá.");
    }
  };

  const confirmarCampoTexto = (id, campos) => {
    actualizarLocal(id, campos);
    guardarEnServidor(id, campos);
  };

  const crearPublicacion = async () => {
    const iso = mesPrefix === hoyISO.slice(0, 7) ? hoyISO : `${mesPrefix}-01`;
    try {
      const res = await fetch("/api/piezas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "video",
          cliente_id: clienteId,
          responsable: "Augusto",
          fecha_programada: iso,
          estado: "pendiente",
          idea: "",
        }),
      });
      if (!res.ok) throw new Error("No se pudo crear");
      const creada = await res.json();
      enfocarProximoId.current = creada.id;
      cargar();
    } catch (err) {
      console.error("Error creando publicación", err);
      setError("No se pudo crear la publicación.");
    }
  };

  const borrarPublicacion = async (id) => {
    if (!window.confirm("¿Eliminar esta publicación de la planilla?")) return;
    try {
      const res = await fetch(`/api/publicaciones/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setPublicaciones((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Error eliminando publicación", err);
      setError("No se pudo eliminar la publicación.");
    }
  };

  const copiarFila = async (p) => {
    const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado);
    const linea = [
      p.fecha_programada || "",
      getTipoPublicacionLabel(p.tipo),
      p.idea || "",
      p.copy || "",
      p.material_referencia || "",
      p.aclaraciones || "",
      p.responsable || "",
      est?.label || p.estado || "",
    ].join("\t");
    try {
      await navigator.clipboard.writeText(linea);
    } catch (err) {
      console.error("No se pudo copiar la fila", err);
    }
  };

  const enfocarCelda = (rowIndex, columna) => {
    const el = gridRef.current?.querySelector(`[data-cell="${rowIndex}:${columna}"]`);
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  };

  const manejarEnterOTab = (e, rowIndex, columna) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      enfocarCelda(rowIndex + 1, columna);
    }
  };

  const manejarPaste = (e, rowIndex, columna) => {
    const texto = e.clipboardData.getData("text/plain");
    if (!texto.includes("\t") && !texto.includes("\n")) return;
    e.preventDefault();

    const filasTexto = texto.replace(/\r/g, "").split("\n");
    while (filasTexto.length > 1 && filasTexto[filasTexto.length - 1] === "") {
      filasTexto.pop();
    }

    const colInicio = COLUMNAS_PUBLICACION.indexOf(columna);

    filasTexto.forEach((filaTexto, dRow) => {
      const objetivo = filasVisibles[rowIndex + dRow];
      if (!objetivo) return;

      const valores = filaTexto.split("\t");
      let payload = {};
      valores.forEach((valorCelda, dCol) => {
        const colObjetivo = COLUMNAS_PUBLICACION[colInicio + dCol];
        if (!colObjetivo) return;
        const campo = payloadColumnaPublicacion(colObjetivo, valorCelda);
        if (!campo) return;
        payload = { ...payload, ...campo };
      });

      if (Object.keys(payload).length > 0) {
        actualizarLocal(objetivo.id, payload);
        guardarEnServidor(objetivo.id, payload);
      }
    });
  };

  return (
    <>
      {error && (
        <div className="alert is-error">{error}</div>
      )}

      {cargando ? (
        <div className="state-empty">Cargando planilla…</div>
      ) : (
        <div className="sheet-frame" ref={gridRef}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{ width: "56px" }}>Día</th>
                <th style={{ width: "120px" }}>Fecha</th>
                <th style={{ width: "100px" }}>Tipo</th>
                <th style={{ width: "20%" }}>Idea</th>
                <th style={{ width: "24%" }}>Copy</th>
                <th style={{ width: "14%" }}>Material</th>
                <th style={{ width: "16%" }}>Observaciones</th>
                <th style={{ width: "110px" }}>Responsable</th>
                <th style={{ width: "120px" }}>Estado</th>
                <th style={{ width: "56px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "24px", color: "#999" }}>
                    Sin publicaciones planificadas este mes todavía.
                  </td>
                </tr>
              )}
              {filasVisibles.map((p, rowIndex) => {
                const fecha = new Date(`${p.fecha_programada}T00:00:00`);
                const dow = fecha.getDay();
                const esFinde = dow === 0 || dow === 6;
                const esHoy = p.fecha_programada === hoyISO;
                const est = ESTADOS_PUBLICACION.find((e) => e.id === p.estado) || ESTADOS_PUBLICACION[0];
                const bgFila = esHoy ? "#e3f2fd" : esFinde ? "#fafafa" : undefined;

                return (
                  <tr key={p.id} style={{ background: bgFila }}>
                    <td style={{ padding: "6px 10px", fontWeight: esHoy ? "700" : "600", color: esFinde ? "#999" : "#333", fontSize: "12px" }}>
                      {LETRAS_DIA[dow]}
                    </td>
                    <td>
                      <input
                        type="date"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:fecha`}
                        value={p.fecha_programada || ""}
                        onChange={(e) => actualizarLocal(p.id, { fecha_programada: e.target.value })}
                        onBlur={(e) => guardarEnServidor(p.id, { fecha_programada: e.target.value })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "fecha")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "fecha")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:tipo`}
                        value={p.tipo}
                        onChange={(e) => {
                          actualizarLocal(p.id, { tipo: e.target.value });
                          guardarEnServidor(p.id, { tipo: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "tipo")}
                      >
                        {TIPOS_PUBLICACION.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:idea`}
                        placeholder="Escribir idea…"
                        value={p.idea || ""}
                        onChange={(e) => actualizarLocal(p.id, { idea: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { idea: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "idea")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "idea")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:copy`}
                        placeholder="Escribir copy…"
                        value={p.copy || ""}
                        onChange={(e) => actualizarLocal(p.id, { copy: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { copy: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "copy")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "copy")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:material`}
                        placeholder="Link…"
                        value={p.material_referencia || ""}
                        onChange={(e) => actualizarLocal(p.id, { material_referencia: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { material_referencia: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "material")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "material")}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:aclaraciones`}
                        placeholder="—"
                        value={p.aclaraciones || ""}
                        onChange={(e) => actualizarLocal(p.id, { aclaraciones: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(p.id, { aclaraciones: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "aclaraciones")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "aclaraciones")}
                      />
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:responsable`}
                        value={p.responsable || "Augusto"}
                        onChange={(e) => {
                          actualizarLocal(p.id, { responsable: e.target.value });
                          guardarEnServidor(p.id, { responsable: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "responsable")}
                      >
                        {RESPONSABLES_EQUIPO.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:estado`}
                        value={p.estado}
                        onChange={(e) => {
                          actualizarLocal(p.id, { estado: e.target.value });
                          guardarEnServidor(p.id, { estado: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "estado")}
                        style={{ background: est.bg, color: est.fg, fontWeight: "600", border: "1px solid transparent" }}
                      >
                        {ESTADOS_PUBLICACION.map((e) => (
                          <option key={e.id} value={e.id}>{e.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="sheet-row-actions">
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => copiarFila(p)}
                          title="Copiar fila (para pegar en otra fila o en Sheets)"
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => borrarPublicacion(p.id)}
                          title="Eliminar"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={10} style={{ padding: 0 }}>
                  <button type="button" className="sheet-add-row" onClick={crearPublicacion}>
                    <span style={{ fontSize: "15px" }}>+</span> Agregar publicación
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="caption" style={{ marginTop: "10px" }}>
        Planilla de {clienteNombre} · Click en una celda para escribir · Tab / Enter para moverte · pegá bloques copiados de Sheets directamente sobre la grilla.
      </div>
    </>
  );
}

export function PublicacionesPage({ tabInicial = "calendario" }) {
  const [tabPrincipal, setTabPrincipal] = useState(tabInicial);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [errorClientes, setErrorClientes] = useState(null);
  const [publicaciones, setPublicaciones] = useState([]);

  const hoyDate = new Date();
  const [year, setYear] = useState(hoyDate.getFullYear());
  const [month, setMonth] = useState(hoyDate.getMonth());

  useEffect(() => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((data) => {
        setClientes(data);
        if (data.length > 0) setClienteSeleccionado((prev) => prev ?? data[0].id);
      })
      .catch((err) => {
        console.error("No se pudieron cargar clientes", err);
        setErrorClientes("No se pudieron cargar los clientes.");
      });
  }, []);

  // Solo para alimentar el punto rojo del panel lateral (quién tiene
  // publicaciones atrasadas) sin entrar a cada cliente — la grilla editable
  // de cada cliente sigue trayendo sus propios datos por separado.
  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => setPublicaciones(Array.isArray(data) ? data : []))
      .catch((err) => console.error("No se pudo cargar el panorama de publicaciones", err));
  }, []);

  const irAPlanillaDeCliente = (clienteId) => {
    setClienteSeleccionado(clienteId);
    setTabPrincipal("planilla");
  };

  const clienteActual = clientes.find((c) => c.id === clienteSeleccionado);
  const clienteNombre = clienteActual?.nombre || "";

  const hoyISO = getHoyLocalISO();
  const atrasadasPorCliente = {};
  publicaciones.forEach((p) => {
    if (p.fecha_programada < hoyISO && p.estado !== "publicada") {
      atrasadasPorCliente[p.cliente_id] = (atrasadasPorCliente[p.cliente_id] || 0) + 1;
    }
  });

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };
  const irAHoy = () => {
    setMonth(hoyDate.getMonth());
    setYear(hoyDate.getFullYear());
  };

  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const publicacionesClienteMes = publicaciones.filter(
    (p) => p.cliente_id === clienteSeleccionado && p.fecha_programada?.startsWith(mesPrefix),
  );
  const publicadasCliente = publicacionesClienteMes.filter((p) => p.estado === "publicada").length;
  const atrasadasCliente = publicacionesClienteMes.filter(
    (p) => p.fecha_programada < hoyISO && p.estado !== "publicada",
  ).length;

  const TABS_PRINCIPALES = [
    { id: "calendario", label: "Calendario" },
    { id: "lista", label: "Control" },
    { id: "planilla", label: "Planilla" },
  ];

  return (
    <main aria-label="Render platform publicaciones" className="publicaciones-viewport">
      <div className="frame">
        <div className="content">
          {errorClientes && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {errorClientes}
            </div>
          )}

          <div className="h-workspace">
            <ClientesRail
              clientes={clientes}
              clienteSeleccionado={clienteSeleccionado}
              onSeleccionar={irAPlanillaDeCliente}
              atrasadasPorCliente={atrasadasPorCliente}
            />

            <div className="h-main">
              <div className="h-toolbar">
                {tabPrincipal === "planilla" && (
                  <div className="h-toolbar-client">{clienteNombre || "…"}</div>
                )}
                {tabPrincipal === "planilla" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button className="btn" type="button" onClick={() => irMes(-1)}>◀</button>
                    <strong className="sheet-title">{MESES[month]} {year}</strong>
                    <button className="btn" type="button" onClick={() => irMes(1)}>▶</button>
                  </div>
                )}
                {tabPrincipal === "planilla" && (
                  <button className="h-today-btn" type="button" onClick={irAHoy}>Ir a hoy</button>
                )}

                <div className="sheet-view-tabs" style={{ margin: 0 }}>
                  {TABS_PRINCIPALES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={tabPrincipal === t.id ? "active" : ""}
                      onClick={() => setTabPrincipal(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tabPrincipal === "planilla" && (
                  <div className="sheet-stats" style={{ marginLeft: "auto" }}>
                    <span>{publicacionesClienteMes.length} publicaciones</span>
                    <span className="ok">{publicadasCliente} publicadas</span>
                    {atrasadasCliente > 0 && <span className="danger">{atrasadasCliente} atrasadas</span>}
                  </div>
                )}
              </div>

              <div className="h-body">
                {tabPrincipal === "calendario" && (
                  <PublicacionesCalendarioTab onIrAPlanilla={irAPlanillaDeCliente} />
                )}

                {tabPrincipal === "lista" && (
                  <PublicacionesGeneralTab clientes={clientes} onIrACliente={irAPlanillaDeCliente} />
                )}

                {tabPrincipal === "planilla" && clienteActual && (
                  <PublicacionesPlanillaTab
                    key={`pub-${clienteSeleccionado}`}
                    clienteId={clienteSeleccionado}
                    clienteNombre={clienteNombre}
                    year={year}
                    month={month}
                  />
                )}

                {tabPrincipal === "planilla" && !clienteActual && (
                  <div className="state-empty">
                    Elegí un cliente en el panel izquierdo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
