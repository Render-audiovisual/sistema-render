import React, { useEffect, useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const EMPTY_VALUES = { facturacion: 0, sueldos: 0, impuestos: 0, herramientas: 0 };

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
  if (!visible.length) return <div className="finance-empty">Cargá el primer mes para comenzar el historial.</div>;
  return <div className="finance-chart" role="img" aria-label="Evolución mensual de la facturación">
    {visible.map((item) => <div className={`finance-chart-column${item.period === selectedPeriod ? " is-current" : ""}`} key={item.period}>
      <strong>{money.format(item.total)}</strong>
      <div><i style={{ height: `${Math.max((item.total / maximum) * 100, 4)}%` }} /></div>
      <span>{labelPeriod(item.period).split(" de ")[0].slice(0, 3)}</span>
    </div>)}
  </div>;
}

export function SueldosPage() {
  const requested = new URLSearchParams(window.location.search).get("periodo");
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(requested || "") ? requested : currentPeriod());
  const [values, setValues] = useState(EMPTY_VALUES);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    fetch(`/api/sueldos?periodo=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "No se pudo cargar el período.");
        return body;
      })
      .then((body) => {
        setValues({ ...EMPTY_VALUES, ...body.finance });
        setHistory(Array.isArray(body.billingHistory) ? body.billingHistory : []);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("periodo", period);
    window.history.replaceState({}, "", url);
    setSaved(false);
    load();
  }, [period]);

  const result = useMemo(() =>
    Number(values.facturacion || 0) - Number(values.sueldos || 0) - Number(values.impuestos || 0) - Number(values.herramientas || 0),
    [values],
  );

  const update = (field, value) => {
    setSaved(false);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const save = (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    fetch(`/api/finanzas/resumen/${encodeURIComponent(period)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "No se pudo guardar el mes.");
        return body;
      })
      .then((body) => {
        setValues({ ...EMPTY_VALUES, ...body });
        setSaved(true);
        setHistory((current) => [...current.filter((item) => item.period !== period), { period, total: body.facturacion }]
          .sort((a, b) => a.period.localeCompare(b.period)));
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setSaving(false));
  };

  return <main className="page-shell salary-page finance-dashboard">
    <section className="salary-hero">
      <div><span className="section-label">Finanzas · Solo Líder</span><h1>Cierre mensual de Render</h1><p>Facturación y egresos reales cargados manualmente, sin automatizaciones.</p></div>
      <label className="finance-period-select"><span>Período</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
    </section>

    {loading && <div className="salary-state">Cargando el cierre mensual…</div>}
    {error && <div className="salary-state is-error"><strong>No se pudo completar la operación.</strong><span>{error}</span></div>}
    {!loading && <form className="finance-manual-form" onSubmit={save}>
      <section className="finance-billing-hero">
        <div><span>FACTURACIÓN TOTAL</span><small>{labelPeriod(period)}</small><strong>{money.format(Number(values.facturacion) || 0)}</strong><p>Importe ingresado manualmente para este mes.</p></div>
        <b>Sin cálculos automáticos</b>
      </section>

      <section className="finance-entry-grid" aria-label="Carga financiera mensual">
        {[
          ["facturacion", "Facturación total", "Todo lo facturado por Render"],
          ["sueldos", "Sueldos a pagar", "Total de sueldos del mes"],
          ["impuestos", "Impuestos pagados", "Total de impuestos del mes"],
          ["herramientas", "Herramientas pagadas", "Software y herramientas del mes"],
        ].map(([field, label, help]) => <label key={field}><span>{label}</span><div><b>$</b><input min="0" step="0.01" type="number" value={values[field]} onChange={(event) => update(field, event.target.value)} /></div><small>{help}</small></label>)}
      </section>

      <section className="finance-result-row">
        <div><span>RESULTADO DEL MES</span><small>Facturación menos sueldos, impuestos y herramientas</small></div>
        <strong className={result < 0 ? "is-negative" : ""}>{money.format(result)}</strong>
        <button className="btn primary" disabled={saving} type="submit">{saving ? "Guardando…" : "Guardar cierre mensual"}</button>
        {saved && <em>Mes guardado correctamente</em>}
      </section>
    </form>}

    <section className="finance-panel"><header><div><span className="section-label">HISTORIAL</span><h2>Facturación mes a mes</h2></div><small>Solo meses guardados manualmente</small></header><BillingChart items={history} selectedPeriod={period} /></section>
    <p className="finance-disclaimer">Finanzas usa únicamente los cuatro importes cargados manualmente para cada mes.</p>
  </main>;
}
