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
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous)) || Number(previous) === 0) return null;
  const delta = current - previous;
  const percent = ((delta / previous) * 100).toFixed(1);
  const sign = delta > 0 ? "+" : "";
  return { delta: Math.round(delta), percent: sign + percent, isPositive: delta > 0, isNegative: delta < 0 };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
  return body;
}

function BillingChart({ items = [], selectedPeriod }) {
  const visible = items.slice(-8);
  const maximum = Math.max(...visible.map((item) => Number(item.total || 0)), 1);
  return <div className="finance-chart" role="img" aria-label="Evolución mensual de la facturación">
    {visible.map((item) => <div className={`finance-chart-column${item.period === selectedPeriod ? " is-current" : ""}`} key={item.period}>
      <strong>{ars.format(item.total || 0)}</strong><div><i style={{ height: `${Math.max(((item.total || 0) / maximum) * 100, 4)}%` }} /></div>
      <span>{labelPeriod(item.period).split(" de ")[0].slice(0, 3)}</span>
    </div>)}
  </div>;
}

function ClientsPanel({ contracts, onUpdate, ars }) {
  const [editing, setEditing] = React.useState(null);
  const [newClient, setNewClient] = React.useState({ nombre: "", importe_mensual: "", inicia_el: new Date().toISOString().split('T')[0] });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleAdd = async () => {
    if (!newClient.nombre || !newClient.importe_mensual) return;
    setLoading(true);
    setError("");
    try {
      await requestJson("/api/contratos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: newClient.nombre, importe_mensual: Number(newClient.importe_mensual), inicia_el: newClient.inicia_el, finaliza_el: newClient.finaliza_el || null }) });
      await onUpdate();
      setNewClient({ nombre: "", importe_mensual: "", inicia_el: new Date().toISOString().split('T')[0] });
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  };

  const handleEdit = async (id, updates) => {
    setLoading(true);
    setError("");
    try {
      await requestJson(`/api/contratos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
      await onUpdate();
      setEditing(null);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  };

  const handleToggleActive = async (id, currentActive) => {
    await handleEdit(id, { activo: !currentActive });
  };

  return (
    <div className="finance-contracts">
      {error && <div className="salary-state is-error"><strong>No se pudo actualizar el contrato.</strong><span>{error}</span></div>}
      <section className="finance-contract-add" aria-labelledby="finance-add-client-title">
        <h3 id="finance-add-client-title">Agregar cliente</h3>
        <div className="finance-contract-add-grid">
          <label>
            <span>Cliente</span>
            <input type="text" placeholder="Nombre del cliente" value={newClient.nombre} onChange={(event) => setNewClient({ ...newClient, nombre: event.target.value })} />
          </label>
          <label>
            <span>Monto mensual</span>
            <input type="number" min="0" placeholder="Monto" value={newClient.importe_mensual} onChange={(event) => setNewClient({ ...newClient, importe_mensual: event.target.value })} />
          </label>
          <label>
            <span>Inicia</span>
            <input type="date" value={newClient.inicia_el} onChange={(event) => setNewClient({ ...newClient, inicia_el: event.target.value })} />
          </label>
          <label>
            <span>Finaliza <small>(opcional)</small></span>
            <input type="date" value={newClient.finaliza_el || ""} onChange={(event) => setNewClient({ ...newClient, finaliza_el: event.target.value })} />
          </label>
          <button type="button" className="finance-contract-primary" onClick={handleAdd} disabled={loading || !newClient.nombre || !newClient.importe_mensual}>
            {loading ? "Guardando…" : "+ Agregar"}
          </button>
        </div>
      </section>

      <div className="finance-contract-list">
        <div className="finance-contract-list-heading" aria-hidden="true">
          <span>Cliente</span><span>Monto mensual</span><span>Inicia</span><span>Finaliza</span><span>Estado</span><span>Acciones</span>
        </div>
        {(contracts || []).map((contract) => editing === contract.id ? (
          <article className="finance-contract-card is-editing" key={contract.id}>
            <label className="finance-contract-field is-name"><span>Cliente</span><input type="text" defaultValue={contract.nombre} id={`name-${contract.id}`} /></label>
            <label className="finance-contract-field is-amount"><span>Monto mensual</span><input type="number" min="0" defaultValue={contract.importe_mensual} id={`amount-${contract.id}`} /></label>
            <label className="finance-contract-field"><span>Inicia</span><input type="date" defaultValue={contract.inicia_el} id={`start-${contract.id}`} /></label>
            <label className="finance-contract-field"><span>Finaliza</span><input type="date" defaultValue={contract.finaliza_el || ""} id={`end-${contract.id}`} /></label>
            <div className="finance-contract-field is-status"><span>Estado</span><strong>{contract.activo ? "Activo" : "Inactivo"}</strong></div>
            <div className="finance-contract-actions">
              <button type="button" className="finance-contract-primary" disabled={loading} onClick={() => handleEdit(contract.id, { nombre: document.getElementById(`name-${contract.id}`).value, importe_mensual: Number(document.getElementById(`amount-${contract.id}`).value), inicia_el: document.getElementById(`start-${contract.id}`).value, finaliza_el: document.getElementById(`end-${contract.id}`).value || null })}>Guardar</button>
              <button type="button" className="finance-contract-secondary" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </article>
        ) : (
          <article className={`finance-contract-card${contract.activo ? "" : " is-inactive"}`} key={contract.id}>
            <div className="finance-contract-field is-name"><span>Cliente</span><strong>{contract.nombre}</strong></div>
            <div className="finance-contract-field is-amount"><span>Monto mensual</span><strong>{ars.format(contract.importe_mensual)}</strong></div>
            <div className="finance-contract-field"><span>Inicia</span><b>{contract.inicia_el}</b></div>
            <div className="finance-contract-field"><span>Finaliza</span><b>{contract.finaliza_el || "Sin fecha"}</b></div>
            <div className="finance-contract-field is-status">
              <span>Estado</span>
              <button type="button" className={`finance-contract-status ${contract.activo ? "is-active" : "is-disabled"}`} disabled={loading} onClick={() => handleToggleActive(contract.id, contract.activo)} aria-label={`${contract.activo ? "Dar de baja" : "Reactivar"} a ${contract.nombre}`}>{contract.activo ? "Activo" : "Baja"}</button>
            </div>
            <div className="finance-contract-actions"><button type="button" className="finance-contract-secondary" onClick={() => setEditing(contract.id)}>Editar</button></div>
          </article>
        ))}
        {!contracts?.length && <div className="finance-empty">Todavía no hay contratos cargados.</div>}
      </div>
    </div>
  );
}


export function SueldosPage() {
  const requested = new URLSearchParams(window.location.search).get("periodo");
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(requested || "") && requested >= "2026-09" ? requested : currentPeriod());
  const [data, setData] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadContracts = async () => {
    const body = await requestJson("/api/contratos", { cache: "no-store" });
    setContracts(body);
  };

  const refreshFinance = async () => {
    await loadContracts();
    setRefreshVersion((version) => version + 1);
  };

  useEffect(() => {
    loadContracts().catch((reason) => setError(reason.message));
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
  }, [period, refreshVersion]);

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
      <section className="finance-billing-hero"><div><span>FACTURACIÓN A COBRAR</span><small>{labelPeriod(period)} · trabajo de {labelPeriod(finance.workPeriod)}</small><strong>{ars.format(finance.facturacion)}</strong><p>Los clientes se facturan automáticamente a mes vencido.{facturacionVariation ? ` Variación contra el mes anterior: ${facturacionVariation.percent}%.` : ""}</p></div><b>Mes vencido</b></section>

      <section className="finance-metrics" aria-label="Resumen financiero automático">
        <article style={{background: '#f0f4f8', borderColor: '#d4dce5'}}>
          <span>📊 Resultado</span>
          <strong style={{fontSize: '28px', color: finance.resultadoARS >= 0 ? '#2d5a4e' : '#a7322a'}}>{ars.format(finance.resultadoARS)}</strong>
          <small style={{color: 'var(--muted)', marginTop: '4px'}}>Margen: <strong>{margen}%</strong></small>
          {resultadoVariation && <small style={{color: resultadoVariation.isNegative ? '#a7322a' : '#2d5a4e', fontSize: '11px'}}>{resultadoVariation.isNegative ? '↓' : '↑'} {resultadoVariation.percent}%</small>}
        </article>
        <article style={{background: '#fff7e9', borderColor: '#e7c99e'}}>
          <span>💵 Facturación</span>
          <strong style={{fontSize: '28px', color: '#755315'}}>{ars.format(finance.facturacion)}</strong>
          <small style={{color: 'var(--muted)', marginTop: '4px'}}>Clientes activos: <strong>{finance.ingresos.length}</strong></small>
          {facturacionVariation && <small style={{color: facturacionVariation.isNegative ? '#a7322a' : '#2d5a4e', fontSize: '11px'}}>{facturacionVariation.isNegative ? '↓' : '↑'} {facturacionVariation.percent}%</small>}
        </article>
        <article style={{background: '#f0f8f4', borderColor: '#d4e5dc'}}>
          <span>👥 Equipo</span>
          <strong style={{fontSize: '28px', color: '#556b7f'}}>{ars.format(finance.sueldos)}</strong>
          <small style={{color: 'var(--muted)', marginTop: '4px'}}>Total de sueldos</small>
          {sueldosVariation && <small style={{color: sueldosVariation.isNegative ? '#2d5a4e' : '#a7322a', fontSize: '11px'}}>{sueldosVariation.isNegative ? '↓' : '↑'} {sueldosVariation.percent}%</small>}
        </article>
        <article style={{background: '#f8f0f0', borderColor: '#e5d4d4'}}>
          <span>📋 Gastos fijos</span>
          <strong style={{fontSize: '28px', color: '#9b4f4f'}}>{ars.format(finance.gastosFijosARS)}</strong>
          <small style={{color: 'var(--muted)', marginTop: '4px'}}>Impuestos + herramientas</small>
          {gastosVariation && <small style={{color: gastosVariation.isNegative ? '#2d5a4e' : '#a7322a', fontSize: '11px'}}>{gastosVariation.isNegative ? '↓' : '↑'} {gastosVariation.percent}%</small>}
        </article>
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
          {[...finance.ingresos].sort((a, b) => b.importe - a.importe).map((cliente) => (
            <div key={cliente.nombre} className="finance-client-row">
              <div>{cliente.nombre}</div>
              <div><strong>{ars.format(cliente.importe)}</strong></div>
              <div style={{textAlign: 'right'}}><strong>{finance.facturacion > 0 ? ((cliente.importe / finance.facturacion) * 100).toFixed(1) : "0.0"}%</strong></div>
            </div>
          ))}
        </div>
      </section>


      <section className="finance-panel">
        <header><div><span className="section-label">ADMINISTRACIÓN</span><h2>Gestionar contratos de clientes</h2></div><small>Editá montos y fechas, agregá clientes o dales de baja sin borrar el historial</small></header>
        <ClientsPanel contracts={contracts} onUpdate={refreshFinance} ars={ars} />
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
