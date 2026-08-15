import React, { useEffect, useMemo, useState } from "react";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function movePeriod(period, offset) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function labelPeriod(period) {
  const [year, month] = period.split("-").map(Number);
  const label = monthLabel.format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function SalaryCard({ employee, period, onSaved }) {
  const [finalAmount, setFinalAmount] = useState(employee.finalPayment == null ? "" : String(employee.finalPayment));
  const [nextSalary, setNextSalary] = useState(employee.model === "fixed" ? String(employee.total || "") : "");
  const [saving, setSaving] = useState("");
  const save = async (url, body, kind) => {
    setSaving(kind);
    try {
      const response = await fetch(url, { method: kind === "payment" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
      onSaved();
    } finally { setSaving(""); }
  };
  return (
    <article className={`salary-card salary-card-${employee.key}`}>
      <header className="salary-card-header">
        <span className="salary-avatar">{employee.name.charAt(0)}</span>
        <div><h3>{employee.name}</h3><p>{employee.role}</p></div>
        <strong className="salary-percent">{employee.percentage}%</strong>
      </header>
      <div className="salary-progress" aria-label={`${employee.percentage}% completado`}>
        <span style={{ width: `${employee.percentage}%` }} />
      </div>
      <div className="salary-work-summary">
        <div><strong>{employee.completed}</strong><span>realizadas</span></div>
        <div><strong>{employee.target}</strong><span>objetivo</span></div>
        <div><strong>{employee.remainingUnits}</strong><span>faltan</span></div>
      </div>
      {employee.configurationPending ? (
        <div className="salary-config-warning"><strong>Valor por video pendiente</strong><span>Se contabiliza el trabajo, pero no se calcula dinero hasta definir la tarifa.</span></div>
      ) : (
        <div className="salary-money">
          <div><span>Costo estimado</span><strong>{money.format(employee.earned)}</strong></div>
          <div><span>Resta del sueldo</span><strong>{money.format(employee.remainingAmount)}</strong></div>
          <small>Sobre {money.format(employee.total)} · proporcional al cumplimiento</small>
        </div>
      )}
      <div className="salary-admin-controls" aria-label={`Ajustes financieros de ${employee.name}`}>
        <strong className="salary-admin-title">Ajustes del Líder</strong>
        {employee.model === "fixed" && <label><span>Sueldo desde el mes próximo</span><div><input type="number" min="0" value={nextSalary} onChange={(event) => setNextSalary(event.target.value)} /><button type="button" disabled={saving} onClick={() => save(`/api/finanzas/compensaciones/${employee.key}`, { sueldo_base: Number(nextSalary) }, "salary")}>Programar</button></div></label>}
        <label><span>Pago final de este período</span><div><input type="number" min="0" placeholder={String(employee.earned ?? 0)} value={finalAmount} onChange={(event) => setFinalAmount(event.target.value)} /><button type="button" disabled={saving || finalAmount === ""} onClick={() => save(`/api/finanzas/pagos/${period}/${employee.key}`, { importe_final: Number(finalAmount) }, "payment")}>Confirmar</button></div></label>
      </div>
      <details className="salary-detail">
        <summary>Comprobar trabajo considerado ({employee.items.length})</summary>
        {employee.items.length ? <div className="salary-detail-list">
          {employee.items.map((item) => <div key={item.key}>
            <span className={item.complete ? "is-complete" : ""}>{item.complete ? "✓" : "○"}</span>
            <div><strong>{item.title}</strong><small>{item.client} · {item.source} · {item.date || "Sin fecha"}</small></div>
            <b>{item.state}</b>
          </div>)}
        </div> : <p className="salary-empty">No hay trabajo registrado para este período.</p>}
      </details>
    </article>
  );
}

export function SueldosPage() {
  const initial = new URLSearchParams(window.location.search).get("periodo");
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(initial || "") ? initial : currentPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

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
      .then(setData)
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [period, refresh]);

  const summary = useMemo(() => data?.summary, [data]);
  return (
    <main className="page-shell salary-page">
      <section className="salary-hero">
        <div><span className="section-label">Finanzas · Solo Líder</span><h1>¿Cómo está Render este mes?</h1><p>Ingresos acordados, costos y resultado mensual en una sola vista.</p></div>
        <div className="salary-period-control">
          <button type="button" onClick={() => setPeriod(movePeriod(period, -1))} aria-label="Mes anterior">←</button>
          <strong>{labelPeriod(period)}</strong>
          <button type="button" onClick={() => setPeriod(movePeriod(period, 1))} aria-label="Mes siguiente">→</button>
        </div>
      </section>
      <nav className="report-section-tabs" aria-label="Secciones del reporte"><a href="/reportes-historias">Equipo</a><a className="active" href="/sueldos">Finanzas</a></nav>
      {loading && <div className="salary-state">Calculando el avance del mes…</div>}
      {error && <div className="salary-state is-error"><strong>No se pudo cargar Finanzas.</strong><span>{error}</span></div>}
      {!loading && !error && data && <>
        <section className="salary-summary" aria-label="Resumen mensual">
          <div className="salary-summary-card"><span>Ingresos acordados</span><strong>{money.format(data.clientIncome?.total || 0)}</strong><small>{data.clientIncome?.configuredClients || 0} clientes · todavía no equivale a cobrado</small></div>
          <div className="salary-summary-card"><span>Costo del equipo</span><strong>{money.format(summary.earned)}</strong><small>Estimado según trabajo registrado</small></div>
          <div className="salary-summary-card"><span>Otros gastos</span><strong>Sin registrar</strong><small>No se descuenta ningún importe inventado</small></div>
          <div className="salary-summary-card is-result"><span>Resultado estimado</span><strong>{money.format(data.finance?.estimatedResult || 0)}</strong><small>Trabajo de {labelPeriod(period)} · movimiento en {labelPeriod(data.finance?.cashPeriod || movePeriod(period, 1))}</small></div>
        </section>
        <details className="finance-income-detail">
          <summary>Ver ingresos por cliente ({data.clientIncome?.items?.length || 0})</summary>
          <div>{data.clientIncome?.items?.map((item) => <p key={item.id}><span>{item.name}</span><strong>{money.format(item.amount)}</strong></p>)}</div>
        </details>
        {summary.pendingConfigurations.length > 0 && <div className="salary-banner"><strong>Cálculo incompleto:</strong> falta definir el valor por video de {summary.pendingConfigurations.join(", ")}. No se inventó ningún importe.</div>}
        <section className="salary-grid">{data.employees.map((employee) => <SalaryCard key={employee.name} employee={employee} period={period} onSaved={() => setRefresh((value) => value + 1)} />)}</section>
        <footer className="salary-notes"><strong>Cómo leer este módulo</strong>{data.notes.map((note) => <p key={note}>{note}</p>)}</footer>
      </>}
    </main>
  );
}
