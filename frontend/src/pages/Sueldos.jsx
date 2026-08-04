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

function SalaryCard({ employee }) {
  const unit = employee.name === "Oriana" ? "entregas" : employee.name === "Augusto" ? "carruseles" : employee.name === "Luciano" ? "videos" : "tareas";
  const chartMax = Math.max(employee.target, employee.completed, 1);
  return (
    <article className="salary-card">
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
          <div><span>Devengado</span><strong>{money.format(employee.earned)}</strong></div>
          <div><span>Resta del sueldo</span><strong>{money.format(employee.remainingAmount)}</strong></div>
          <small>Sobre {money.format(employee.total)} · proporcional al cumplimiento</small>
        </div>
      )}
      <div className="salary-daily">
        <div><strong>Avance diario</strong><span>{employee.completed} {unit}</span></div>
        <div className="salary-daily-bars" aria-label="Progreso acumulado por día">
          {employee.dailyProgress.map((day) => <i key={day.day} style={{ height: `${Math.max(8, (day.completed / chartMax) * 100)}%` }} title={`Día ${day.day}: ${day.completed}`} />)}
        </div>
      </div>
      <details className="salary-detail">
        <summary>Ver trabajo incluido ({employee.items.length})</summary>
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
  }, [period]);

  const summary = useMemo(() => data?.summary, [data]);
  return (
    <main className="page-shell salary-page">
      <section className="salary-hero">
        <div><span className="section-label">Gestión interna · Solo Líder</span><h1>¿Cuánto trabajo realizó el equipo?</h1><p>Avance mensual y sueldo proporcional, calculados desde el trabajo ya registrado.</p></div>
        <div className="salary-period-control">
          <button type="button" onClick={() => setPeriod(movePeriod(period, -1))} aria-label="Mes anterior">←</button>
          <strong>{labelPeriod(period)}</strong>
          <button type="button" onClick={() => setPeriod(movePeriod(period, 1))} aria-label="Mes siguiente">→</button>
        </div>
      </section>
      {loading && <div className="salary-state">Calculando el avance del mes…</div>}
      {error && <div className="salary-state is-error"><strong>No se pudo cargar Sueldos.</strong><span>{error}</span></div>}
      {!loading && !error && data && <>
        <section className="salary-summary" aria-label="Resumen mensual">
          <div><span>Devengado calculable</span><strong>{money.format(summary.earned)}</strong></div>
          <div><span>Resta para completar</span><strong>{money.format(summary.remaining)}</strong></div>
          <div><span>Avance promedio</span><strong>{summary.averageProgress}%</strong></div>
        </section>
        {summary.pendingConfigurations.length > 0 && <div className="salary-banner"><strong>Cálculo incompleto:</strong> falta definir el valor por video de {summary.pendingConfigurations.join(", ")}. No se inventó ningún importe.</div>}
        <section className="salary-grid">{data.employees.map((employee) => <SalaryCard key={employee.name} employee={employee} />)}</section>
        <footer className="salary-notes"><strong>Cómo leer este módulo</strong>{data.notes.map((note) => <p key={note}>{note}</p>)}</footer>
      </>}
    </main>
  );
}
