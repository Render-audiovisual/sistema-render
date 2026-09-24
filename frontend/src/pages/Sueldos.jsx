import React, { useEffect, useState } from "react";

const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

function currentPeriod() {
  const now = new Date();
  const calendarPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return calendarPeriod < "2026-09" ? "2026-09" : calendarPeriod;
}

function labelPeriod(period) {
  const [year, month] = String(period || currentPeriod()).split("-").map(Number);
  const label = monthLabel.format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatVariation(current, previous) {
  if (previous === undefined || previous === 0) return null;
  const delta = current - previous;
  const percent = ((delta / previous) * 100).toFixed(1);
  const sign = delta > 0 ? "+" : "";
  return { delta: Math.round(delta), percent: sign + percent, isPositive: delta > 0, isNegative: delta < 0 };
}


function BillingChart({ items = [], selectedPeriod }) {
  const visible = items.slice(-8);
  const maximum = Math.max(...visible.map((item) => item.total), 1);
  return <div className="finance-chart" role="img" aria-label="Evolución mensual de la facturación">
    {visible.map((item) => <div className={`finance-chart-column${item.period === selectedPeriod ? " is-current" : ""}`} key={item.period}>
      <strong>{ars.format(item.total)}</strong><div><i style={{ height: `${Math.max((item.total / maximum) * 100, 4)}%` }} /></div>
      <span>{labelPeriod(item.period).split(" de ")[0].slice(0, 3)}</span>
    </div>)}
  </div>;
}

function TrendChart({ data = [], title, metric, valueFormatter }) {
  if (!data || data.length === 0) return null;
  const width = 720;
  const height = 240;
  const padding = { top: 30, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  const values = data.map((item) => metric(item));
  const maxValue = Math.max(...values.filter(v => v !== null), 1);
  const minValue = Math.min(...values.filter(v => v !== null), 0);
  const range = maxValue - minValue || 1;
  
  const points = data.map((item, i) => {
    const value = metric(item);
    const x = padding.left + (i / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - minValue) / range) * chartHeight;
    return { x, y, value, period: item.period };
  });
  
  const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(181,252,0,0.3)" />
          <stop offset="100%" stopColor="rgba(181,252,0,0)" />
        </linearGradient>
      </defs>
      <path d={pathData} stroke="#b5fc00" strokeWidth="2" fill="none" />
      <polygon points={points.map(p => `${p.x},${p.y}`).join(' ') + ` ${padding.left + chartWidth},${padding.top + chartHeight} ${padding.left},${padding.top + chartHeight}`} fill="url(#gradient)" />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartHeight} stroke="var(--border)" strokeWidth="1" />
      <line x1={padding.left} y1={padding.top + chartHeight} x2={width - padding.right} y2={padding.top + chartHeight} stroke="var(--border)" strokeWidth="1" />
      {points.map((p) => (
        <g key={p.period}>
          <circle cx={p.x} cy={p.y} r="3" fill="#b5fc00" />
          <text x={p.x} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">
            {p.period.slice(5)}
          </text>
        </g>
      ))}
      <text x={padding.left} y={20} fontSize="13" fontWeight="700" fill="var(--text)">{title}</text>
    </svg>
  );
}

function ComparativeChart({ data = [], title }) {
  if (!data || data.length < 2) return null;
  const width = 720;
  const height = 240;
  const padding = { top: 30, right: 20, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barWidth = chartWidth / (data.length * 1.5);
  
  const maxValue = Math.max(...data.map(item => Math.max(item.facturacion, item.sueldos + item.gastosFijos)), 1);
  
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: '100%', height: 'auto' }}>
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartHeight} stroke="var(--border)" strokeWidth="1" />
      <line x1={padding.left} y1={padding.top + chartHeight} x2={width - padding.right} y2={padding.top + chartHeight} stroke="var(--border)" strokeWidth="1" />
      {data.map((item, i) => {
        const x = padding.left + (i / data.length) * chartWidth + chartWidth / (data.length * 2);
        const facHeight = (item.facturacion / maxValue) * chartHeight;
        const costsHeight = ((item.sueldos + item.gastosFijos) / maxValue) * chartHeight;
        return (
          <g key={item.period}>
            <rect x={x - barWidth / 3} y={padding.top + chartHeight - facHeight} width={barWidth / 3} height={facHeight} fill="#b5fc00" />
            <rect x={x} y={padding.top + chartHeight - costsHeight} width={barWidth / 3} height={costsHeight} fill="#e74c3c" />
            <text x={x + barWidth / 6} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {item.period.slice(5)}
            </text>
          </g>
        );
      })}
      <text x={padding.left} y={20} fontSize="13" fontWeight="700" fill="var(--text)">{title}</text>
    </svg>
  );
}




function ClientsPanel({ contracts, onUpdate, ars }) {
  const [editing, setEditing] = React.useState(null);
  const [newClient, setNewClient] = React.useState({ nombre: "", importe_mensual: "", inicia_el: new Date().toISOString().split('T')[0] });
  const [loading, setLoading] = React.useState(false);

  const handleAdd = async () => {
    if (!newClient.nombre || !newClient.importe_mensual) return;
    setLoading(true);
    try {
      const res = await fetch("/contratos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: newClient.nombre, importe_mensual: Number(newClient.importe_mensual), inicia_el: newClient.inicia_el }) });
      if (res.ok) { onUpdate(); setNewClient({ nombre: "", importe_mensual: "", inicia_el: new Date().toISOString().split('T')[0] }); }
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleEdit = async (id, updates) => {
    setLoading(true);
    try {
      const res = await fetch(`/contratos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
      if (res.ok) { onUpdate(); setEditing(null); }
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este cliente?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/contratos/${id}`, { method: "DELETE" });
      if (res.ok) onUpdate();
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", background: "#fafbf8" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 700 }}>Agregar cliente</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "10px", alignItems: "end" }}>
          <input type="text" placeholder="Nombre cliente" value={newClient.nombre} onChange={(e) => setNewClient({ ...newClient, nombre: e.target.value })} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px" }} />
          <input type="number" placeholder="Monto" value={newClient.importe_mensual} onChange={(e) => setNewClient({ ...newClient, importe_mensual: e.target.value })} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px" }} />
          <input type="date" value={newClient.inicia_el} onChange={(e) => setNewClient({ ...newClient, inicia_el: e.target.value })} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px" }} />
          <button onClick={handleAdd} disabled={loading || !newClient.nombre || !newClient.importe_mensual} style={{ padding: "8px 12px", background: newClient.nombre && newClient.importe_mensual ? "#b5fc00" : "#ddd", border: 0, borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>+ Agregar</button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "#f6f7f2", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px", textAlign: "left", fontWeight: 700, color: "var(--muted)" }}>Cliente</th>
              <th style={{ padding: "10px", textAlign: "right", fontWeight: 700, color: "var(--muted)" }}>Monto mensual</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Inicia</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Finaliza</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(contracts || []).map((c) => editing === c.id ? (
              <tr key={c.id} style={{ background: "#fff7e9", borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px" }}><input type="text" defaultValue={c.nombre} id={`name-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px" }} /></td>
                <td style={{ padding: "10px" }}><input type="number" defaultValue={c.importe_mensual} id={`amount-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px", textAlign: "right" }} /></td>
                <td style={{ padding: "10px" }}><input type="date" defaultValue={c.inicia_el} id={`start-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px" }} /></td>
                <td style={{ padding: "10px" }}><input type="date" defaultValue={c.finaliza_el || ""} id={`end-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px" }} /></td>
                <td style={{ padding: "10px", textAlign: "center" }}><button onClick={() => handleEdit(c.id, { nombre: document.getElementById(`name-${c.id}`).value, importe_mensual: Number(document.getElementById(`amount-${c.id}`).value), inicia_el: document.getElementById(`start-${c.id}`).value, finaliza_el: document.getElementById(`end-${c.id}`).value || null })} style={{ padding: "4px 8px", background: "#b5fc00", border: 0, borderRadius: "4px", cursor: "pointer", fontSize: "11px", marginRight: "4px" }}>✓</button><button onClick={() => setEditing(null)} style={{ padding: "4px 8px", background: "#ddd", border: 0, borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>✕</button></td>
              </tr>
            ) : (
              <tr key={c.id} style={{ borderBottom: "1px solid #eceee7" }}>
                <td style={{ padding: "10px" }}>{c.nombre}</td>
                <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{ars.format(c.importe_mensual)}</td>
                <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>{c.inicia_el}</td>
                <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>{c.finaliza_el || "—"}</td>
                <td style={{ padding: "10px", textAlign: "center" }}><button onClick={() => setEditing(c.id)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", fontSize: "11px", marginRight: "4px" }}>Editar</button><button onClick={() => handleDelete(c.id)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #ffcccc", color: "#cc3333", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>Eliminar</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


) {
  const [editing, setEditing] = React.useState(null);
  const [newClient, setNewClient] = React.useState({ nombre: "", importe_mensual: "", inicia_el: new Date().toISOString().split('T')[0] });
  const [loading, setLoading] = React.useState(false);

  const handleAdd = async () => {
    if (!newClient.nombre || !newClient.importe_mensual) return;
    setLoading(true);
    try {
      const res = await fetch("/contratos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: newClient.nombre, importe_mensual: Number(newClient.importe_mensual), inicia_el: newClient.inicia_el, finaliza_el: newClient.finaliza_el || null }) });
      if (res.ok) { onUpdate(); setNewClient({ nombre: "", importe_mensual: "", inicia_el: new Date().toISOString().split('T')[0] }); }
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleEdit = async (id, updates) => {
    setLoading(true);
    try {
      const res = await fetch(`/contratos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
      if (res.ok) { onUpdate(); setEditing(null); }
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const handleToggleActive = async (id, currentActive) => {
    await handleEdit(id, { activo: !currentActive });
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar este cliente?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/contratos/${id}`, { method: "DELETE" });
      if (res.ok) onUpdate();
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", background: "#fafbf8" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 700 }}>Agregar cliente</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: "10px", alignItems: "end" }}>
          <input type="text" placeholder="Nombre cliente" value={newClient.nombre} onChange={(e) => setNewClient({ ...newClient, nombre: e.target.value })} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px" }} />
          <input type="number" placeholder="Monto" value={newClient.importe_mensual} onChange={(e) => setNewClient({ ...newClient, importe_mensual: e.target.value })} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px" }} />
          <input type="date" value={newClient.inicia_el} onChange={(e) => setNewClient({ ...newClient, inicia_el: e.target.value })} style={{ padding: "8px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px" }} />
          <button onClick={handleAdd} disabled={loading || !newClient.nombre || !newClient.importe_mensual} style={{ padding: "8px 12px", background: newClient.nombre && newClient.importe_mensual ? "#b5fc00" : "#ddd", border: 0, borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>+ Agregar</button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "#f6f7f2", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px", textAlign: "left", fontWeight: 700, color: "var(--muted)" }}>Cliente</th>
              <th style={{ padding: "10px", textAlign: "right", fontWeight: 700, color: "var(--muted)" }}>Monto mensual</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Inicia</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Finaliza</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Estado</th>
              <th style={{ padding: "10px", textAlign: "center", fontWeight: 700, color: "var(--muted)" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(contracts || []).map((c) => editing === c.id ? (
              <tr key={c.id} style={{ background: "#fff7e9", borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px" }}><input type="text" defaultValue={c.nombre} id={`name-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px" }} /></td>
                <td style={{ padding: "10px" }}><input type="number" defaultValue={c.importe_mensual} id={`amount-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px", textAlign: "right" }} /></td>
                <td style={{ padding: "10px" }}><input type="date" defaultValue={c.inicia_el} id={`start-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px" }} /></td>
                <td style={{ padding: "10px" }}><input type="date" defaultValue={c.finaliza_el || ""} id={`end-${c.id}`} style={{ width: "100%", padding: "4px", fontSize: "12px" }} /></td>
                <td style={{ padding: "10px", textAlign: "center" }}>{c.activo ? "✓ Activo" : "✕ Inactivo"}</td>
                <td style={{ padding: "10px", textAlign: "center" }}><button onClick={() => handleEdit(c.id, { nombre: document.getElementById(`name-${c.id}`).value, importe_mensual: Number(document.getElementById(`amount-${c.id}`).value), inicia_el: document.getElementById(`start-${c.id}`).value, finaliza_el: document.getElementById(`end-${c.id}`).value || null })} style={{ padding: "4px 8px", background: "#b5fc00", border: 0, borderRadius: "4px", cursor: "pointer", fontSize: "11px", marginRight: "4px" }}>✓</button><button onClick={() => setEditing(null)} style={{ padding: "4px 8px", background: "#ddd", border: 0, borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>✕</button></td>
              </tr>
            ) : (
              <tr key={c.id} style={{ borderBottom: "1px solid #eceee7", opacity: c.activo ? 1 : 0.5, textDecoration: c.activo ? "none" : "line-through" }}>
                <td style={{ padding: "10px", color: c.activo ? "var(--text)" : "var(--muted)" }}>{c.nombre}</td>
                <td style={{ padding: "10px", textAlign: "right", fontWeight: 700, color: c.activo ? "var(--text)" : "var(--muted)" }}>{ars.format(c.importe_mensual)}</td>
                <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>{c.inicia_el}</td>
                <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>{c.finaliza_el || "—"}</td>
                <td style={{ padding: "10px", textAlign: "center" }}><button onClick={() => handleToggleActive(c.id, c.activo)} style={{ padding: "4px 8px", background: c.activo ? "#2d5a4e" : "#ffcccc", color: c.activo ? "#fff" : "#cc3333", border: 0, borderRadius: "4px", cursor: "pointer", fontSize: "11px", marginRight: "4px", fontWeight: 700 }}>{c.activo ? "✓ Activo" : "✕ Baja"}</button></td>
                <td style={{ padding: "10px", textAlign: "center" }}><button onClick={() => setEditing(c.id)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", fontSize: "11px", marginRight: "4px" }}>Editar</button><button onClick={() => handleDelete(c.id)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #ffcccc", color: "#cc3333", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>Eliminar</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export function SueldosPage() {
  const requested = new URLSearchParams(window.location.search).get("periodo");
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(requested || "") && requested >= "2026-09" ? requested : currentPeriod());
  const [data, setData] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadContracts = async () => {
    try {
      const res = await fetch("/contratos");
      if (res.ok) setContracts(await res.json());
    } catch (error) {
      console.error("Error cargando contratos:", error);
    }
  };

  useEffect(() => {
    loadContracts();
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("periodo", period);
    window.history.replaceState({}, "", url);
    setLoading(true);
    setError("");
    fetch(`/api/sueldos?periodo=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "No se pudo calcular el período.");
        return body;
      })
      .then(setData)
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [period]);

  const finance = data?.finance;
  const previousFinance = data?.previousFinance;
  const exchangeRate = data?.exchangeRate;
  const salaryExpenses = finance?.gastos?.filter((item) => item.categoria === "sueldos") || [];
  const taxExpenses = finance?.gastos?.filter((item) => item.categoria === "impuestos") || [];
  const toolExpenses = finance?.gastos?.filter((item) => item.categoria === "herramientas") || [];

  const facturacionVariation = finance && previousFinance ? formatVariation(finance.facturacion, previousFinance.facturacion) : null;
  const sueldosVariation = finance && previousFinance ? formatVariation(finance.sueldos, previousFinance.sueldos) : null;
  const gastosVariation = finance && previousFinance ? formatVariation(finance.gastosFijosARS, previousFinance.gastosFijosARS) : null;
  const resultadoVariation = finance && previousFinance ? formatVariation(finance.resultadoARS, previousFinance.resultadoARS) : null;
  const margen = finance && finance.facturacion > 0 ? ((finance.resultadoARS / finance.facturacion) * 100).toFixed(1) : 0;

  return <main className="page-shell salary-page finance-dashboard">
    <section className="salary-hero">
      <div><span className="section-label">Finanzas · Solo Líder</span><h1>Finanzas de Render</h1><p>Ingresos y gastos mensuales calculados automáticamente.</p></div>
      <label className="finance-period-select"><span>Mes de cobro</span><input type="month" value={period} min="2026-09" onChange={(event) => setPeriod(event.target.value)} /></label>
    </section>

    {loading && <div className="salary-state">Calculando el mes…</div>}
    {error && <div className="salary-state is-error"><strong>No se pudo calcular Finanzas.</strong><span>{error}</span></div>}
    {!loading && !error && finance && <>
      <section className="finance-billing-hero"><div><span>FACTURACIÓN A COBRAR</span><small>{labelPeriod(period)} · trabajo de {labelPeriod(finance.workPeriod)}</small><strong>{ars.format(finance.facturacion)}</strong><p>Los clientes se facturan automáticamente a mes vencido.</p></div><b>Mes vencido</b></section>

      <section className="finance-metrics finance-metrics-unified" aria-label="Resumen financiero automático">
        <article>
          <span>Equipo</span>
          <strong>{ars.format(finance.sueldos)}</strong>
          {sueldosVariation && <small style={{color: sueldosVariation.isNegative ? '#2d5a4e' : sueldosVariation.isPositive ? '#a7322a' : 'var(--muted)', fontSize: '11px', marginTop: '4px'}}>
            {sueldosVariation.isNegative ? '↓' : '↑'} {ars.format(sueldosVariation.delta)} ({sueldosVariation.percent}%)
          </small>}
          <small>Total mensual de sueldos</small>
        </article>
        <article>
          <span>Gastos fijos</span>
          <strong>{ars.format(finance.gastosFijosARS)}</strong>
          {gastosVariation && <small style={{color: gastosVariation.isNegative ? '#2d5a4e' : gastosVariation.isPositive ? '#a7322a' : 'var(--muted)', fontSize: '11px', marginTop: '4px'}}>
            {gastosVariation.isNegative ? '↓' : '↑'} {ars.format(gastosVariation.delta)} ({gastosVariation.percent}%)
          </small>}
          <small>Impuestos y herramientas, todo convertido a pesos</small>
        </article>
      </section>

      <section className="finance-result-row">
        <div>
          <span>RESULTADO DEL MES</span>
          <small>Facturación menos equipo y gastos fijos · Margen: <strong>{margen}%</strong></small>
          {resultadoVariation && <small style={{color: resultadoVariation.isNegative ? '#2d5a4e' : resultadoVariation.isPositive ? '#a7322a' : 'var(--muted)', fontSize: '11px', marginTop: '2px'}}>
            {resultadoVariation.isNegative ? '↓' : '↑'} {ars.format(resultadoVariation.delta)} ({resultadoVariation.percent}%)
          </small>}
        </div>
        <strong className={finance.resultadoARS < 0 ? "is-negative" : ""}>{ars.format(finance.resultadoARS)}</strong>
      </section>
      <div className={`finance-exchange-note${exchangeRate?.fallback ? " is-fallback" : ""}`}>
        <span>Dólar usado para ChatGPT y Contabo</span>
        <strong>{ars.format(exchangeRate?.rounded || 0)} por USD</strong>
        <small>Cotización tarjeta vendedor: {ars.format(exchangeRate?.original || 0)}, redondeada hacia arriba · {exchangeRate?.source}</small>
      </div>
      {data.payrollPending?.length > 0 && <div className="salary-banner"><strong>Sueldo variable pendiente:</strong> falta clasificar las piezas de {data.payrollPending.join(", ")} para completar ese importe automáticamente.</div>}

      <section className="finance-panel">
        <header><div><span className="section-label">CLIENTES</span><h2>Ingresos por cliente</h2></div></header>
        <div className="finance-client-table">
          <div className="finance-client-row is-heading">
            <div>Cliente</div>
            <div>Monto facturado</div>
            <div style={{textAlign: 'right'}}>% del total</div>
          </div>
          {finance.ingresos.sort((a, b) => b.importe - a.importe).map((cliente) => (
            <div key={cliente.nombre} className="finance-client-row">
              <div>{cliente.nombre}</div>
              <div><strong>{ars.format(cliente.importe)}</strong></div>
              <div style={{textAlign: 'right'}}><strong>{((cliente.importe / finance.facturacion) * 100).toFixed(1)}%</strong></div>
            </div>
          ))}
        </div>
      </section>


      <section className="finance-panel">
        <header><div><span className="section-label">ADMINISTRACIÓN</span><h2>Gestionar contratos de clientes</h2></div><small>Edita montos, fechas de inicio/fin, agrega o elimina clientes</small></header>
        <ClientsPanel contracts={contracts} onUpdate={loadContracts} ars={ars} />
      </section>

      <section className="finance-panel">
        <header><div><span className="section-label">TENDENCIAS</span><h2>Resultado y margen histórico</h2></div></header>
        <div style={{display: 'grid', gap: '24px'}}>
          <div>
            <TrendChart 
              data={data.billingHistory.slice(-12)} 
              title="Resultado del mes (últimos 12 meses)" 
              metric={(item) => item.resultado}
              valueFormatter={(value) => ars.format(value)}
            />
          </div>
          <div>
            <TrendChart 
              data={data.billingHistory.slice(-12)} 
              title="Margen % (últimos 12 meses)" 
              metric={(item) => item.margen}
              valueFormatter={(value) => `${value.toFixed(1)}%`}
            />
          </div>
          <div>
            <ComparativeChart 
              data={data.billingHistory.slice(-12)} 
              title="Facturación vs Gastos (últimos 12 meses)"
            />
          </div>
        </div>
      </section>

      <section className="finance-panel finance-auto-details">
        <header><div><span className="section-label">DETALLE AUTOMÁTICO</span><h2>¿De dónde sale cada número?</h2></div><small>Sin cargas manuales</small></header>
        <div className="finance-detail-columns">
          <details open><summary>Clientes · {ars.format(finance.facturacion)}</summary>{finance.ingresos.map((item) => <p key={item.nombre}><span>{item.nombre}{item.prorrateado ? ` · ${item.diasActivos}/${item.diasDelMes} días` : ""}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Equipo · {ars.format(finance.sueldos)}</summary>{(data.payroll || []).map((item) => <p key={item.name}><span>{item.name}</span><strong>{ars.format(item.total)}</strong></p>)}{salaryExpenses.map((item) => <p key={item.nombre}><span>{item.nombre}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Gastos fijos · {ars.format(finance.gastosFijosARS)}</summary>{taxExpenses.map((item) => <p key={item.nombre}><span>Día {item.diaPago} · {item.nombre}</span><strong>{ars.format(item.importe)}</strong></p>)}{toolExpenses.map((item) => <p key={item.nombre}><span>Día {item.diaPago} · {item.nombre}{item.moneda === "USD" ? ` · USD ${item.importe}` : ""}</span><strong>{ars.format(item.moneda === "USD" ? item.importe * (exchangeRate?.rounded || 0) : item.importe)}</strong></p>)}</details>
        </div>
      </section>

      <section className="finance-panel"><header><div><span className="section-label">HISTORIAL</span><h2>Facturación mes a mes</h2></div><small>Siempre según el trabajo del mes anterior</small></header><BillingChart items={data.billingHistory} selectedPeriod={period} /></section>
      <p className="finance-disclaimer">Los consumos en USD se convierten con dólar tarjeta vendedor y se redondean hacia arriba al próximo múltiplo de $100.</p>
    </>}
  </main>;
}
