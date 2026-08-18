import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getHoyLocalISO, getInicialesCliente, getSesion, payloadColumnaPlanilla } from "../utils.jsx";
import { COLUMNAS_MULTILINEA, COLUMNAS_PLANILLA, DIAS_SEMANA, DIAS_SEMANA_CLIENTE, ESTADOS_HISTORIA, MESES, MESES_CLIENTE, RESPONSABLES_EQUIPO } from "../constants.js";
import { parseJsonArrayResponse } from "../shared/http/response-utils.js";
import { PageState } from "../components/PageState.jsx";
import { formatMonthContext, pushUrlContext, readMonthContext, readUrlContext, replaceUrlContext } from "../shared/navigation/url-context.js";

export function HistoriasPlanillaTab({
  clientes,
  year,
  month,
  cargando,
  historias,
  ultimoIdCreado,
  onActualizarLocal,
  onGuardarServidor,
  onAgregar,
  onDuplicar,
  onEliminar,
  clienteFiltradoNombre,
}) {
  const [error, setError] = useState(null);
  const gridRef = useRef(null);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const clientesPorId = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nombre])), [clientes]);

  // Memoizar mapeo de estados para búsqueda rápida
  const estadoPorId = useMemo(() =>
    Object.fromEntries(ESTADOS_HISTORIA.map((e) => [e.id, e])),
    []
  );

  const filasVisibles = useMemo(() =>
    historias
      .filter((h) => h.fecha_programada && h.fecha_programada.startsWith(mesPrefix))
      .slice()
      .sort((a, b) =>
        (a.fecha_programada + (clientesPorId[a.cliente_id] || "") + (a.metadata?.hora || "")).localeCompare(
          b.fecha_programada + (clientesPorId[b.cliente_id] || "") + (b.metadata?.hora || ""),
        ),
      ),
    [historias, mesPrefix, clientesPorId]
  );

  const enfocarCelda = useCallback((rowIndex, columna) => {
    const el = gridRef.current?.querySelector(
      `[data-cell="${rowIndex}:${columna}"]`,
    );
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  }, []);

  // Foco tras crear/duplicar una fila: el padre avisa por prop cuál es el
  // id nuevo apenas responde el servidor.
  useEffect(() => {
    if (!ultimoIdCreado) return;
    const idx = filasVisibles.findIndex((h) => h.id === ultimoIdCreado);
    if (idx === -1) return;
    requestAnimationFrame(() => enfocarCelda(idx, "fecha"));
  }, [ultimoIdCreado, filasVisibles, enfocarCelda]);

  const actualizarLocal = useCallback((historiaId, campos) => onActualizarLocal(historiaId, campos), [onActualizarLocal]);
  const guardarEnServidor = useCallback((historiaId, campos) => onGuardarServidor(historiaId, campos), [onGuardarServidor]);

  // onBlur de las celdas de texto: recorta espacios y sincroniza el
  // estado local con lo mismo que se manda al servidor (evita que quede
  // un valor con espacios en el input mientras la DB ya tiene la versión
  // recortada).
  const confirmarCampoTexto = useCallback((historiaId, campos) => {
    actualizarLocal(historiaId, campos);
    guardarEnServidor(historiaId, campos);
  }, [actualizarLocal, guardarEnServidor]);

  const copiarFila = useCallback(async (h) => {
    const est = estadoPorId[h.estado];
    const linea = [
      clientesPorId[h.cliente_id] || "",
      h.fecha_programada || "",
      h.metadata?.hora || "",
      h.metadata?.tipo || "",
      h.copy || "",
      h.material_referencia || "",
      h.aclaraciones || "",
      h.responsable_diseño || h.responsable || "",
      est?.label || h.estado || "",
    ].join("\t");
    try {
      await navigator.clipboard.writeText(linea);
    } catch (err) {
      console.error("No se pudo copiar la fila", err);
    }
  }, [clientesPorId, estadoPorId]);

  // Crece el textarea con el contenido en vez de esconder texto o abrir
  // scroll interno — la fila entera se estira, igual que en el Sheet.
  const ajustarAltura = useCallback((el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Enter mueve a la misma columna, fila de abajo (como Sheets/Excel). En
  // copy/observaciones Enter inserta un renglón propio en cambio — son
  // textos largos que legítimamente llevan varias líneas (un copy de
  // Instagram con su propio salto de párrafo, por ejemplo).
  const manejarEnterOTab = useCallback((e, rowIndex, columna) => {
    if (COLUMNAS_MULTILINEA.includes(columna)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      enfocarCelda(rowIndex + 1, columna);
    }
    // Tab usa el orden natural del DOM — no hace falta manejarlo a mano.
  }, [enfocarCelda]);

  // Pegado multi-celda: si el portapapeles trae tabs (un bloque copiado de
  // Sheets), lo distribuye sobre las filas/columnas existentes a partir de
  // la celda activa. En columnas de texto largo un salto de línea solo no
  // dispara esto — puede ser contenido real (un copy de varios renglones)
  // pegado en una sola celda, no un rango de Sheets.
  const manejarPaste = useCallback((e, rowIndex, columna) => {
    const texto = e.clipboardData.getData("text/plain");
    const esMultilinea = COLUMNAS_MULTILINEA.includes(columna);
    const esPegadoMultiCelda = esMultilinea
      ? texto.includes("\t")
      : texto.includes("\t") || texto.includes("\n");
    if (!esPegadoMultiCelda) return;
    e.preventDefault();

    const filasTexto = texto.replace(/\r/g, "").split("\n");
    while (filasTexto.length > 1 && filasTexto[filasTexto.length - 1] === "") {
      filasTexto.pop();
    }

    const colInicio = COLUMNAS_PLANILLA.indexOf(columna);

    filasTexto.forEach((filaTexto, dRow) => {
      const historiaObjetivo = filasVisibles[rowIndex + dRow];
      if (!historiaObjetivo) return;

      const valores = filaTexto.split("\t");
      let payload = {};
      valores.forEach((valorCelda, dCol) => {
        const colObjetivo = COLUMNAS_PLANILLA[colInicio + dCol];
        if (!colObjetivo) return;
        const campo = payloadColumnaPlanilla(colObjetivo, valorCelda);
        if (!campo) return;
        payload = {
          ...payload,
          ...campo,
          metadata: { ...(payload.metadata || {}), ...(campo.metadata || {}) },
        };
      });

      if (Object.keys(payload).length > 0) {
        actualizarLocal(historiaObjetivo.id, payload);
        guardarEnServidor(historiaObjetivo.id, payload);
      }
    });
  }, [filasVisibles, actualizarLocal, guardarEnServidor]);

  return (
    <>
      {error && (
        <div className="alert is-error">{error}</div>
      )}

      <div className="stories-sheet-guide">
        <div>
          <span>Edición directa</span>
          <p>Completá la fila de izquierda a derecha. Los cambios se guardan al salir de cada campo.</p>
        </div>
        <strong>{clienteFiltradoNombre ? `Cliente: ${clienteFiltradoNombre}` : "Todos los clientes"}</strong>
      </div>

      {cargando ? (
        <div className="state-empty">Cargando planilla…</div>
      ) : (
        <div className="sheet-frame" ref={gridRef}>
          <table className="sheet-table sheet-planning-table" aria-label="Planificación editable de historias">
            <colgroup>
              <col className="sheet-rownum-col" />
              <col className="sheet-client-col" />
              <col className="sheet-date-col" />
              <col className="sheet-time-col" />
              <col className="sheet-type-col" />
              <col className="sheet-copy-col" />
              <col className="sheet-material-col" />
              <col className="sheet-notes-col" />
              <col className="sheet-owner-col" />
              <col className="sheet-status-col" />
              <col className="sheet-actions-col" />
            </colgroup>
            <thead>
              <tr className="sheet-column-letters" aria-hidden="true">
                <th className="sheet-corner"></th>
                {["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((letra) => (
                  <th key={letra}>{letra}</th>
                ))}
              </tr>
              <tr>
                <th className="sheet-rownum-head"></th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Tema / formato</th>
                <th>Texto / copy</th>
                <th>Enlace</th>
                <th>Notas</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.length === 0 && (
                <tr>
                  <td colSpan={11} className="stories-empty-cell">
                    <div className="stories-empty-state">
                      <span className="stories-empty-icon" aria-hidden="true">○</span>
                      <strong>No hay historias planificadas para este período</strong>
                      <small>Creá la primera historia y completá los datos directamente en la planilla.</small>
                      <button type="button" className="btn primary" onClick={onAgregar}>+ Nueva historia</button>
                    </div>
                  </td>
                </tr>
              )}
              {filasVisibles.map((h, rowIndex) => {
                // Cache de cálculos por historia para evitar recalcular en cada render
                const cacheKey = `${h.id}:${h.fecha_programada}:${h.estado}`;
                const fecha = new Date(`${h.fecha_programada}T00:00:00`);
                const dow = fecha.getDay();
                const esFinde = dow === 0 || dow === 6;
                const esHoy = h.fecha_programada === hoyISO;
                const estaAtrasada = h.fecha_programada < hoyISO && h.estado !== "publicada";
                const est = estadoPorId[h.estado] || ESTADOS_HISTORIA[0];
                // Franjeado sutil por día (no por fila): ayuda a distinguir
                // rápido dónde termina un día y empieza el siguiente, igual
                // que en el Sheet, sin competir con hoy/atrasada/finde.
                const diaPar = fecha.getDate() % 2 === 0;
                const bgFila = estaAtrasada ? "#fff5f5" : esHoy ? "#e3f2fd" : esFinde ? "#fafafa" : diaPar ? "#fbfcfa" : undefined;
                const esNuevoDia = rowIndex === 0 || filasVisibles[rowIndex - 1].fecha_programada !== h.fecha_programada;

                return (
                  <tr key={h.id} style={{ background: bgFila, borderTop: esNuevoDia && rowIndex > 0 ? "2px solid #dadce0" : undefined }}>
                    <td className="sheet-row-number">{rowIndex + 1}</td>
                    <td className="sheet-client-cell" data-label="Cliente">
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:cliente`}
                        value={h.cliente_id || ""}
                        onChange={(e) => {
                          const campos = { cliente_id: Number(e.target.value) };
                          actualizarLocal(h.id, campos);
                          guardarEnServidor(h.id, campos);
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "cliente")}
                      >
                        {clientes.map((cliente) => (
                          <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td className="sheet-date-cell" data-label="Fecha">
                      <input
                        type="date"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:fecha`}
                        value={h.fecha_programada || ""}
                        onChange={(e) => actualizarLocal(h.id, { fecha_programada: e.target.value })}
                        onBlur={(e) => guardarEnServidor(h.id, { fecha_programada: e.target.value })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "fecha")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "fecha")}
                      />
                    </td>
                    <td data-label="Hora">
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:hora`}
                        placeholder="—"
                        value={h.metadata?.hora || ""}
                        onChange={(e) => actualizarLocal(h.id, { metadata: { hora: e.target.value } })}
                        onBlur={(e) => confirmarCampoTexto(h.id, { metadata: { hora: e.target.value.trim() } })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "hora")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "hora")}
                      />
                    </td>
                    <td data-label="Tema / formato">
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:tipo`}
                        placeholder="Testimonio, promo…"
                        value={h.metadata?.tipo || ""}
                        onChange={(e) => actualizarLocal(h.id, { metadata: { tipo: e.target.value } })}
                        onBlur={(e) => confirmarCampoTexto(h.id, { metadata: { tipo: e.target.value.trim() } })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "tipo")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "tipo")}
                      />
                    </td>
                    <td className="h-copy-cell" data-label="Texto / copy">
                      <textarea
                        className="sheet-cell sheet-cell-textarea"
                        data-cell={`${rowIndex}:copy`}
                        placeholder="Escribir copy…"
                        rows={1}
                        ref={ajustarAltura}
                        value={h.copy || ""}
                        onChange={(e) => {
                          actualizarLocal(h.id, { copy: e.target.value });
                          ajustarAltura(e.target);
                        }}
                        onBlur={(e) => confirmarCampoTexto(h.id, { copy: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "copy")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "copy")}
                      />
                    </td>
                    <td data-label="Enlace">
                      <input
                        type="text"
                        className="sheet-cell"
                        data-cell={`${rowIndex}:material`}
                        placeholder="Link…"
                        value={h.material_referencia || ""}
                        onChange={(e) => actualizarLocal(h.id, { material_referencia: e.target.value })}
                        onBlur={(e) => confirmarCampoTexto(h.id, { material_referencia: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "material")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "material")}
                      />
                    </td>
                    <td data-label="Notas">
                      <textarea
                        className="sheet-cell sheet-cell-textarea"
                        data-cell={`${rowIndex}:aclaraciones`}
                        placeholder="—"
                        rows={1}
                        ref={ajustarAltura}
                        value={h.aclaraciones || ""}
                        onChange={(e) => {
                          actualizarLocal(h.id, { aclaraciones: e.target.value });
                          ajustarAltura(e.target);
                        }}
                        onBlur={(e) => confirmarCampoTexto(h.id, { aclaraciones: e.target.value.trim() })}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "aclaraciones")}
                        onPaste={(e) => manejarPaste(e, rowIndex, "aclaraciones")}
                      />
                    </td>
                    <td data-label="Responsable">
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:responsable`}
                        value={h.responsable_diseño || h.responsable || "Augusto"}
                        onChange={(e) => {
                          const campos = { responsable: e.target.value, responsable_diseño: e.target.value };
                          actualizarLocal(h.id, campos);
                          guardarEnServidor(h.id, campos);
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "responsable")}
                      >
                        {RESPONSABLES_EQUIPO.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Estado">
                      <select
                        className="sheet-cell"
                        data-cell={`${rowIndex}:estado`}
                        value={h.estado}
                        onChange={(e) => {
                          actualizarLocal(h.id, { estado: e.target.value });
                          guardarEnServidor(h.id, { estado: e.target.value });
                        }}
                        onKeyDown={(e) => manejarEnterOTab(e, rowIndex, "estado")}
                        style={{ background: est.bg, color: est.fg, fontWeight: "600", border: "1px solid transparent" }}
                      >
                        {ESTADOS_HISTORIA.map((e) => (
                          <option key={e.id} value={e.id}>{e.label}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Acciones">
                      <div className="sheet-row-actions">
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => copiarFila(h)}
                          title="Copiar fila (para pegar en otra fila o en Sheets)"
                          aria-label={`Copiar historia de ${h.cliente_nombre || "este cliente"}`}
                        >
                          ⧉
                        </button>
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => onDuplicar(h)}
                          title="Duplicar historia"
                          aria-label={`Duplicar historia de ${h.cliente_nombre || "este cliente"}`}
                        >
                          ⎘
                        </button>
                        <button
                          type="button"
                          className="sheet-icon-btn"
                          onClick={() => onEliminar(h.id)}
                          title="Eliminar"
                          aria-label={`Eliminar historia de ${h.cliente_nombre || "este cliente"}`}
                        >
                          🗑
                        </button>
                      </div>
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

// ── HOJA POR CLIENTE: calendario día por día de un cliente ──────────────────

export function HistoriasClienteTab({ clientes, estructura, historias, year, month }) {
  const [clienteSeleccionado, setClienteSeleccionado] = useState(clientes.length > 0 ? clientes[0].id : null);

  const DIAS_SEMANA = DIAS_SEMANA_CLIENTE;
  const MESES = MESES_CLIENTE;
  const clienteActual = useMemo(() => clientes.find((c) => c.id === clienteSeleccionado), [clientes, clienteSeleccionado]);

  const estructuraPorDia = useMemo(() => {
    const acc = {};
    if (estructura && clienteSeleccionado) {
      estructura.forEach((e) => {
        if (e.cliente_id === clienteSeleccionado) {
          acc[e.dia_semana] = e;
        }
      });
    }
    return acc;
  }, [estructura, clienteSeleccionado]);

  // Indexar historias del cliente por fecha ISO — evita un .filter() O(n)
  // por cada una de las ~35 celdas del calendario (era O(dias * historias)).
  const historiasPorFecha = useMemo(() => {
    const acc = {};
    historias.forEach((h) => {
      if (h.cliente_id !== clienteSeleccionado || !h.fecha_programada) return;
      (acc[h.fecha_programada] = acc[h.fecha_programada] || []).push(h);
    });
    return acc;
  }, [historias, clienteSeleccionado]);

  const semanas = useMemo(() => {
    const primerDia = new Date(year, month, 1);
    const ultimoDia = new Date(year, month + 1, 0);
    const inicioCalendario = new Date(primerDia);
    inicioCalendario.setDate(primerDia.getDate() - ((primerDia.getDay() + 6) % 7));

    const resultado = [];
    const cursor = new Date(inicioCalendario);
    while (cursor <= ultimoDia) {
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const diaSemana = d.getDay();
        const estructuraDelDia = estructuraPorDia[diaSemana];

        dias.push({
          date: d,
          iso,
          diaSemana,
          esDiaMes: d.getMonth() === primerDia.getMonth(),
          tema: estructuraDelDia?.tema || estructuraDelDia?.tipo || "No definido",
          horario: estructuraDelDia?.horario || "",
          historiasDelDia: historiasPorFecha[iso] || [],
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      resultado.push(dias);
    }
    return resultado;
  }, [year, month, estructuraPorDia, historiasPorFecha]);

  if (!clienteActual) {
    return <div className="state-empty">No hay clientes cargados</div>;
  }

  return (
    <>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
        <label style={{ fontWeight: "600", color: "#333", fontSize: "14px" }}>Seleccionar cliente:</label>
        <select
          value={clienteSeleccionado}
          onChange={(e) => setClienteSeleccionado(Number(e.target.value))}
          style={{
            padding: "10px 14px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "500",
            cursor: "pointer",
            background: "white",
          }}
        >
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div style={{ background: "linear-gradient(135deg, #1565c0 0%, #1976d2 100%)", color: "white", padding: "20px", borderRadius: "8px", marginBottom: "24px", boxShadow: "0 2px 8px rgba(21,101,192,0.2)" }}>
        <h2 style={{ fontSize: "20px", margin: "0 0 8px 0", fontWeight: "700" }}>{clienteActual.nombre}</h2>
        <p style={{ fontSize: "13px", margin: "0", opacity: 0.95, display: "flex", gap: "8px" }}>
          <span>🏢 {clienteActual.rubro || "—"}</span>
          {clienteActual.frecuencia && <span>•</span>}
          {clienteActual.frecuencia && <span>📅 {clienteActual.frecuencia}</span>}
        </p>
      </div>

      <div style={{ marginBottom: "16px", fontSize: "12px", color: "#666", padding: "12px", background: "#f0f4ff", borderRadius: "6px", borderLeft: "3px solid #1976d2" }}>
        📋 <strong>{MESES[month]} {year}</strong> — Estructura día por día
      </div>

      {semanas.map((dias, semanaIdx) => {
        const semanaInicio = dias.find((d) => d.esDiaMes);
        if (!semanaInicio) return null;

        return (
          <div key={semanaIdx} style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "#1565c0", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Semana {semanaIdx + 1}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "10px",
                background: "white",
                padding: "16px",
                borderRadius: "8px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              }}
            >
              {dias.map((dia) => (
                <div
                  key={dia.iso}
                  style={{
                    background: dia.esDiaMes ? "#f5f8ff" : "#f9f9f9",
                    border: dia.esDiaMes ? "2px solid #e3f2fd" : "1px solid #e8e8e8",
                    borderRadius: "8px",
                    padding: "12px",
                    textAlign: "center",
                    minHeight: "110px",
                    display: "flex",
                    flexDirection: "column",
                    opacity: !dia.esDiaMes ? 0.4 : 1,
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "#999", marginBottom: "2px", textTransform: "uppercase" }}>
                    {DIAS_SEMANA[dia.diaSemana]}
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: "700", color: "#1976d2", marginBottom: "8px" }}>
                    {String(dia.date.getDate()).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#333", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: "1.3" }}>
                    {dia.tema}
                  </div>
                  {dia.horario && (
                    <div style={{ fontSize: "11px", color: "#1976d2", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e0e8ff", fontWeight: "500" }}>
                      🕐 {dia.horario}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function HistoriasChecklistPublicadasTab({ clientes, historias, cargando, year, month, onHistoriasActualizadas }) {
  const [error, setError] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);
  const [checks, setChecks] = useState([]);
  const [semanaSeleccionada, setSemanaSeleccionada] = useState(0);

  const hoyISO = getHoyLocalISO();
  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];

  const historiasMes = useMemo(() =>
    historias.filter((h) => h.fecha_programada && h.fecha_programada.startsWith(mesPrefix)),
    [historias, mesPrefix]
  );

  const historiasPorClienteFecha = useMemo(() =>
    historiasMes.reduce((acc, h) => {
      const key = `${h.cliente_id}:${h.fecha_programada}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(h);
      return acc;
    }, {}),
    [historiasMes]
  );

  const checksPorClienteFecha = useMemo(() =>
    checks.reduce((acc, check) => {
      acc[`${check.cliente_id}:${check.fecha}`] = check;
      return acc;
    }, {}),
    [checks]
  );

  const semanas = useMemo(() => {
    const primerDiaMes = new Date(year, month, 1);
    const ultimoDiaMes = new Date(year, month + 1, 0);
    const inicioCalendario = new Date(primerDiaMes);
    inicioCalendario.setDate(primerDiaMes.getDate() - ((primerDiaMes.getDay() + 6) % 7));
    const finCalendario = new Date(ultimoDiaMes);
    finCalendario.setDate(ultimoDiaMes.getDate() + (7 - ((ultimoDiaMes.getDay() + 6) % 7) - 1));

    const resultado = [];
    const cursor = new Date(inicioCalendario);
    while (cursor <= finCalendario) {
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        dias.push({
          date: d,
          iso,
          label: `${LETRAS_DIA[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      resultado.push(dias);
    }
    return resultado;
  }, [year, month]);

  useEffect(() => {
    const indiceActual = semanas.findIndex((dias) => dias.some((dia) => dia.iso === hoyISO));
    setSemanaSeleccionada(indiceActual >= 0 ? indiceActual : 0);
  }, [semanas, hoyISO]);

  useEffect(() => {
    const desde = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const hasta = `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`;

    fetch(`/api/check-publicacion?desde=${desde}&hasta=${hasta}`)
      .then((r) => {
        if (!r.ok) throw new Error("No se pudo cargar el checklist");
        return r.json();
      })
      .then((data) => setChecks(data))
      .catch((err) => {
        console.error("No se pudo cargar checklist de historias", err);
        setError("No se pudo cargar el estado del checklist.");
      });
  }, [year, month]);

  const { publicadas, pendientes, vencidas } = useMemo(() => {
    const pub = historiasMes.filter((h) => h.estado === "publicada").length;
    const venc = historiasMes.filter(
      (h) => h.estado !== "publicada" && h.fecha_programada < hoyISO,
    ).length;
    return { publicadas: pub, pendientes: historiasMes.length - pub, vencidas: venc };
  }, [historiasMes, hoyISO]);

  const marcarPublicada = useCallback(async (clienteId, fecha, publicada) => {
    const nuevoEstado = publicada ? "publicada" : "pendiente";
    const key = `${clienteId}:${fecha}`;
    const historiasDelDia = historiasPorClienteFecha[key] || [];

    setGuardandoId(key);
    setChecks((prev) => {
      const existe = prev.some((check) => check.cliente_id === clienteId && check.fecha === fecha);
      if (existe) {
        return prev.map((check) =>
          check.cliente_id === clienteId && check.fecha === fecha
            ? { ...check, publicado: publicada }
            : check,
        );
      }
      return [
        ...prev,
        {
          id: `local-${key}`,
          cliente_id: clienteId,
          fecha,
          publicado: publicada,
          confirmado_por: getSesion()?.usuario?.nombre || null,
        },
      ];
    });
    onHistoriasActualizadas((prev) =>
      prev.map((h) =>
        h.cliente_id === clienteId && h.fecha_programada === fecha
          ? { ...h, estado: nuevoEstado }
          : h,
      ),
    );
    try {
      const checkRes = await fetch("/api/check-publicacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId,
          fecha,
          publicado: publicada,
          confirmado_por: getSesion()?.usuario?.nombre || "Sistema",
        }),
      });
      if (!checkRes.ok) throw new Error("No se pudo guardar el OK");

      await Promise.all(
        historiasDelDia.map(async (h) => {
          const res = await fetch(`/api/historias/${h.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: nuevoEstado }),
          });
          if (!res.ok) throw new Error("No se pudo guardar");
        }),
      );
      setError(null);
    } catch (err) {
      console.error("Error actualizando checklist", err);
      setError("No se pudo actualizar el checklist. Reintentá.");
    } finally {
      setGuardandoId(null);
    }
  }, [historiasPorClienteFecha, onHistoriasActualizadas]);

  return (
    <>
      <div className="sheet-toolbar">
        <div className="sheet-stats">
          <span>{historiasMes.length} historias</span>
          <span className="ok">{publicadas} publicadas</span>
          <span className="warn">{pendientes} pendientes</span>
          {vencidas > 0 && <span className="danger">{vencidas} vencidas</span>}
        </div>
      </div>

      {error && (
        <div className="alert is-error">{error}</div>
      )}

      {cargando ? (
        <div className="state-empty">Cargando checklist…</div>
      ) : (
        <>
          <div className="check-week-navigation" aria-label="Navegación por semanas">
            <button
              type="button"
              disabled={semanaSeleccionada === 0}
              onClick={() => setSemanaSeleccionada((actual) => Math.max(0, actual - 1))}
            >Anterior</button>
            <div className="check-week-tabs">
              {semanas.map((dias, indice) => (
                <button
                  type="button"
                  key={dias[0].iso}
                  className={indice === semanaSeleccionada ? "active" : ""}
                  onClick={() => setSemanaSeleccionada(indice)}
                  aria-label={`Ver semana ${indice + 1}`}
                >{indice + 1}</button>
              ))}
            </div>
            <button
              type="button"
              disabled={semanaSeleccionada === semanas.length - 1}
              onClick={() => setSemanaSeleccionada((actual) => Math.min(semanas.length - 1, actual + 1))}
            >Siguiente</button>
          </div>
          <div className="sheet-frame check-sheet-frame">
          <div className="sheet-namebar">CHECK HISTORIAS — {MESES[month].toUpperCase()} {year}</div>
          {semanas.map((dias, semanaIndex) => {
            if (semanaIndex !== semanaSeleccionada) return null;
            const desde = dias[0];
            const hasta = dias[6];
            const esSemanaActual = dias.some((dia) => dia.iso === hoyISO);
            const totalSemana = clientes.reduce(
              (acc, c) =>
                acc +
                dias.reduce((sum, d) => {
                  const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                  const check = checksPorClienteFecha[`${c.id}:${d.iso}`];
                  const publicadaPorHistorias = items.length > 0 && items.every((h) => h.estado === "publicada");
                  return sum + (check?.publicado || publicadaPorHistorias ? 1 : 0);
                }, 0),
              0,
            );
            const totalPorDia = dias.map((d) =>
              clientes.reduce((sum, c) => {
                const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                const check = checksPorClienteFecha[`${c.id}:${d.iso}`];
                const publicadaPorHistorias = items.length > 0 && items.every((h) => h.estado === "publicada");
                return sum + (check?.publicado || publicadaPorHistorias ? 1 : 0);
              }, 0),
            );

            return (
              <table className={`check-sheet-table ${esSemanaActual ? "is-current-week" : ""}`} key={desde.iso}>
                <thead>
                  <tr>
                    <th colSpan={9} className="check-week-title">
                      SEMANA {semanaIndex + 1} — {desde.label.slice(2)} al {hasta.label.slice(2)}
                    </th>
                  </tr>
                  <tr>
                    <th className="check-client-col">Cliente</th>
                    {dias.map((d) => (
                      <th key={d.iso} className={d.iso === hoyISO ? "check-day today" : "check-day"}>
                        {d.label}
                      </th>
                    ))}
                    <th className="check-total-col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => {
                    const totalCliente = dias.reduce((sum, d) => {
                      const items = historiasPorClienteFecha[`${c.id}:${d.iso}`] || [];
                      const check = checksPorClienteFecha[`${c.id}:${d.iso}`];
                      const publicadaPorHistorias = items.length > 0 && items.every((h) => h.estado === "publicada");
                      return sum + (check?.publicado || publicadaPorHistorias ? 1 : 0);
                    }, 0);

                    return (
                      <tr key={c.id}>
                        <td className="check-client-col">{c.nombre}</td>
                        {dias.map((d) => {
                          const key = `${c.id}:${d.iso}`;
                          const items = historiasPorClienteFecha[key] || [];
                          const check = checksPorClienteFecha[key];
                          const hayHistorias = items.length > 0;
                          const publicadasDia = items.filter((h) => h.estado === "publicada").length;
                          const todasPublicadas = Boolean(check?.publicado) || (hayHistorias && publicadasDia === items.length);
                          const algunasPublicadas = !check?.publicado && publicadasDia > 0 && publicadasDia < items.length;
                          return (
                            <td
                              key={d.iso}
                              className={[
                                "check-day-cell",
                                !hayHistorias && !check?.publicado ? "empty" : "",
                                todasPublicadas ? "ok" : "",
                                algunasPublicadas ? "partial" : "",
                              ].join(" ")}
                              title={
                                hayHistorias
                                  ? `${items.length} historia${items.length > 1 ? "s" : ""} · ${publicadasDia} publicada${publicadasDia !== 1 ? "s" : ""}`
                                  : check?.publicado
                                    ? "OK marcado en checklist"
                                    : "Sin historias planificadas"
                              }
                            >
                              <button
                                type="button"
                                className="check-sheet-toggle"
                                disabled={guardandoId === key}
                                aria-label={todasPublicadas ? "Quitar OK" : "Marcar OK"}
                                onClick={() => marcarPublicada(c.id, d.iso, !todasPublicadas)}
                              >
                                {guardandoId === key ? "..." : (todasPublicadas ? "✓" : "")}
                              </button>
                            </td>
                          );
                        })}
                        <td className="check-total-col">{totalCliente}</td>
                      </tr>
                    );
                  })}
                  <tr className="check-total-row">
                    <td>Total por día</td>
                    {totalPorDia.map((total, idx) => (
                      <td key={dias[idx].iso}>{total}</td>
                    ))}
                    <td>{totalSemana}</td>
                  </tr>
                </tbody>
              </table>
            );
          })}
          </div>
        </>
      )}

      <div className="caption check-help">Elegí una semana y marcá cada día cuando las historias estén publicadas.</div>
    </>
  );
}

export function HistoriasEstructuraTab({ clientes }) {
  const [estructura, setEstructura] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [guardandoCelda, setGuardandoCelda] = useState(null);

  const DIAS_SEMANA = [
    { id: 1, label: "Lunes", abrev: "L" },
    { id: 2, label: "Martes", abrev: "M" },
    { id: 3, label: "Miércoles", abrev: "X" },
    { id: 4, label: "Jueves", abrev: "J" },
    { id: 5, label: "Viernes", abrev: "V" },
    { id: 6, label: "Sábado", abrev: "S" },
    { id: 0, label: "Domingo", abrev: "D" },
  ];

  useEffect(() => {
    setCargando(true);
    fetch("/api/estructura")
      .then((response) => parseJsonArrayResponse(response, "No se pudo cargar la estructura."))
      .then((data) => {
        setEstructura(data);
        setError(null);
      })
      .catch((err) => {
        console.error("No se pudo cargar estructura", err);
        setError("No se pudo cargar la estructura.");
      })
      .finally(() => setCargando(false));
  }, []);

  const estructuraPorClienteDia = useMemo(() => {
    const index = {};
    estructura.forEach((item) => {
      if (!index[item.cliente_id]) index[item.cliente_id] = {};
      index[item.cliente_id][item.dia_semana] = item;
    });
    return index;
  }, [estructura]);

  const guardarTema = async (clienteId, diaSemana, temaActual, temaAnterior = "") => {
    const tema = temaActual.trim();
    if (tema === String(temaAnterior || "").trim()) return;
    const celda = `${clienteId}-${diaSemana}`;
    setGuardandoCelda(celda);
    setError(null);
    try {
      const response = await fetch("/api/estructura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, dia_semana: diaSemana, tema }),
      });
      const guardada = await response.json();
      if (!response.ok) throw new Error(guardada.error || "No se pudo guardar el tema.");
      setEstructura((prev) => {
        const existe = prev.some((item) => item.cliente_id === clienteId && item.dia_semana === diaSemana);
        return existe
          ? prev.map((item) => item.cliente_id === clienteId && item.dia_semana === diaSemana ? { ...item, ...guardada } : item)
          : [...prev, guardada];
      });
    } catch (err) {
      console.error("No se pudo guardar el tema semanal", err);
      setError("No se pudo guardar el tema. Revisá la conexión y volvé a intentarlo.");
    } finally {
      setGuardandoCelda(null);
    }
  };

  if (cargando) {
    return <div className="state-empty">Cargando estructura…</div>;
  }

  return (
    <>
      {error && <PageState compact type="error" title={error} description="Los demás temas permanecen guardados." />}

      <div className="weekly-structure-heading">
        <div><h3>Temas por cliente</h3><p>Hacé clic en una celda para editar el tema habitual de cada día.</p></div>
        <span>{clientes.length} clientes</span>
      </div>

      <div className="weekly-structure-scroll">
        <table className="weekly-structure-table">
          <thead>
            <tr>
              <th>Cliente</th>
              {DIAS_SEMANA.map((dia) => (
                <th key={dia.id}>{dia.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clientes.map((cliente) => {
              const estructuraCliente = estructuraPorClienteDia[cliente.id] || {};
              return (
                <tr key={cliente.id}>
                  <th scope="row"><strong>{cliente.nombre}</strong>{cliente.rubro && <span>{cliente.rubro}</span>}</th>
                  {DIAS_SEMANA.map((dia) => {
                    const est = estructuraCliente[dia.id];
                    const celda = `${cliente.id}-${dia.id}`;
                    return (
                      <td key={dia.id} className={guardandoCelda === celda ? "is-saving" : ""}>
                        <textarea
                          aria-label={`${cliente.nombre}, ${dia.label}`}
                          defaultValue={est?.tema || ""}
                          key={`${celda}-${est?.tema || ""}`}
                          onBlur={(event) => guardarTema(cliente.id, dia.id, event.target.value, est?.tema)}
                          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
                          placeholder="Tema"
                          rows={2}
                        />
                        {guardandoCelda === celda && <span className="weekly-structure-saving">Guardando…</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </>
  );
}

export function HistoriasFechasEspecialesTab({ clientes }) {
  const [fechasEspeciales, setFechasEspeciales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("proximas");
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    setCargando(true);
    fetch("/api/fechas-especiales")
      .then((r) => r.json())
      .then((data) => {
        setFechasEspeciales(
          data.slice().sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")),
        );
        setError(null);
      })
      .catch((err) => {
        console.error("No se pudieron cargar fechas especiales", err);
        setError("No se pudieron cargar las fechas especiales.");
      })
      .finally(() => setCargando(false));
  }, []);

  const hoyISO = getHoyLocalISO();
  const estadoLabel = { pendiente: "Pendiente", en_curso: "En curso", hecho: "Hecho" };
  const clientesPorId = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nombre])), [clientes]);
  const fechasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");
    return fechasEspeciales.filter((fecha) => {
      const vencida = fecha.fecha && fecha.fecha < hoyISO && fecha.estado !== "hecho";
      const coincideFiltro = filtro === "todas"
        || (filtro === "proximas" && fecha.estado !== "hecho" && !vencida)
        || (filtro === "pendientes" && fecha.estado !== "hecho")
        || (filtro === "hechas" && fecha.estado === "hecho");
      if (!coincideFiltro) return false;
      if (!termino) return true;
      const contenido = [
        fecha.evento,
        fecha.idea,
        fecha.cliente_id ? clientesPorId[fecha.cliente_id] : "Todos",
      ].filter(Boolean).join(" ").toLocaleLowerCase("es");
      return contenido.includes(termino);
    });
  }, [busqueda, clientesPorId, fechasEspeciales, filtro, hoyISO]);

  if (cargando) {
    return <div className="state-empty">Cargando fechas especiales…</div>;
  }

  return (
    <>
      {error && (
        <div className="alert is-error">{error}</div>
      )}

      <div className="special-dates-toolbar">
        <div className="special-dates-filters" aria-label="Filtrar fechas especiales">
          {[
            ["proximas", "Próximas"],
            ["pendientes", "Pendientes"],
            ["hechas", "Hechas"],
            ["todas", "Todas"],
          ].map(([valor, etiqueta]) => (
            <button key={valor} type="button" className={filtro === valor ? "active" : ""} onClick={() => setFiltro(valor)}>{etiqueta}</button>
          ))}
        </div>
        <label className="special-dates-search">
          <span>Buscar</span>
          <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Cliente, motivo o acción" />
        </label>
      </div>

      <div className="sheet-frame special-dates-frame">
        <div className="sheet-namebar">{fechasFiltradas.length} fechas encontradas</div>
        {fechasFiltradas.length === 0 ? (
          <div className="special-dates-empty">No hay fechas que coincidan con esta búsqueda.</div>
        ) : (
          <table className="sheet-table historias-special-dates-table">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>Fecha</th>
                <th style={{ width: "170px" }}>Local</th>
                <th style={{ width: "24%" }}>Motivo</th>
                <th>Acción sugerida</th>
                <th style={{ width: "110px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {fechasFiltradas.map((f) => (
                <tr key={f.id} className={f.fecha && f.fecha < hoyISO && f.estado !== "hecho" ? "sheet-row-danger" : undefined}>
                  <td className="special-date-cell">{f.fecha || "Sin fecha"}</td>
                  <td className="special-client-cell">{f.cliente_id ? clientesPorId[f.cliente_id] || "Sin local" : "Todos"}</td>
                  <td>{f.evento || "—"}</td>
                  <td>{f.idea || "—"}</td>
                  <td>
                    <span className={`sheet-status-pill is-${f.estado || "pendiente"}`}>
                      {estadoLabel[f.estado] || f.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function FlyersMigrarBanner({ onMigrado }) {
  const [flyers, setFlyers] = useState([]);
  const [migrando, setMigrando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/publicaciones")
      .then((r) => r.json())
      .then((data) => setFlyers(data.filter((p) => p.tipo === "flyer")))
      .catch((err) => console.error("No se pudieron revisar flyers legacy", err));
  }, []);

  if (flyers.length === 0) return null;

  const migrarTodos = async () => {
    setMigrando(true);
    setError(null);
    try {
      for (const f of flyers) {
        const res = await fetch(`/api/historias/convertir-flyer/${f.id}`, { method: "POST" });
        if (!res.ok) throw new Error("Falló la conversión de un flyer");
      }
      setFlyers([]);
      onMigrado && onMigrado();
    } catch (err) {
      console.error("Error migrando flyers", err);
      setError("No se pudieron convertir todos los flyers. Reintentá.");
    } finally {
      setMigrando(false);
    }
  };

  return (
    <div style={{ background: "#fff3e0", border: "1px solid #ffb74d", borderRadius: "6px", padding: "12px 16px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
      <div style={{ fontSize: "13px", color: "#e65100" }}>
        ⚠️ Hay <strong>{flyers.length}</strong> flyer{flyers.length > 1 ? "s" : ""} viejo{flyers.length > 1 ? "s" : ""} en Publicaciones. Los flyers ahora viven dentro de Historias.
        {error && <div style={{ marginTop: "4px" }}>{error}</div>}
      </div>
      <button className="btn" type="button" disabled={migrando} onClick={migrarTodos}>
        {migrando ? "Convirtiendo…" : `Convertir ${flyers.length} a Historias`}
      </button>
    </div>
  );
}

export function ClientesRail({ clientes, clienteSeleccionado, onSeleccionar, atrasadasPorCliente, compacto, onToggleCompacto }) {
  const [busqueda, setBusqueda] = useState("");
  const filtrados = clientes.filter((c) =>
    c.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
  );

  return (
    <aside className={`h-rail ${compacto ? "compact" : ""}`}>
      <div className="h-rail-head">
        <div className="h-rail-titlebar">
          <span>Locales</span>
          <button
            type="button"
            className="h-rail-toggle"
            onClick={onToggleCompacto}
            aria-label={compacto ? "Expandir locales" : "Compactar locales"}
            title={compacto ? "Expandir locales" : "Compactar locales"}
          >
            {compacto ? ">" : "<"}
          </button>
        </div>
        {!compacto && (
          <div className="h-rail-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Buscar local…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="h-rail-list">
        {filtrados.map((c) => {
          const atrasadas = atrasadasPorCliente[c.id] || 0;
          return (
            <button
              key={c.id}
              type="button"
              className={`h-client-row ${clienteSeleccionado === c.id ? "active" : ""}`}
              onClick={() => onSeleccionar(c.id)}
              title={c.nombre}
            >
              <span className={`h-client-dot ${atrasadas > 0 ? "danger" : "ok"}`}></span>
              {compacto && <span className="h-client-initials">{getInicialesCliente(c.nombre)}</span>}
              <span className="h-client-name">{c.nombre}</span>
              {atrasadas > 0 && <span className="h-client-badge">{atrasadas}</span>}
            </button>
          );
        })}
        {filtrados.length === 0 && (
          <div className="caption" style={{ padding: "10px" }}>Sin resultados.</div>
        )}
      </div>
    </aside>
  );
}

export function HistoriasPage({ initialTab = "estructura" }) {
  const initialContext = readUrlContext(window.location.search, { vista: initialTab, cliente: "", filtro: "", mes: "" });
  const initialDate = readMonthContext(initialContext.mes, new Date().getFullYear(), new Date().getMonth());
  const [vista, setVista] = useState(
    ["estructura", "checklist", "fechas"].includes(initialContext.vista) ? initialContext.vista : "estructura",
  );
  const [clientes, setClientes] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(Number(initialContext.cliente) || null);
  // Filtro de cliente propio de la pestaña Planilla — separado de
  // clienteSeleccionado (que ya se usaba como destino por default de
  // "+ Nueva historia" en otras pestañas) para no cambiar ese comportamiento
  // existente. Vacío = "Hoja general" (todos los clientes), como hoy.
  const [filtroClientePlanilla, setFiltroClientePlanilla] = useState(
    initialContext.filtro || (initialContext.vista === "planilla" ? initialContext.cliente : "") || "",
  );
  const [errorClientes, setErrorClientes] = useState(null);
  const [refrescarKey, setRefrescarKey] = useState(0);

  const [historias, setHistorias] = useState([]);
  const [cargandoHistorias, setCargandoHistorias] = useState(true);
  const [errorHistorias, setErrorHistorias] = useState(null);
  const [estructura, setEstructura] = useState([]);
  const [ultimoIdCreado, setUltimoIdCreado] = useState(null);

  const hoyDate = new Date();
  const [year, setYear] = useState(initialDate.year);
  const [month, setMonth] = useState(initialDate.month);

  useEffect(() => {
    replaceUrlContext({ vista, cliente: clienteSeleccionado, filtro: filtroClientePlanilla, mes: formatMonthContext(year, month) });
  }, [vista, clienteSeleccionado, filtroClientePlanilla, year, month]);

  useEffect(() => {
    const restoreContext = () => {
      const context = readUrlContext(window.location.search, { vista: "estructura", cliente: "", filtro: "", mes: "" });
      const date = readMonthContext(context.mes, hoyDate.getFullYear(), hoyDate.getMonth());
      setVista(["estructura", "checklist", "fechas"].includes(context.vista) ? context.vista : "estructura");
      setClienteSeleccionado(Number(context.cliente) || null);
      setFiltroClientePlanilla(context.filtro || "");
      setYear(date.year);
      setMonth(date.month);
    };
    window.addEventListener("popstate", restoreContext);
    return () => window.removeEventListener("popstate", restoreContext);
  }, []);

  useEffect(() => {
    fetch("/api/clientes")
      .then((r) => r.json())
      .then((data) => {
        setClientes(data);
        if (data.length > 0) setClienteSeleccionado((current) => current ?? data[0].id);
      })
      .catch((err) => {
        console.error("No se pudieron cargar clientes", err);
        setErrorClientes("No se pudieron cargar los clientes.");
      });
  }, []);

  const cargarHistorias = () => {
    setCargandoHistorias(true);
    fetch("/api/historias")
      .then((r) => r.json())
      .then((data) => {
        setHistorias(data);
        setErrorHistorias(null);
      })
      .catch((err) => {
        console.error("Error cargando historias", err);
        setErrorHistorias("No se pudieron cargar las historias.");
      })
      .finally(() => setCargandoHistorias(false));
  };
  useEffect(cargarHistorias, [refrescarKey]);

  useEffect(() => {
    fetch("/api/estructura")
      .then((response) => parseJsonArrayResponse(response, "No se pudo cargar la estructura semanal."))
      .then((data) => setEstructura(data))
      .catch((err) => {
        setEstructura([]);
        console.error("No se pudo cargar la estructura semanal", err);
      });
  }, []);

  const hoyISO = getHoyLocalISO();

  const irMes = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    pushUrlContext({ mes: formatMonthContext(y, m) });
    setMonth(m);
    setYear(y);
  };
  const irAHoy = () => {
    pushUrlContext({ mes: formatMonthContext(hoyDate.getFullYear(), hoyDate.getMonth()) });
    setMonth(hoyDate.getMonth());
    setYear(hoyDate.getFullYear());
  };

  const actualizarHistoriaLocal = (historiaId, campos) => {
    setHistorias((prev) =>
      prev.map((h) => {
        if (h.id !== historiaId) return h;
        const actualizado = { ...h, ...campos };
        if (campos.metadata) actualizado.metadata = { ...(h.metadata || {}), ...campos.metadata };
        return actualizado;
      }),
    );
  };

  const guardarHistoriaEnServidor = async (historiaId, campos) => {
    try {
      const res = await fetch(`/api/historias/${historiaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
      if (!res.ok) throw new Error("No se pudo guardar");
    } catch (err) {
      console.error("Error guardando", err);
      setErrorHistorias("No se pudo guardar un cambio — reintentá.");
    }
  };

  const crearHistoria = async (clienteIdDestino, fechaISO) => {
    const res = await fetch("/api/piezas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "historia",
        cliente_id: clienteIdDestino,
        responsable: "Augusto",
        fecha_programada: fechaISO,
        estado: "pendiente",
        idea: "",
      }),
    });
    if (!res.ok) throw new Error("No se pudo crear");
    const creada = await res.json();

    // Sugerencia de tipo/hora según el patrón semanal de ese día.
    const diaSemana = new Date(`${fechaISO}T00:00:00`).getDay();
    const patron = estructura.find((e) => e.cliente_id === clienteIdDestino && e.dia_semana === diaSemana);
    let metadataSugerida = {};
    if (patron?.tema || patron?.horario) {
      const horaSugerida = patron.horario?.match(/\d{1,2}:\d{2}/)?.[0] || "";
      metadataSugerida = { tipo: patron.tema || "", hora: horaSugerida };
      await fetch(`/api/historias/${creada.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: metadataSugerida }),
      }).catch((err) => console.error("No se pudo sugerir tipo/hora", err));
    }

    setHistorias((prev) => [...prev, { ...creada, metadata: metadataSugerida }]);
    return creada.id;
  };

  // Punto de entrada único para "agregar historia": lo usan tanto el botón
  // de la barra superior (accesible sin scrollear hasta el pie de la
  // grilla) como el renglón "+" al final de la tabla — ambos crean en el
  // mismo lugar (hoy, o el día 1 si se está viendo otro mes) y enfocan la
  // fila nueva apenas aparece.
  const agregarHistoriaEnMesActual = async () => {
    // Si la Planilla está filtrada a un cliente, la historia nueva se crea
    // para ESE cliente (no tendría sentido crearla para otro mientras se
    // está mirando la hoja de uno en particular).
    const clienteDestino =
      vista === "planilla"
        ? (filtroClientePlanilla ? Number(filtroClientePlanilla) : clientes[0]?.id) || clienteSeleccionado
        : clienteSeleccionado;
    if (!clienteDestino) return;
    const hoyISOActual = getHoyLocalISO();
    const mesActualPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const iso = mesActualPrefix === hoyISOActual.slice(0, 7) ? hoyISOActual : `${mesActualPrefix}-01`;
    try {
      const id = await crearHistoria(clienteDestino, iso);
      setUltimoIdCreado(id);
    } catch (err) {
      console.error("Error creando historia", err);
      setErrorHistorias("No se pudo crear la historia.");
    }
  };

  const duplicarHistoria = async (historia) => {
    try {
      const res = await fetch("/api/piezas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "historia",
          cliente_id: historia.cliente_id,
          responsable: historia.responsable_diseño || historia.responsable || "Augusto",
          fecha_programada: historia.fecha_programada,
          estado: "pendiente",
          idea: historia.idea || "",
          copy: historia.copy || "",
          material_referencia: historia.material_referencia || "",
          aclaraciones: historia.aclaraciones || "",
          prioridad: historia.prioridad || "media",
        }),
      });
      if (!res.ok) throw new Error("No se pudo duplicar");
      const creada = await res.json();
      if (historia.metadata && Object.keys(historia.metadata).length > 0) {
        await fetch(`/api/historias/${creada.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: historia.metadata }),
        }).catch((err) => console.error("No se pudo copiar metadata al duplicar", err));
      }
      const nueva = { ...creada, metadata: historia.metadata || {} };
      setHistorias((prev) => [...prev, nueva]);
      setUltimoIdCreado(nueva.id);
    } catch (err) {
      console.error("Error duplicando historia", err);
      setErrorHistorias("No se pudo duplicar la historia.");
    }
  };

  const eliminarHistoria = async (historiaId) => {
    if (!window.confirm("¿Eliminar esta historia de la planilla?")) return;
    try {
      const res = await fetch(`/api/historias/${historiaId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setHistorias((prev) => prev.filter((h) => h.id !== historiaId));
    } catch (err) {
      console.error("Error eliminando historia", err);
      setErrorHistorias("No se pudo eliminar la historia.");
    }
  };

  const mesPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  // Cuando hay un cliente elegido en el selector de la Planilla, todo lo
  // que se ve en esa pestaña (tabla y contadores) se filtra a ese cliente
  // — sin filtro (vacío) se sigue viendo la Hoja general de siempre.
  const historiasPlanillaVisibles = filtroClientePlanilla
    ? historias.filter((h) => String(h.cliente_id) === filtroClientePlanilla)
    : historias;
  const historiasMes = historiasPlanillaVisibles.filter((h) => h.fecha_programada?.startsWith(mesPrefix));
  const publicadasMes = historiasMes.filter((h) => h.estado === "publicada").length;
  const pendientesMes = historiasMes.length - publicadasMes;
  const atrasadasMes = historiasMes.filter((h) => h.fecha_programada < hoyISO && h.estado !== "publicada").length;

  const cambiarVista = (siguienteVista) => {
    pushUrlContext({ vista: siguienteVista });
    setVista(siguienteVista);
  };

  return (
    <main aria-label="Render platform historias" className="historias-viewport">
      <div className="frame">
        <div className="content">
          <header className="module-intro">
            <div><h2>¿Qué tema trabajamos cada día?</h2><p>Organizá la estructura semanal de todos los clientes y controlá qué historias se publicaron.</p></div>
          </header>
          {(errorClientes || errorHistorias) && <PageState compact type="error" title={errorClientes || errorHistorias} description="La vista y el período siguen guardados." onRetry={() => window.location.reload()} />}

          <div className="h-workspace">
            <div className="h-main">
              <div className="h-toolbar">
                <div className="stories-view-switch" aria-label="Vistas de Historias">
                  <button type="button" className={vista === "estructura" ? "active" : ""} onClick={() => cambiarVista("estructura")}>Estructura semanal</button>
                  <button type="button" className={vista === "checklist" ? "active" : ""} onClick={() => cambiarVista("checklist")}>Checklist de historias</button>
                  <button type="button" className={vista === "fechas" ? "active" : ""} onClick={() => cambiarVista("fechas")}>Fechas especiales</button>
                </div>
              </div>

              {["planilla", "checklist"].includes(vista) && (
                <div className="stories-context-bar">
                  {vista === "planilla" && (
                    <label className="stories-context-field">
                      <span>Cliente</span>
                      <select
                        className="h-toolbar-client-select"
                        value={filtroClientePlanilla}
                        onChange={(e) => {
                          pushUrlContext({ filtro: e.target.value });
                          setFiltroClientePlanilla(e.target.value);
                        }}
                        aria-label="Filtrar planilla por cliente"
                      >
                        <option value="">Todos los clientes</option>
                        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="stories-month-control" aria-label="Período de planificación">
                    <button type="button" onClick={() => irMes(-1)} aria-label="Mes anterior">‹</button>
                    <strong>{MESES[month]} {year}</strong>
                    <button type="button" onClick={() => irMes(1)} aria-label="Mes siguiente">›</button>
                  </div>
                  <button className="h-today-btn" type="button" onClick={irAHoy}>Mes actual</button>
                </div>
              )}

              {vista === "planilla" && (
                <div className="stories-overview" aria-label="Resumen del período">
                  <div><span>Planificadas</span><strong>{historiasMes.length}</strong></div>
                  <div><span>Pendientes</span><strong>{pendientesMes}</strong></div>
                  <div className="is-success"><span>Publicadas</span><strong>{publicadasMes}</strong></div>
                  <div className={atrasadasMes > 0 ? "is-danger" : ""}><span>Atrasadas</span><strong>{atrasadasMes}</strong></div>
                </div>
              )}

              <div className="h-body">
                {vista === "planilla" && <FlyersMigrarBanner onMigrado={() => setRefrescarKey((k) => k + 1)} />}

                {vista === "planilla" && (
                  <HistoriasPlanillaTab
                    key="p-general"
                    clientes={clientes}
                    year={year}
                    month={month}
                    cargando={cargandoHistorias}
                    historias={historiasPlanillaVisibles}
                    ultimoIdCreado={ultimoIdCreado}
                    onActualizarLocal={actualizarHistoriaLocal}
                    onGuardarServidor={guardarHistoriaEnServidor}
                    onAgregar={agregarHistoriaEnMesActual}
                    onDuplicar={duplicarHistoria}
                    onEliminar={eliminarHistoria}
                    clienteFiltradoNombre={
                      filtroClientePlanilla
                        ? clientes.find((c) => String(c.id) === filtroClientePlanilla)?.nombre
                        : null
                    }
                  />
                )}

                {vista === "estructura" && (
                  <HistoriasEstructuraTab
                    key="estructura-general"
                    clientes={clientes}
                  />
                )}

                {vista === "cliente" && (
                  <HistoriasClienteTab
                    key="cliente-general"
                    clientes={clientes}
                    estructura={estructura}
                    historias={historias}
                    year={year}
                    month={month}
                  />
                )}

                {vista === "fechas" && (
                  <HistoriasFechasEspecialesTab
                    key="fechas-especiales"
                    clientes={clientes}
                  />
                )}

                {vista === "checklist" && (
                  <HistoriasChecklistPublicadasTab
                    key={`c-${refrescarKey}`}
                    clientes={clientes}
                    historias={historias}
                    cargando={cargandoHistorias}
                    year={year}
                    month={month}
                    onHistoriasActualizadas={setHistorias}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
