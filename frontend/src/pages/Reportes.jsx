import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getEstadoTareaLabel, getHoyLocalISO, getSesion } from "../utils.jsx";
import { ROL_LABELS, ESTADO_FINAL_TAREA } from "../constants.js";

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
    <div style={{ paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ fontWeight: "600", fontSize: "13px", color: "var(--text)" }}>{etiqueta}</div>
        <div style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
          <strong style={{ color: "var(--text)", fontSize: "16px", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontVariantNumeric: "tabular-nums" }}>{realizados}</strong> de {total}
        </div>
      </div>
      <div style={{ height: "6px", background: "var(--surface-soft)", borderRadius: "999px", overflow: "hidden", margin: "9px 0 7px" }}>
        <div
          style={{
            width: `${Math.min(porcentaje, 100)}%`,
            height: "100%",
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

export function TarjetaEntregablesEquipo({ nombre, rol, metricas = [], proximoMes = false }) {
  const inicial = (nombre || "?").trim().charAt(0).toUpperCase();
  return (
    <article
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

export function ReportesEquipoPage() {
  const sesion = getSesion();
  const usuarioSesion = sesion?.usuario;
  const esVistaAdmin = usuarioSesion?.rol === "admin";
  const nombrePropio = usuarioSesion?.nombre;
  const [tareas, setTareas] = useState([]);
  const [historias, setHistorias] = useState([]);
  const [publicaciones, setPublicaciones] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [periodo, setPeriodo] = useState("mes_actual");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [detalleDe, setDetalleDe] = useState(null);

  useEffect(() => {
    const tareasUrl =
      esVistaAdmin || !nombrePropio
        ? "/api/tareas"
        : `/api/tareas?asignado_a=${encodeURIComponent(nombrePropio)}`;
    Promise.all([
      fetch(tareasUrl).then((r) => r.json()),
      fetch("/api/historias").then((r) => r.json()),
      fetch("/api/publicaciones").then((r) => r.json()),
      fetch("/api/usuarios").then((r) => r.json()),
    ])
      .then(([t, h, p, u]) => {
        setTareas(Array.isArray(t) ? t : []);
        setHistorias(Array.isArray(h) ? h : []);
        setPublicaciones(Array.isArray(p) ? p : []);
        setUsuarios(Array.isArray(u) ? u : []);
        setError(null);
      })
      .catch((err) => {
        console.error("Error cargando reportes", err);
        setError("No se pudieron cargar los datos del reporte.");
      })
      .finally(() => setCargando(false));
  }, [esVistaAdmin, nombrePropio]);

  const hoyISO = getHoyLocalISO();
  const ahora = new Date();
  const OBJETIVOS_MENSUALES_EQUIPO = {
    edicion: 40,
    diseno: 30,
    produccion: 12,
    community: 120,
  };

  const rangoPeriodo = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    if (periodo === "mes_actual") {
      const desde = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-01`;
      const sig = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
      const hasta = `${sig.getFullYear()}-${pad(sig.getMonth() + 1)}-01`;
      return {
        desde,
        hasta,
        dias: new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate(),
        diasTranscurridos: ahora.getDate(),
      };
    }
    if (periodo === "mes_pasado") {
      const prev = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      const desde = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`;
      const hasta = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-01`;
      const dias = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
      return { desde, hasta, dias, diasTranscurridos: dias };
    }
    const d30 = new Date(ahora);
    d30.setDate(d30.getDate() - 30);
    const desde = `${d30.getFullYear()}-${pad(d30.getMonth() + 1)}-${pad(d30.getDate())}`;
    return { desde, hasta: "9999-12-31", dias: 30, diasTranscurridos: 30 };
  }, [periodo, ahora]);

  const enPeriodo = useCallback((fechaISO) =>
    typeof fechaISO === "string" &&
    fechaISO.slice(0, 10) >= rangoPeriodo.desde &&
    fechaISO.slice(0, 10) < rangoPeriodo.hasta,
    [rangoPeriodo]
  );

  const empleados = useMemo(() => {
    const nombresConTareas = [...new Set(tareas.map((t) => t.asignado_a).filter(Boolean))];
    const nombresUsuarios = usuarios
      .filter((u) => u.rol !== "admin" || nombresConTareas.includes(u.nombre))
      .map((u) => u.nombre);
    return esVistaAdmin
      ? [...new Set([...nombresUsuarios, ...nombresConTareas])]
      : [nombrePropio].filter(Boolean);
  }, [tareas, usuarios, esVistaAdmin, nombrePropio]);

  const filas = useMemo(() => empleados.map((nombre) => {
    const propias = tareas.filter((t) => t.asignado_a === nombre);
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
      ? propiasFuenteMensual
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

    const rol = usuarios.find((u) => u.nombre === nombre)?.rol;
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
  }), [empleados, tareas, usuarios, rangoPeriodo, hoyISO, enPeriodo, ESTADO_FINAL_TAREA, OBJETIVOS_MENSUALES_EQUIPO]);

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
        const hs = historias.filter(
          (h) => (h.responsable_diseño || h.responsable) === nombre,
        );
        const ps = publicaciones.filter((p) => p.responsable === nombre);
        const total = hs.length + ps.length;
        const publicadas =
          hs.filter((h) => h.estado === "publicada").length +
          ps.filter((p) => p.estado === "publicada").length;
        return { nombre, total, publicadas };
      })
      .filter((f) => f.total > 0)
      .sort((a, b) => b.total - a.total),
    [empleados, historias, publicaciones]
  );

  const periodoMensualReporte = periodo === "mes_actual" || periodo === "mes_pasado"
    ? rangoPeriodo.desde.slice(0, 7)
    : null;
  const tareasDelPeriodoPorPersona = (nombre) => {
    const propias = tareas.filter((t) => t.asignado_a === nombre);
    const fuenteMensual = periodoMensualReporte
      ? propias.filter(
          (t) =>
            t.propiedades_extra?.reporte_fuente === "clickup" &&
            t.propiedades_extra?.reporte_periodo === periodoMensualReporte,
        )
      : [];
    if (fuenteMensual.length > 0) return fuenteMensual;
    return propias.filter((t) => {
      const cerradaEnPeriodo =
        t.estado === ESTADO_FINAL_TAREA &&
        enPeriodo(t.propiedades_extra?.clickup_cerrada_at || t.updated_at || "");
      return cerradaEnPeriodo || enPeriodo(t.fecha_vencimiento || "");
    });
  };
  const resumenEntregas = (items) => {
    const realizados = items.filter((item) => item.estado === ESTADO_FINAL_TAREA).length;
    return {
      realizados,
      pendientes: Math.max(items.length - realizados, 0),
      total: items.length,
    };
  };
  const esCarrusel = (tarea) => {
    const titulo = (tarea.titulo || "").toLocaleLowerCase("es");
    const lista = (tarea.propiedades_extra?.clickup_lista || "").toLocaleLowerCase("es");
    return titulo.includes("carrusel") || lista.includes("carrusel");
  };

  const carruselesAugusto = resumenEntregas(
    tareasDelPeriodoPorPersona("Augusto").filter(esCarrusel),
  );
  const videosLuciano = resumenEntregas(
    tareasDelPeriodoPorPersona("Luciano").filter((t) => t.tipo_tarea === "edicion"),
  );
  const historiasDelPeriodo = historias.filter((h) => enPeriodo(h.fecha_programada || ""));
  const reelsDelPeriodo = publicaciones.filter(
    (p) => p.tipo === "video" && enPeriodo(p.fecha_programada || ""),
  );
  const historiasOriana = resumenEntregas(historiasDelPeriodo);
  const reelsOriana = resumenEntregas(reelsDelPeriodo);

  const inicioMariano = "2026-08-01";
  const marianoActivo = periodo === "ultimos_30"
    ? hoyISO >= inicioMariano
    : rangoPeriodo.desde >= inicioMariano;
  const carruselesMariano = resumenEntregas(
    tareasDelPeriodoPorPersona("Mariano").filter(esCarrusel),
  );
  const historiasMariano = resumenEntregas(
    historiasDelPeriodo.filter(
      (h) => (h.responsable_diseño || h.responsable || "").toLocaleLowerCase("es") === "mariano",
    ),
  );

  const tarjetasEntregables = [
    {
      nombre: "Augusto",
      rol: "Diseño",
      metricas: [{ etiqueta: "Carruseles", ...carruselesAugusto }],
    },
    {
      nombre: "Luciano",
      rol: "Edición",
      metricas: [{ etiqueta: "Videos editados", ...videosLuciano }],
    },
    {
      nombre: "Germán",
      rol: "Producción",
      metricas: [
        {
          etiqueta: "Videos útiles a grabar",
          total: 40,
          enRevision: true,
        },
      ],
    },
    {
      nombre: "Oriana",
      rol: "Publicación",
      metricas: [
        { etiqueta: "Historias publicadas", verbo: "publicadas", verboSingular: "publicada", ...historiasOriana },
        { etiqueta: "Reels publicados", verbo: "publicados", verboSingular: "publicado", ...reelsOriana },
      ],
    },
    {
      nombre: "Mariano",
      rol: "Diseño y contenido",
      proximoMes: !marianoActivo,
      metricas: [
        { etiqueta: "Carruseles", ...carruselesMariano },
        { etiqueta: "Historias", ...historiasMariano },
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
        <div className="content">
          <div className="section-label">
            {esVistaAdmin ? "Rendimiento mensual del equipo" : "Mi rendimiento mensual"}
          </div>
          <div className="caption" style={{ marginBottom: "16px" }}>
            {esVistaAdmin
              ? "Entregas realizadas y pendientes según el trabajo concreto de cada persona."
              : "Seguimiento de tu objetivo, tareas completadas y pendientes."}
          </div>

          {error && (
            <div style={{ padding: "10px", background: "#ffebee", color: "#c62828", borderRadius: "4px", marginBottom: "12px" }}>
              {error}
            </div>
          )}

          <div className="tabs" style={{ marginBottom: "16px" }}>
            {PERIODOS.map((p) => (
              <span
                key={p.id}
                className={periodo === p.id ? "active" : ""}
                onClick={() => setPeriodo(p.id)}
                style={{ cursor: "pointer" }}
              >
                {p.label}
              </span>
            ))}
          </div>

          {cargando ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#999" }}>Cargando reportes…</div>
          ) : (
            <>
              <div className="section-label">
                {esVistaAdmin ? "Producción del mes" : "Mi objetivo mensual — vista rápida"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${esVistaAdmin ? "230px" : "150px"}, 1fr))`, gap: "14px", marginBottom: "12px" }}>
                {esVistaAdmin ? (
                  tarjetasEntregables.map((tarjeta) => (
                    <TarjetaEntregablesEquipo key={tarjeta.nombre} {...tarjeta} />
                  ))
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
              {esVistaAdmin && (
                <div className="caption" style={{ marginBottom: "24px" }}>
                  Carruseles, ediciones, grabaciones y publicaciones se calculan por separado. No se mezclan tareas de otros roles.
                </div>
              )}

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
