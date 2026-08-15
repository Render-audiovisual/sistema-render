import React, { useEffect, useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function labelPeriod(period) {
  const [year, month] = String(period || currentPeriod()).split("-").map(Number);
  const label = monthLabel.format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function BillingChart({ items = [], selectedPeriod }) {
  const visible = items.slice(-8);
  const maximum = Math.max(...visible.map((item) => item.total), 1);
  if (!visible.length) return <div className="finance-empty">Todavía no hay meses con facturación configurada.</div>;
  return (
    <div className="finance-chart" role="img" aria-label="Evolución mensual de la facturación">
      {visible.map((item) => (
        <div className={`finance-chart-column${item.period === selectedPeriod ? " is-current" : ""}`} key={item.period}>
          <strong>{money.format(item.total)}</strong>
          <div><i style={{ height: `${Math.max((item.total / maximum) * 100, 4)}%` }} /></div>
          <span>{labelPeriod(item.period).split(" de ")[0].slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}

export function SueldosPage() {
  const requested = new URLSearchParams(window.location.search).get("periodo");
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(requested || "") ? requested : currentPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("periodo", period);
    window.history.replaceState({}, "", url);
    setLoading(true);
    setError("");
    fetch(`/api/sueldos?periodo=${encodeURIComponent(period)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo calcular el período.");
        return body;
      })
      .then((body) => {
        setData(body);
        const available = body.finance?.availablePeriods || [];
        if (available.length && !available.includes(period)) setPeriod(available.at(-1));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [period]);

  const comparison = useMemo(() => {
    const history = data?.finance?.billingHistory || [];
    const index = history.findIndex((item) => item.period === period);
    if (index <= 0) return null;
    const current = history[index].total;
    const previous = history[index - 1].total;
    if (!previous) return null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }, [data, period]);

  const finance = data?.finance;
  const clients = data?.clientIncome?.items || [];
  return (
    <main className="page-shell salary-page finance-dashboard">
      <section className="salary-hero">
        <div>
          <span className="section-label">Finanzas · Solo Líder</span>
          <h1>Facturación de Render</h1>
          <p>Una lectura ejecutiva de ingresos, sueldos y resultado mensual estimado.</p>
        </div>
        <label className="finance-period-select">
          <span>Período</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            {(finance?.availablePeriods?.length ? finance.availablePeriods : [period]).map((item) => (
              <option key={item} value={item}>{labelPeriod(item)}</option>
            ))}
          </select>
        </label>
      </section>

      {loading && <div className="salary-state">Calculando la facturación del mes…</div>}
      {error && <div className="salary-state is-error"><strong>No se pudo cargar Finanzas.</strong><span>{error}</span></div>}
      {!loading && !error && data && <>
        <section className="finance-billing-hero">
          <div>
            <span>RENDER FACTURA</span>
            <small>{labelPeriod(period)}</small>
            <strong>{money.format(finance?.billing || 0)}</strong>
            <p>Suma mensual de los servicios activos. No depende de cobranzas.</p>
          </div>
          {comparison != null && <b className={comparison >= 0 ? "is-positive" : "is-negative"}>{comparison >= 0 ? "+" : ""}{comparison}% vs. mes anterior</b>}
        </section>

        <section className="finance-metrics" aria-label="Resumen financiero mensual">
          <article><span>Sueldos a pagar</span><strong>{money.format(finance?.committedPayroll || 0)}</strong><small>Compromiso mensual completo</small></article>
          <article><span>Devengado hasta hoy</span><strong>{money.format(finance?.accruedPayroll || 0)}</strong><small>Según el trabajo registrado</small></article>
          <article className="is-result"><span>Resultado estimado</span><strong>{money.format(finance?.estimatedResult || 0)}</strong><small>Facturación menos sueldos comprometidos</small></article>
          <article><span>Margen estimado</span><strong>{finance?.estimatedMargin || 0}%</strong><small>No representa ganancia neta</small></article>
        </section>

        <section className="finance-panel">
          <header><div><span className="section-label">EVOLUCIÓN MENSUAL</span><h2>¿Render está creciendo?</h2></div><small>Últimos meses con información disponible</small></header>
          <BillingChart items={finance?.billingHistory} selectedPeriod={period} />
        </section>

        <section className="finance-panel finance-clients">
          <header><div><span className="section-label">ORIGEN DE LA FACTURACIÓN</span><h2>Clientes activos</h2></div><strong>{clients.length} configurados</strong></header>
          <div className="finance-client-table">
            <div className="finance-client-row is-heading"><span>Cliente</span><span>Servicios activos</span><span>Facturación mensual</span></div>
            {clients.map((client) => (
              <div className="finance-client-row" key={client.id}>
                <strong>{client.name}</strong>
                <span>{client.services?.length ? client.services.join(" · ") : "Servicio sin cuota cargada"}</span>
                <b>{money.format(client.amount)}</b>
              </div>
            ))}
            <footer><span>TOTAL FACTURACIÓN RENDER</span><strong>{money.format(finance?.billing || 0)}</strong></footer>
          </div>
        </section>

        {data.summary?.pendingConfigurations?.length > 0 && <div className="salary-banner"><strong>Cálculo de sueldos incompleto:</strong> falta definir el valor por pieza de {data.summary.pendingConfigurations.join(", ")}.</div>}
        <p className="finance-disclaimer">Este tablero es una estimación de gestión. No incluye cobranzas, impuestos, herramientas, proveedores ni otros costos operativos.</p>
      </>}
    </main>
  );
}
