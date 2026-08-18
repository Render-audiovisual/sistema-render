import React, { useEffect, useState } from "react";

const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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

export function SueldosPage() {
  const requested = new URLSearchParams(window.location.search).get("periodo");
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(requested || "") && requested >= "2026-09" ? requested : currentPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  const salaryExpenses = finance?.gastos?.filter((item) => item.categoria === "sueldos") || [];
  const taxExpenses = finance?.gastos?.filter((item) => item.categoria === "impuestos") || [];
  const toolExpenses = finance?.gastos?.filter((item) => item.categoria === "herramientas") || [];

  return <main className="page-shell salary-page finance-dashboard">
    <section className="salary-hero">
      <div><span className="section-label">Finanzas · Solo Líder</span><h1>Finanzas de Render</h1><p>Ingresos y gastos mensuales calculados automáticamente.</p></div>
      <label className="finance-period-select"><span>Mes de cobro</span><input type="month" value={period} min="2026-09" onChange={(event) => setPeriod(event.target.value)} /></label>
    </section>

    {loading && <div className="salary-state">Calculando el mes…</div>}
    {error && <div className="salary-state is-error"><strong>No se pudo calcular Finanzas.</strong><span>{error}</span></div>}
    {!loading && !error && finance && <>
      <section className="finance-billing-hero"><div><span>FACTURACIÓN A COBRAR</span><small>{labelPeriod(period)} · trabajo de {labelPeriod(finance.workPeriod)}</small><strong>{ars.format(finance.facturacion)}</strong><p>Los clientes se facturan automáticamente a mes vencido.</p></div><b>Mes vencido</b></section>

      <section className="finance-metrics" aria-label="Resumen financiero automático">
        <article><span>Sueldos</span><strong>{ars.format(finance.sueldos)}</strong><small>Equipo + Franco programador</small></article>
        <article><span>Impuestos</span><strong>{ars.format(finance.impuestos)}</strong><small>Monotributo e Ingresos Brutos</small></article>
        <article><span>Herramientas ARS</span><strong>{ars.format(finance.herramientasARS)}</strong><small>Adobe, Drive y Cloud Code</small></article>
        <article><span>Herramientas USD</span><strong>{usd.format(finance.herramientasUSD)}</strong><small>Separadas hasta definir cotización</small></article>
      </section>

      <section className="finance-result-row"><div><span>RESULTADO EN PESOS</span><small>Sin convertir ni descontar los gastos en USD</small></div><strong className={finance.resultadoARS < 0 ? "is-negative" : ""}>{ars.format(finance.resultadoARS)}</strong></section>
      {data.payrollPending?.length > 0 && <div className="salary-banner"><strong>Sueldo variable pendiente:</strong> falta clasificar las piezas de {data.payrollPending.join(", ")} para completar ese importe automáticamente.</div>}

      <section className="finance-panel finance-auto-details">
        <header><div><span className="section-label">DETALLE AUTOMÁTICO</span><h2>¿De dónde sale cada número?</h2></div><small>Sin cargas manuales</small></header>
        <div className="finance-detail-columns">
          <details open><summary>Clientes · {ars.format(finance.facturacion)}</summary>{finance.ingresos.map((item) => <p key={item.nombre}><span>{item.nombre}{item.prorrateado ? ` · ${item.diasActivos}/${item.diasDelMes} días` : ""}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Sueldos · {ars.format(finance.sueldos)}</summary>{(data.payroll || []).map((item) => <p key={item.name}><span>{item.name}</span><strong>{ars.format(item.total)}</strong></p>)}{salaryExpenses.map((item) => <p key={item.nombre}><span>{item.nombre}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Impuestos · {ars.format(finance.impuestos)}</summary>{taxExpenses.map((item) => <p key={item.nombre}><span>Día {item.diaPago} · {item.nombre}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Herramientas · ARS + USD</summary>{toolExpenses.map((item) => <p key={item.nombre}><span>Día {item.diaPago} · {item.nombre}</span><strong>{item.moneda === "USD" ? usd.format(item.importe) : ars.format(item.importe)}</strong></p>)}</details>
        </div>
      </section>

      <section className="finance-panel"><header><div><span className="section-label">HISTORIAL</span><h2>Facturación mes a mes</h2></div><small>Siempre según el trabajo del mes anterior</small></header><BillingChart items={data.billingHistory} selectedPeriod={period} /></section>
      <p className="finance-disclaimer">Los USD permanecen separados y no afectan el resultado en pesos hasta que se defina una cotización.</p>
    </>}
  </main>;
}
