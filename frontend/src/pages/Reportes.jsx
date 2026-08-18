import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getEstadoTareaLabel, getHoyLocalISO, getSesion } from "../utils.jsx";
import { ROL_LABELS, ESTADO_FINAL_TAREA } from "../constants.js";
import { pushUrlContext, readUrlContext, replaceUrlContext } from "../shared/navigation/url-context.js";
import { belongsToPerson, filterItemsByPeriod, filterRenderOsTasksByPeriod, formatPeriodDeadline, getDesignerCarouselTaskSummary, getReportPeriodRange, isCarouselTask, isEditingTask, mergeReportTaskSources, summarizeTaskDeliveries } from "../shared/reports/report-utils.js";
import { groupProductionByClient } from "../features/render-os/utils/production-visits.js";

export function ResumenEntregableEquipo({
  etiqueta,
  realizados,
  pendientes,
  total,
  verbo = "realizados",
  verboSingular = "realizado",
  enRevision = false,
}) {
  if (enRevision) {
    return (
      <div style={{ paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--text)" }}>{etiqueta}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginTop: "10px" }}>
          <div style={{ fontSize: "12px", color: "var(--muted)" }}>
            Objetivo mensual: <strong style={{ color: "var(--text)", fontSize: "18px", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontVariantNumeric: "tabular-nums" }}>{total}</strong>
          </div>
          <span style={{ padding: "3px 9px", borderRadius: "999px", background: "#f6e9d8", color: "var(--warning)", fontSize: "11px", fontWeight: "500" }}>
            En revisión
          </span>
        </div>
        <div style={{ marginTop: "9px", fontSize: "12px", lineHeight: 1.5, color: "var(--muted)" }}>
          El avance se confirmará cuando quede validada la trazabilidad del material.
        </div>
      </div>
    );
  }
  const porcentaje = total > 0 ? Math.round((realizados / total) * 100) : 0;
  const colorBarra = porcentaje >= 80 ? "var(--success)" : porcentaje >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <div className="report-metric" style={{ paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--text)" }}>{etiqueta}</div>
        <div style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
          <strong style={{ color: "var(--text)", fontSize: "16px", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontVariantNumeric: "tabular-nums" }}>{realizados}</strong> de {total}
        </div>
      </div>
      <div className="report-progress-bar">
        <div
          className="report-progress-fill"
          style={{
            width: `${Math.min(porcentaje, 100)}%`,
            background: colorBarra,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", color: "var(--muted)" }}>
        <span>{realizados} {realizados === 1 ? verboSingular : verbo}</span>
        <span>{pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}</span>
        <strong style={{ color: "var(--muted)", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontVariantNumeric: "tabular-nums" }}>{porcentaje}%</strong>
      </div>
    </div>
  );
}

export function TarjetaEntregablesEquipo({ nombre, rol, metricas = [], proximoMes = false, fechaLimite = "" }) {
  const inicial = (nombre || "?").trim().charAt(0).toUpperCase();
  return (
    <article
      className="report-employee-card"
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "16px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              background: "var(--surface-soft)",
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: "600",
              flexShrink: 0,
            }}
          >
            {inicial}
          </div>
          <div>
            <div style={{ fontWeight: "600", fontSize: "14px", color: "var(--text)" }}>{nombre}</div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "1px", textTransform: "uppercase", letterSpacing: "0.03em" }}>{rol}</div>
          </div>
        </div>
        {proximoMes && (
          <span style={{ padding: "4px 9px", borderRadius: "999px", background: "#eef2ff", color: "#3949ab", fontSize: "11px", fontWeight: "500" }}>
            Comienza el próximo mes
          </span>
        )}
      </div>
      {proximoMes ? (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", color: "var(--muted)", fontSize: "12px", lineHeight: 1.5 }}>
          Carruseles e historias medidas a partir de agosto.
        </div>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {metricas.map((metrica) => (
            <ResumenEntregableEquipo key={metrica.etiqueta} {...metrica} />
          ))}
        </div>
      )}
    </article>
  );
}

function TarjetaFilmacionesGerman({ clientes, fechaLimite = "" }) {
  const totalGrabados = clientes.reduce((sum, item) => sum + item.grabados, 0);
  const totalPlanificados = clientes.reduce((sum, item) => sum + item.objetivo, 0);
  const totalPendientes = Math.max(totalPlanificados - totalGrabados, 0);
  const porcentaje = totalPlanificados > 0 ? Math.round((totalGrabados / totalPlanificados) * 100) : 0;
  return (
    <article className="report-employee-card report-filmmaker-card">
      <header className="report-filmmaker-header">
        <span className="report-employee-avatar">G</span>
        <div><strong>Germán</strong><small>Filmmaker · Producción audiovisual</small></div>
      </header>
      <div className="report-filmmaker-total">
        <strong>{totalGrabados}</strong>
        <div><span>videos grabados</span><small>{totalPendientes} pendientes · {totalPlanificados} objetivo · {porcentaje}%</small></div>
      </div>
      <details className="report-filmmaker-locations">
        <summary className="report-filmmaker-label">Ver grabaciones por cliente</summary>
        {clientes.length > 0 ? clientes.map((cliente) => (
          <div className="report-filmmaker-location" key={cliente.nombre}>
            <span>{cliente.nombre}</span>
            <div><strong>{cliente.grabados} / {cliente.objetivo}</strong><small>videos</small>{cliente.pendientes > 0 && <b>{cliente.pendientes} pendientes</b>}</div>
          </div>
        )) : <p>No hay filmaciones registradas para este período.</p>}
      </details>
    </article>
  );
}

export function ReportesEquipoPage() {
  const sesion = getSesion();
  const usuarioSesion = sesion?.usuario;
  const esVistaAdmin = usuarioSesion?.rol === "admin";
  const nombrePropio = usuarioSesion?.nombre;
  const [tareas, setTareas] = useState([]);
  const [tareasRenderOs, setTareasRenderOs] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [resumenRenderOsPorDia, setResumenRenderOsPorDia] = useState({});
  const initialPeriod = readUrlContext(window.location.search, { periodo: "mes_actual" }).periodo;
  const [periodo, setPeriodo] = useState(
    ["mes_actual", "mes_pasado", "ultimos_30"].includes(initialPeriod) ? initialPeriod : "mes_actual",
  );
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [detalleDe, setDetalleDe] = useState(null);

  useEffect(() => replaceUrlContext({ periodo }), [periodo]);
  useEffect(() => {
    const restorePeriod = () => {
      const value = readUrlContext(window.location.search, { periodo: "mes_actual" }).periodo;
      setPeriodo(["mes_actual", "mes_pasado", "ultimos_30"].includes(value) ? value : "mes_actual");
    };
    window.addEventListener("popstate", restorePeriod);
    return () => window.removeEventListener("popstate", restorePeriod);
  }, []);

  useEffect(() => {
    let active = true;
    let loading = false;

    const cargarReporte = (silencioso = false) => {
      if (loading) return;
      loading = true;
      if (!silencioso) setCargando(true);
      const rango = getReportPeriodRange(periodo, new Date());
      const mesConfiguracion = periodo === "mes_pasado"
        ? rango.desde.slice(0, 7)
        : getHoyLocalISO().slice(0, 7);
      fetch(`/api/reportes/datos?mes_configuracion=${encodeURIComponent(mesConfiguracion)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los datos del reporte.");
        return payload;
      })
      .then((data) => {
        if (!active) return;
        setTareas(Array.isArray(data.tareas) ? data.tareas : []);
        setHistorias(Array.isArray(data.historias) ? data.historias : []);
        setPublicaciones(Array.isArray(data.publicaciones) ? data.publicaciones : []);
        setClientes(Array.isArray(data.clientes) ? data.clientes : []);
        setUsuarios(Array.isArray(data.usuarios) ? data.usuarios : []);
        setTareasRenderOs(Array.isArray(data.tareasRenderOs) ? data.tareasRenderOs : []);
        setResumenRenderOsPorDia(data.resumenRenderOsPorDia && typeof data.resumenRenderOsPorDia === "object" ? data.resumenRenderOsPorDia : {});
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        console.error("Error cargando reportes", err);
        setError("No se pudieron cargar los datos del reporte.");
      })
      .finally(() => {
        loading = false;
        if (active) setCargando(false);
      });
    };

    const actualizarAlVolver = () => {
      if (document.visibilityState === "visible") cargarReporte(true);
    };

    cargarReporte();
    const intervalo = window.setInterval(() => cargarReporte(true), 30000);
    window.addEventListener("focus", actualizarAlVolver);
    document.addEventListener("visibilitychange", actualizarAlVolver);
    return () => {
      active = false;
      window.clearInterval(intervalo);
      window.removeEventListener("focus", actualizarAlVolver);
      document.removeEventListener("visibilitychange", actualizarAlVolver);
    };
  }, [esVistaAdmin, nombrePropio, periodo]);

  const hoyISO = getHoyLocalISO();
  const ahora = useMemo(() => new Date(), [periodo]);
  const OBJETIVOS_MENSUALES_EQUIPO = {
    edicion: 40,
    diseno: 30,
    produccion: 12,
    community: 120,
  };

  const rangoPeriodo = useMemo(() => getReportPeriodRange(periodo, ahora), [periodo, ahora]);

  const enPeriodo = useCallback((fechaISO) =>
    typeof fechaISO === "string" &&
    fechaISO.slice(0, 10) >= rangoPeriodo.desde &&
    fechaISO.slice(0, 10) < rangoPeriodo.hasta,
    [rangoPeriodo]
  );

  const tareasReporte = useMemo(
    () => mergeReportTaskSources(tareas, tareasRenderOs),
    [tareas, tareasRenderOs],
  );

  const empleados = useMemo(() => {
    const nombresConTareas = [...new Set(tareasReporte.map((t) => t.asignado_a).filter(Boolean))];
    const nombresUsuarios = usuarios
      .filter((u) => u.rol !== "admin" || nombresConTareas.some((nombre) => belongsToPerson(nombre, u.nombre)))
      .map((u) => u.nombre);
    const nombresUnificados = [...nombresUsuarios];
    nombresConTareas.forEach((nombre) => {
      if (!nombresUnificados.some((existente) => belongsToPerson(existente, nombre))) {
        nombresUnificados.push(nombre);
      }
    });
    return esVistaAdmin
      ? nombresUnificados
      : [nombrePropio].filter(Boolean);
  }, [tareasReporte, usuarios, esVistaAdmin, nombrePropio]);

  const filas = useMemo(() => empleados.map((nombre) => {
    const propias = tareasReporte.filter((t) => belongsToPerson(t.asignado_a, nombre));
    const propiasRenderOs = tareasRenderOs.filter((t) => belongsToPerson(t.asignado_a, nombre));
    // Cuando una persona tiene una base mensual auditada desde ClickUp, esa
    // fuente es la que gobierna el reporte del mes. Así no se mezclan tareas
    // operativas reales con backfills automáticos o registros históricos que
    // siguen visibles en el tablero por otros motivos.
    const periodoMensual = periodo === "mes_actual" || periodo === "mes_pasado"
      ? rangoPeriodo.desde.slice(0, 7)
      : null;
    const propiasFuenteMensual = periodoMensual
      ? propias.filter(
          (t) =>
            t.propiedades_extra?.reporte_fuente === "clickup" &&
            t.propiedades_extra?.reporte_periodo === periodoMensual,
        )
      : [];
    const propiasReporte = propiasFuenteMensual.length > 0
      ? mergeReportTaskSources(propiasFuenteMensual, propiasRenderOs)
      : propias;

    const activas = propiasReporte.filter((t) => t.estado !== ESTADO_FINAL_TAREA);
    const atrasadas = activas.filter(
      (t) => t.fecha_vencimiento && t.fecha_vencimiento < hoyISO,
    );
    const terminadasPeriodo = propiasReporte.filter(
      (t) =>
        t.estado === ESTADO_FINAL_TAREA &&
        enPeriodo(t.propiedades_extra?.clickup_cerrada_at || t.updated_at || ""),
    );
    const vencianEnPeriodo = propiasReporte.filter(
      (t) => t.fecha_vencimiento && enPeriodo(t.fecha_vencimiento),
    );
    const vencidasPublicadas = vencianEnPeriodo.filter((t) => t.estado === ESTADO_FINAL_TAREA);
    const cumplimiento =
      vencianEnPeriodo.length > 0
        ? Math.round((vencidasPublicadas.length / vencianEnPeriodo.length) * 100)
        : null;

    const tiempos = terminadasPeriodo
      .map((t) => {
        if (!t.created_at || !t.updated_at) return null;
        const dias = (new Date(t.updated_at) - new Date(t.created_at)) / 86400000;
        return dias >= 0 ? dias : null;
      })
      .filter((d) => d !== null);
    const tiempoPromedio =
      tiempos.length > 0
        ? (tiempos.reduce((a, b) => a + b, 0) / tiempos.length).toFixed(1)
        : null;

    const productividad = (terminadasPeriodo.length / (rangoPeriodo.dias / 7)).toFixed(1);

    const rol = usuarios.find((u) => belongsToPerson(u.nombre, nombre))?.rol;
    const objetivoMensual = OBJETIVOS_MENSUALES_EQUIPO[rol] || null;
    const objetivoAlDia = objetivoMensual
      ? Math.max(
          1,
          Math.ceil(
            objetivoMensual *
              (Math.min(rangoPeriodo.diasTranscurridos, rangoPeriodo.dias) / rangoPeriodo.dias),
          ),
        )
      : null;
    const avanceObjetivo = objetivoMensual
      ? Math.round((terminadasPeriodo.length / objetivoMensual) * 100)
      : null;
    const estadoObjetivo = (() => {
      if (!objetivoMensual) return { label: "Sin objetivo", bg: "var(--surface-soft)", fg: "var(--muted)" };
      if (atrasadas.length > 0) return { label: "Atrasado", bg: "#f7e6e3", fg: "var(--danger)" };
      if (terminadasPeriodo.length >= objetivoAlDia) return { label: "Al día", bg: "#e3ede5", fg: "var(--success)" };
      if (terminadasPeriodo.length >= Math.ceil(objetivoAlDia * 0.75)) {
        return { label: "En riesgo", bg: "#f6e9d8", fg: "var(--warning)" };
      }
      return { label: "Atrasado", bg: "#f7e6e3", fg: "var(--danger)" };
    })();

    return {
      nombre,
      rol,
      objetivoMensual,
      objetivoAlDia,
      avanceObjetivo,
      estadoObjetivo,
      carga: activas.length,
      terminadas: terminadasPeriodo.length,
      atrasadas,
      cumplimiento,
      tiempoPromedio,
      productividad,
    };
  }), [empleados, tareasReporte, tareasRenderOs, usuarios, rangoPeriodo, hoyISO, enPeriodo, ESTADO_FINAL_TAREA, OBJETIVOS_MENSUALES_EQUIPO]);

  const PRIORIDAD_ESTADO = useMemo(() => ({ Atrasado: 0, "En riesgo": 1, "Al día": 2, "Sin objetivo": 3 }), []);

  const filasOrdenadas = useMemo(() => {
    const ordenadas = [...filas].sort((a, b) => {
      const estadoA = PRIORIDAD_ESTADO[a.estadoObjetivo.label] ?? 9;
      const estadoB = PRIORIDAD_ESTADO[b.estadoObjetivo.label] ?? 9;
      if (estadoA !== estadoB) return estadoA - estadoB;
      return a.nombre.localeCompare(b.nombre);
    });
    return ordenadas;
  }, [filas, PRIORIDAD_ESTADO]);

  const filaPropia = useMemo(() => !esVistaAdmin ? filasOrdenadas[0] : null, [esVistaAdmin, filasOrdenadas]);

  const totales = useMemo(() => ({
    activas: filas.reduce((s, f) => s + f.carga, 0),
    terminadas: filas.reduce((s, f) => s + f.terminadas, 0),
    atrasadas: filas.reduce((s, f) => s + f.atrasadas.length, 0),
  }), [filas]);

  const piezasPorResponsable = useMemo(() =>
    empleados
      .map((nombre) => {
        const hs = filterItemsByPeriod(historias, enPeriodo).filter(
          (h) => belongsToPerson(h.responsable_diseño || h.responsable, nombre),
        );
        const ps = filterItemsByPeriod(publicaciones, enPeriodo).filter(
          (p) => belongsToPerson(p.responsable_diseño || p.responsable, nombre),
        );
        const total = hs.length + ps.length;
        const publicadas =
          hs.filter((h) => h.estado === "publicada").length +
          ps.filter((p) => p.estado === "publicada").length;
        return { nombre, total, publicadas };
      })
      .filter((f) => f.total > 0)
      .sort((a, b) => b.total - a.total),
    [empleados, historias, publicaciones, enPeriodo]
  );

  const resumenEntregas = (items) => {
    const realizados = items.filter((item) => item.estado === ESTADO_FINAL_TAREA).length;
    return {
      realizados,
      pendientes: Math.max(items.length - realizados, 0),
      total: items.length,
    };
  };
  const tareasRenderOsDelPeriodo = filterRenderOsTasksByPeriod(tareasRenderOs, enPeriodo);
  const videosLuciano = summarizeTaskDeliveries(
    tareasRenderOsDelPeriodo.filter((task) => belongsToPerson(task.asignado_a, "Luciano") && isEditingTask(task)),
  );
  const filmacionesGerman = groupProductionByClient(
    tareasRenderOs.filter((tarea) => belongsToPerson(tarea.asignado_a, "Germán")),
    rangoPeriodo.desde,
    rangoPeriodo.hasta,
  );
  const historiasDelPeriodo = historias.filter((h) => enPeriodo(h.fecha_programada || ""));
  const carruselesRenderOs = tareasRenderOsDelPeriodo.filter(isCarouselTask);
  const carruselesAugusto = getDesignerCarouselTaskSummary("Augusto", clientes, carruselesRenderOs);
  const carruselesMariano = getDesignerCarouselTaskSummary("Mariano", clientes, carruselesRenderOs);
  const resumenOperativoPeriodo = Object.entries(resumenRenderOsPorDia).reduce((summary, [date, values]) => {
    if (!enPeriodo(date)) return summary;
    for (const [category, metric] of Object.entries(values || {})) {
      if (!summary[category]) summary[category] = { total: 0, publicadas: 0 };
      summary[category].total += Number(metric?.total) || 0;
      summary[category].publicadas += Number(metric?.publicadas) || 0;
    }
    return summary;
  }, {});
  const resumenOperativo = (category) => {
    const metric = resumenOperativoPeriodo[category] || { total: 0, publicadas: 0 };
    return {
      realizados: metric.publicadas,
      pendientes: Math.max(metric.total - metric.publicadas, 0),
      total: metric.total,
    };
  };
  const historiasOriana = resumenEntregas(historiasDelPeriodo);
  const reelsOriana = {
    realizados: resumenOperativo("ediciones").realizados,
    pendientes: Math.max(resumenOperativo("reels_planificados").total - resumenOperativo("ediciones").realizados, 0),
    total: Math.max(resumenOperativo("reels_planificados").total, resumenOperativo("ediciones").realizados),
  };
  const carruselesOriana = resumenOperativo("carruseles");
  const metricasOriana = [
    { etiqueta: "Carruseles entregados", verbo: "entregados", verboSingular: "entregado", ...carruselesOriana },
    { etiqueta: "Reels publicados", verbo: "publicados", verboSingular: "publicado", ...reelsOriana },
    { etiqueta: "Historias publicadas", verbo: "publicadas", verboSingular: "publicada", ...historiasOriana },
  ];

  const inicioMariano = "2026-08-01";
  const marianoActivo = periodo === "ultimos_30"
    ? hoyISO >= inicioMariano
    : rangoPeriodo.desde >= inicioMariano;
  const fechaLimite = periodo === "mes_actual" ? formatPeriodDeadline(rangoPeriodo.hasta) : "";
  const tarjetasEntregables = [
    {
      nombre: "Augusto",
      rol: "Diseño",
      metricas: [{ etiqueta: "Carruseles entregados", verbo: "entregados", verboSingular: "entregado", ...carruselesAugusto }],
    },
    {
      nombre: "Luciano",
      rol: "Edición",
      metricas: [{ etiqueta: "Videos editados", ...videosLuciano }],
    },
    {
      nombre: "Germán",
      rol: "Filmmaker",
      tipo: "filmaciones",
      clientes: filmacionesGerman,
    },
    {
      nombre: "Oriana",
      rol: "Publicación",
      metricas: metricasOriana,
    },
    {
      nombre: "Mariano",
      rol: "Diseño y contenido",
      proximoMes: !marianoActivo,
      metricas: [
        { etiqueta: "Carruseles entregados", verbo: "entregados", verboSingular: "entregado", ...carruselesMariano },
      ],
    },
  ];

  const PERIODOS = [
    { id: "mes_actual", label: "Este mes" },
    { id: "mes_pasado", label: "Mes pasado" },
    { id: "ultimos_30", label: "Últimos 30 días" },
  ];

  const cardStyle = useMemo(() => ({ padding: "16px", borderRadius: "8px", textAlign: "center" }), []);
  const numStyle = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontVariantNumeric: "tabular-nums" };

  return (
    <main aria-label="Render platform reportes equipo">
      <div className="frame">
        <div className="content reportes-page">
          <header className="module-intro"><div><div className="section-label">Reportes · Solo Líder</div><h2>¿Cómo rindió el equipo este mes?</h2><p>Objetivos, trabajo realizado y pendientes, sin información económica.</p></div></header>

          {error && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {error}
            </div>
          )}

          <div className="tabs reportes-periods" style={{ marginBottom: "16px" }}>
            {PERIODOS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={periodo === p.id ? "active" : ""}
                onClick={() => { pushUrlContext({ periodo: p.id }); setPeriodo(p.id); }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {cargando ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando reportes…</div>
          ) : (
            <>
              <div className="section-label">
                {esVistaAdmin ? "Producción del mes" : "Mi objetivo mensual — vista rápida"}
              </div>
              <div className="reportes-team-grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${esVistaAdmin ? "230px" : "150px"}, 1fr))` }}>
                {esVistaAdmin ? (
                  tarjetasEntregables.map((tarjeta) => (
                    tarjeta.tipo === "filmaciones"
                      ? <TarjetaFilmacionesGerman key={tarjeta.nombre} clientes={tarjeta.clientes} fechaLimite={fechaLimite}/>
                      : <TarjetaEntregablesEquipo key={tarjeta.nombre} {...tarjeta} fechaLimite={tarjeta.nombre === "Luciano" ? "" : fechaLimite}/>
                  ))
                ) : belongsToPerson(nombrePropio, "Oriana") ? (
                  <TarjetaEntregablesEquipo nombre="Oriana" rol="Publicación" metricas={metricasOriana} fechaLimite={fechaLimite}/>
                ) : belongsToPerson(nombrePropio, "Augusto") ? (
                  <TarjetaEntregablesEquipo nombre="Augusto" rol="Diseño" metricas={[{ etiqueta: "Carruseles entregados", verbo: "entregados", verboSingular: "entregado", ...carruselesAugusto }]} fechaLimite={fechaLimite}/>
                ) : belongsToPerson(nombrePropio, "Mariano") ? (
                  <TarjetaEntregablesEquipo nombre="Mariano" rol="Diseño y contenido" metricas={[{ etiqueta: "Carruseles entregados", verbo: "entregados", verboSingular: "entregado", ...carruselesMariano }]} fechaLimite={fechaLimite}/>
                ) : belongsToPerson(nombrePropio, "Germán") ? (
                  <TarjetaFilmacionesGerman clientes={filmacionesGerman} fechaLimite={fechaLimite}/>
                ) : (
                  <>
                    <div style={{ ...cardStyle, background: filaPropia?.estadoObjetivo?.bg || "var(--surface-soft)" }}>
                      <div style={{ fontSize: "20px", fontWeight: "600", color: filaPropia?.estadoObjetivo?.fg || "var(--muted)" }}>
                        {filaPropia?.estadoObjetivo?.label || "Sin datos"}
                      </div>
                      <div style={{ fontSize: "12px", color: filaPropia?.estadoObjetivo?.fg || "var(--muted)" }}>Estado</div>
                    </div>
                    <div style={{ ...cardStyle, background: "var(--surface-soft)" }}>
                      <div style={{ ...numStyle, fontSize: "24px", fontWeight: "600", color: "var(--accent)" }}>{filaPropia?.avanceObjetivo ?? 0}%</div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>Avance al 100%</div>
                    </div>
                    <div style={{ ...cardStyle, background: "#e3ede5" }}>
                      <div style={{ ...numStyle, fontSize: "24px", fontWeight: "600", color: "var(--success)" }}>{filaPropia?.terminadas ?? 0}</div>
                      <div style={{ fontSize: "12px", color: "var(--success)" }}>Publicadas este mes</div>
                    </div>
                    <div style={{ ...cardStyle, background: "#f6e9d8" }}>
                      <div style={{ ...numStyle, fontSize: "24px", fontWeight: "600", color: "var(--warning)" }}>{filaPropia?.carga ?? 0}</div>
                      <div style={{ fontSize: "12px", color: "var(--warning)" }}>Pendientes</div>
                    </div>
                  </>
                )}
              </div>

              {!esVistaAdmin && (
                <>
                  <div className="section-label">Mi rendimiento</div>
                  <div className="box" style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #333", background: "#fafafa" }}>
                      <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: "600", fontSize: "12px" }}>Empleado</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Objetivo</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Publicadas</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Avance al 100%</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Estado</th>
                      <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Pendientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasOrdenadas.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "#999" }}>
                          Sin datos de tareas todavía.
                        </td>
                      </tr>
                    )}
                    {filasOrdenadas.map((f) => (
                      <React.Fragment key={f.nombre}>
                        <tr
                          style={{ borderBottom: "1px solid #eee", cursor: f.atrasadas.length > 0 ? "pointer" : "default" }}
                          onClick={() =>
                            f.atrasadas.length > 0 &&
                            setDetalleDe(detalleDe === f.nombre ? null : f.nombre)
                          }
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: "600", fontSize: "13px" }}>{f.nombre}</div>
                            {f.rol && (
                              <div style={{ fontSize: "11px", color: "#999" }}>{ROL_LABELS[f.rol] || f.rol}</div>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontWeight: "600" }}>
                            {f.objetivoMensual ? (
                              <>
                                <div>{f.objetivoMensual}</div>
                                <div style={{ fontSize: "11px", color: "#999" }}>al mes</div>
                              </>
                            ) : (
                              <span style={{ color: "#bbb" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", color: "#2e7d32", fontWeight: "600" }}>{f.terminadas}</td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            {f.avanceObjetivo === null ? (
                              <span style={{ color: "#bbb", fontSize: "12px" }}>Sin objetivo</span>
                            ) : (
                              <>
                                <div style={{ display: "inline-block", width: "56px", height: "6px", background: "#e0e0e0", borderRadius: "3px", overflow: "hidden", verticalAlign: "middle" }}>
                                  <div
                                    style={{
                                      width: `${Math.min(f.avanceObjetivo, 100)}%`,
                                      height: "100%",
                                      background: f.avanceObjetivo >= 100 ? "#4caf50" : f.avanceObjetivo >= 70 ? "#ff9800" : "#f44336",
                                    }}
                                  />
                                </div>
                                <div style={{ fontSize: "11px", marginTop: "2px", fontWeight: "600" }}>{f.avanceObjetivo}%</div>
                              </>
                            )}
                          </td>
                          <td style={{ padding: "10px", textAlign: "center" }}>
                            <span style={{ background: f.estadoObjetivo.bg, color: f.estadoObjetivo.fg, padding: "3px 8px", borderRadius: "10px", fontWeight: "700", fontSize: "12px" }}>
                              {f.estadoObjetivo.label}
                            </span>
                          </td>
                          <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>
                            <strong>{f.carga}</strong>
                            {f.atrasadas.length > 0 && (
                              <span style={{ background: "#fff3e0", color: "#e65100", padding: "2px 6px", borderRadius: "10px", fontWeight: "700", fontSize: "11px", marginLeft: "6px" }}>
                                {f.atrasadas.length} atras.
                              </span>
                            )}
                          </td>
                        </tr>
                        {detalleDe === f.nombre &&
                          f.atrasadas.map((t) => (
                            <tr key={`det-${t.id}`} style={{ background: "#fffde7", borderBottom: "1px solid #f0f0f0" }}>
                              <td colSpan={6} style={{ padding: "6px 12px 6px 32px", fontSize: "12px", color: "#795548" }}>
                                <strong>{t.titulo}</strong>
                                {t.cliente_nombre ? ` · ${t.cliente_nombre}` : ""} · vencía {t.fecha_vencimiento} ·{" "}
                                {getEstadoTareaLabel(t.estado)}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                  </div>
                  <div className="caption" style={{ marginTop: "8px", marginBottom: "20px" }}>
                    El 100% se calcula contra el objetivo mensual de tu rol. El estado compara lo hecho con el ritmo esperado del mes y marca atrasos si hay vencidas.
                  </div>
                </>
              )}

              {!esVistaAdmin && (
                <>
                  <div className="section-label">Mis piezas asignadas</div>
                  <div className="box">
                {piezasPorResponsable.length === 0 ? (
                  <div style={{ color: "#999", textAlign: "center", padding: "20px" }}>Sin piezas asignadas todavía.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #333" }}>
                        <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: "600", fontSize: "12px" }}>Responsable</th>
                        <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Piezas asignadas</th>
                        <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Publicadas</th>
                        <th style={{ textAlign: "center", padding: "10px", fontWeight: "600", fontSize: "12px" }}>Avance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {piezasPorResponsable.map((f) => {
                        const avance = f.total > 0 ? Math.round((f.publicadas / f.total) * 100) : 0;
                        return (
                          <tr key={f.nombre} style={{ borderBottom: "1px solid #eee" }}>
                            <td style={{ padding: "10px 12px", fontWeight: "600", fontSize: "13px" }}>{f.nombre}</td>
                            <td style={{ padding: "10px", textAlign: "center" }}>{f.total}</td>
                            <td style={{ padding: "10px", textAlign: "center", color: "#2e7d32" }}>{f.publicadas}</td>
                            <td style={{ padding: "10px", textAlign: "center" }}>
                              <div style={{ display: "inline-block", width: "60px", height: "6px", background: "#e0e0e0", borderRadius: "3px", overflow: "hidden", verticalAlign: "middle" }}>
                                <div
                                  style={{
                                    width: `${avance}%`,
                                    height: "100%",
                                    background: avance >= 70 ? "#4caf50" : avance >= 30 ? "#ff9800" : "#f44336",
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: "11px", marginLeft: "6px" }}>{avance}%</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// ── MÓDULO PUBLICACIONES: vista general filtrable + planilla por cliente ──────
