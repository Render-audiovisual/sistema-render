import React, { useCallback, useEffect, useRef, useState } from "react";
import { getSesion } from '../utils.jsx';
import { useScopedRequest } from '../shared/session/use-scoped-request.js';
import { isSessionFailure } from '../shared/session/captured-request.js';
import { FinanceContractsPanel } from '../components/FinanceContractsPanel.jsx';
import { TeamPaymentsPanel } from '../components/TeamPaymentsPanel.jsx';

const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function salaryPeriod(search) {
  const values = new URLSearchParams(search).getAll('periodo');
  if (!values.length) return currentPeriod();
  if (values.length !== 1 || values[0].length !== 7 || values[0].trim() !== values[0] || !/^\d{4}-(0[1-9]|1[0-2])$/.test(values[0]) || values[0] < '2026-09') throw new Error('Elegí un mes de cobro válido, desde septiembre de 2026.');
  return values[0];
}
const financeNumber = value => typeof value === 'number' && Number.isFinite(value);
function contractRow(value) {
  const match = typeof value?.contract_revision === 'string' && /^fc1:([1-9]\d*):([1-9]\d*)$/.exec(value.contract_revision);
  const date = value => typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  const amount = value?.importe_mensual;
  if (!Number.isSafeInteger(value?.id) || value.id < 1 || value.id > 2147483647 || !match || match[0] !== value.contract_revision || Number(match[1]) !== value.id || Number(match[2]) > 2147483647
    || typeof value.nombre !== 'string' || !value.nombre.trim() || typeof value.activo !== 'boolean' || !date(value.inicia_el) || (value.finaliza_el !== null && !date(value.finaliza_el))
    || !['number','string'].includes(typeof amount) || String(amount).trim() !== String(amount) || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(Number(amount)) || Number(amount) < 0) throw new Error('No se pudo verificar el contrato financiero.');
  return { id:value.id, nombre:value.nombre, importe_mensual:amount, inicia_el:value.inicia_el, finaliza_el:value.finaliza_el, activo:value.activo, contract_revision:value.contract_revision };
}
function contractRows(value) {
  if (!Array.isArray(value)) throw new Error('La lista de contratos financieros no es válida.');
  const rows = value.map(contractRow);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('La lista de contratos financieros contiene duplicados.');
  return rows;
}
function financeDto(value, period) {
  const invalid = () => { throw new Error('No se pudo verificar el resumen financiero.'); };
  for (const [index, summary] of [value?.finance,value?.previousFinance].entries()) {
    if (!summary || !/^\d{4}-(0[1-9]|1[0-2])$/.test(summary.period) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(summary.workPeriod)
      || (index === 0 && summary.period !== period) || !['facturacion','sueldos','gastosFijosARS','resultadoARS'].every(key => financeNumber(summary[key]))
      || !Array.isArray(summary.ingresos) || !Array.isArray(summary.gastos)) invalid();
    if (summary.ingresos.some(row => typeof row?.nombre !== 'string' || !financeNumber(row.importe) || typeof row.prorrateado !== 'boolean' || !Number.isInteger(row.diasActivos) || !Number.isInteger(row.diasDelMes))) invalid();
    if (summary.gastos.some(row => typeof row?.nombre !== 'string' || typeof row.categoria !== 'string' || !['ARS','USD'].includes(row.moneda) || !financeNumber(row.importe) || !Number.isInteger(row.diaPago))) invalid();
  }
  if (!value?.exchangeRate || !financeNumber(value.exchangeRate.original) || !financeNumber(value.exchangeRate.rounded) || typeof value.exchangeRate.source !== 'string' || typeof value.exchangeRate.fallback !== 'boolean'
    || !Array.isArray(value.payroll) || value.payroll.some(row => typeof row?.name !== 'string' || !financeNumber(row.total))
    || !Array.isArray(value.payrollPending) || value.payrollPending.some(name => typeof name !== 'string')
    || !Array.isArray(value.billingHistory) || value.billingHistory.some(row => !/^\d{4}-(0[1-9]|1[0-2])$/.test(row?.period) || !financeNumber(row.total))) invalid();
  return value;
}

function BillingChart({ items = [], selectedPeriod }) {
  const visible = items.slice(-8);
  const maximum = Math.max(...visible.map((item) => Number(item.total || 0)), 1);
  return <div className="finance-chart" role="img" aria-label="Evolución mensual de ingresos proyectados">
    {visible.map((item) => <div className={`finance-chart-column${item.period === selectedPeriod ? " is-current" : ""}`} key={item.period}>
      <strong>{ars.format(item.total || 0)}</strong><div><i style={{ height: `${Math.max(((item.total || 0) / maximum) * 100, 4)}%` }} /></div>
      <span>{labelPeriod(item.period).split(" de ")[0].slice(0, 3)}</span>
    </div>)}
  </div>;
}



export function SueldosPage({ sesion }) {
  const { view } = useScopedRequest(sesion || getSesion(), 'finance');
  const identity = useRef({ view, epoch:0 });
  if (identity.current.view !== view) identity.current = { view, epoch:identity.current.epoch + 1 };
  if (view.role !== 'admin') return <main className="page-shell salary-page"><div className="salary-state is-error">Finanzas está disponible sólo para administración.</div></main>;
  return <SueldosContent key={identity.current.epoch} sesion={view.session} />;
}

function SueldosContent({ sesion }) {
  const initial = useRef(null);
  if (!initial.current) { try { initial.current = { period:salaryPeriod(window.location.search),error:'' }; } catch (reason) { initial.current = { period:currentPeriod(),error:reason.message }; } }
  const [period, setPeriod] = useState(initial.current.period), [periodError,setPeriodError] = useState(initial.current.error);
  const { view, capture } = useScopedRequest(sesion, period);
  const { capture: captureContracts } = useScopedRequest(sesion, 'financial-contracts');
  const [data, setData] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [contractsReady,setContractsReady] = useState(false), [contractsError,setContractsError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [contractActive,setContractActive] = useState(false), [deferredNotice,setDeferredNotice] = useState('');
  const [paymentActive,setPaymentActive] = useState(false);
  const active = useRef(false), pendingPeriod = useRef(null), financeGeneration = useRef(0), contractsGeneration = useRef(0), financeDeferred = useRef(false);
  const contractActivity = useRef(false), paymentActivity = useRef(false);

  const loadContracts = useCallback(async (signal) => {
    if (active.current) return;
    const guard = captureContracts(), generation = ++contractsGeneration.current;
    if (!guard.current()) return;
    setContractsError('');
    try {
      const rows = contractRows(await guard.request('/api/contratos', { cache:'no-store', ...(signal ? {signal} : {}) }));
      if (!guard.current() || signal?.aborted || generation !== contractsGeneration.current || active.current) return;
      setContracts(rows); setContractsReady(true);
    } catch (reason) { if (guard.current() && !signal?.aborted && generation === contractsGeneration.current && !isSessionFailure(reason)) setContractsError('No se pudieron cargar los contratos financieros.'); }
  }, [captureContracts]);

  const onSaved = useCallback((value, guard) => {
    guard.assertCurrent();
    const row = contractRow(value);
    contractsGeneration.current += 1;
    // Commit the verified ACK to this identity-keyed page. The child's guard
    // may intentionally expire when it closes its editor after this callback.
    guard.assertCurrent();
    setContracts(previous => [...previous.filter(item => item.id !== row.id),row]);
    guard.assertCurrent(); setRefreshVersion(version => version + 1);
  }, []);

  const onActivityChange = useCallback(value => {
    contractActivity.current = value === true;
    const next = contractActivity.current || paymentActivity.current; active.current = next; setContractActive(next);
    if (!next) {
      if (pendingPeriod.current) { const queued = pendingPeriod.current; pendingPeriod.current = null; setPeriod(queued.period); setPeriodError(queued.error); setDeferredNotice(''); }
      if (financeDeferred.current) { financeDeferred.current = false; setRefreshVersion(version => version + 1); }
    }
  }, []);
  const requestContractEdit = useCallback(() => {
    if (!captureContracts().current() || paymentActivity.current) return false;
    onActivityChange(true); return true;
  }, [captureContracts,onActivityChange]);
  const onPaymentActivityChange = useCallback(value => {
    if (!captureContracts().current() || value === true && contractActivity.current) return false;
    paymentActivity.current = value === true; setPaymentActive(paymentActivity.current);
    onActivityChange(contractActivity.current); return true;
  }, [captureContracts,onActivityChange]);

  useEffect(() => {
    const controller = new AbortController(); loadContracts(controller.signal);
    return () => { controller.abort(); contractsGeneration.current += 1; };
  }, [loadContracts]);

  useEffect(() => {
    const pop = () => {
      let next; try { next = {period:salaryPeriod(window.location.search),error:''}; } catch (reason) { next = {period,error:reason.message}; }
      if (active.current) {
        pendingPeriod.current = next; setDeferredNotice('El cambio de mes se aplicará al terminar o descartar la edición del contrato.');
        const url = new URL(window.location.href); url.searchParams.set('periodo',period); window.history.replaceState(window.history.state,'',url);
        return;
      }
      setPeriod(next.period); setPeriodError(next.error);
    };
    window.addEventListener('popstate',pop); return () => window.removeEventListener('popstate',pop);
  }, [period]);

  useEffect(() => {
    if (active.current) { financeDeferred.current = true; return; }
    const guard = capture(), controller = new AbortController(), generation = ++financeGeneration.current;
    if (!guard.current()) return;
    if (periodError) { setError(periodError); setLoading(false); return () => controller.abort(); }
    const url = new URL(window.location.href);
    url.searchParams.set("periodo", period);
    window.history.replaceState(window.history.state, "", url);
    setLoading(true);
    setError("");
    guard.request(`/api/sueldos?periodo=${encodeURIComponent(period)}`, { cache:'no-store',signal:controller.signal })
      .then(value => { const result = financeDto(value,period); if (!guard.current() || controller.signal.aborted || generation !== financeGeneration.current) return; if (active.current) { financeDeferred.current = true; return; } setData(result); })
      .catch(reason => { if (guard.current() && !controller.signal.aborted && generation === financeGeneration.current && !isSessionFailure(reason)) setError('No se pudo verificar el resumen financiero del período.'); })
      .finally(() => { if (guard.current() && !controller.signal.aborted && generation === financeGeneration.current) setLoading(false); });
    return () => { controller.abort(); financeGeneration.current += 1; };
  }, [period,refreshVersion,capture,periodError]);

  const finance = !periodError && data?.finance?.period === period ? data.finance : null;
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
      <div><span className="section-label">Finanzas · Sólo administración</span><h1>Finanzas de Render</h1><p>Proyección mensual de ingresos, sueldos y gastos.</p></div>
      <label className="finance-period-select"><span>Mes de cobro previsto</span><input type="month" value={period} min="2026-09" disabled={contractActive} onChange={(event) => { if (active.current) return; try { const next = salaryPeriod(`?periodo=${encodeURIComponent(event.target.value)}`); setPeriod(next); setPeriodError(''); } catch (reason) { setError(reason.message); } }} /></label>
    </section>
    <p className="finance-disclaimer" role="note">Los importes son una proyección calculada. No acreditan cobros ni pagos realizados. Los pagos manuales se registran por separado.</p>
    <TeamPaymentsPanel sesion={view.session} disabled={contractActive && !paymentActive} onActivityChange={onPaymentActivityChange}/>

    {loading && <div className="salary-state">Calculando el mes…</div>}
    {deferredNotice && <div className="salary-state" role="status">{deferredNotice}</div>}
    {error && <div className="salary-state is-error"><strong>No se pudo calcular Finanzas.</strong><span>{error}</span><button type="button" className="btn" disabled={contractActive} onClick={() => setRefreshVersion(version => version + 1)}>Reintentar resumen</button></div>}
    {finance && <>
      <section className="finance-billing-hero"><div><span>INGRESOS ESPERADOS</span><small>{labelPeriod(period)} · trabajo de {labelPeriod(finance.workPeriod)}</small><strong>{ars.format(finance.facturacion)}</strong><p>Estimación por contratos a mes vencido; no confirma facturas emitidas ni cobros.{facturacionVariation ? ` Variación contra el mes anterior: ${facturacionVariation.percent}%.` : ""}</p></div><b>Mes vencido · estimado</b></section>

      <section className="finance-metrics" aria-label="Proyección financiera mensual">
        <article className="is-result">
          <span>📊 Resultado proyectado</span>
          <strong className={`finance-metric-value ${finance.resultadoARS >= 0 ? 'is-positive' : 'is-negative'}`}>{ars.format(finance.resultadoARS)}</strong>
          <small className="finance-metric-note">Margen: <strong>{margen}%</strong></small>
          {resultadoVariation && <small className={resultadoVariation.isNegative ? 'is-negative' : 'is-positive'}>{resultadoVariation.isNegative ? '↓' : '↑'} {resultadoVariation.percent}%</small>}
        </article>
        <article>
          <span>💵 Ingresos esperados</span>
          <strong className="finance-metric-value is-expected">{ars.format(finance.facturacion)}</strong>
          <small className="finance-metric-note">Contratos incluidos: <strong>{finance.ingresos.length}</strong></small>
          {facturacionVariation && <small className={facturacionVariation.isNegative ? 'is-negative' : 'is-positive'}>{facturacionVariation.isNegative ? '↓' : '↑'} {facturacionVariation.percent}%</small>}
        </article>
        <article>
          <span>👥 Sueldos calculados</span>
          <strong className="finance-metric-value">{ars.format(finance.sueldos)}</strong>
          <small className="finance-metric-note">Estimación del período; no acredita pagos</small>
          {sueldosVariation && <small className={sueldosVariation.isNegative ? 'is-positive' : 'is-negative'}>{sueldosVariation.isNegative ? '↓' : '↑'} {sueldosVariation.percent}%</small>}
        </article>
        <article>
          <span>📋 Gastos fijos previstos</span>
          <strong className="finance-metric-value">{ars.format(finance.gastosFijosARS)}</strong>
          <small className="finance-metric-note">Impuestos + herramientas</small>
          {gastosVariation && <small className={gastosVariation.isNegative ? 'is-positive' : 'is-negative'}>{gastosVariation.isNegative ? '↓' : '↑'} {gastosVariation.percent}%</small>}
        </article>
      </section>
      <div className={`finance-exchange-note${exchangeRate?.fallback ? " is-fallback" : ""}`}>
        <span>Dólar usado para ChatGPT y Contabo</span>
        <strong>{ars.format(exchangeRate?.rounded || 0)} por USD</strong>
        <small>Cotización tarjeta vendedor: {ars.format(exchangeRate?.original || 0)}, redondeada hacia arriba · {exchangeRate?.source}</small>
      </div>
      {data.payrollPending?.length > 0 && <div className="salary-banner"><strong>Cálculo de sueldo variable pendiente:</strong> falta clasificar las piezas de {data.payrollPending.join(", ")} para completar ese importe automáticamente.</div>}

      <section className="finance-panel">
        <header><div><span className="section-label">CONTRATOS FINANCIEROS</span><h2>Ingresos por contrato</h2></div></header>
        <div className="finance-client-table">
          <div className="finance-client-row is-heading">
            <div>Contrato</div>
            <div>Monto estimado</div>
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


    </>}

      <section className="finance-panel">
        <header><div><span className="section-label">ADMINISTRACIÓN</span><h2>Contratos financieros</h2></div><small>Registros financieros independientes; sus nombres no identifican clientes operativos.</small></header>
        {contractsError && <div className="salary-state is-error" role="alert">{contractsError}</div>}
        <button type="button" className="btn" disabled={contractActive} onClick={() => loadContracts()}>Recargar contratos</button>
        {contractsReady ? <FinanceContractsPanel contracts={contracts} sesion={view.session} ars={ars} onSaved={onSaved} onActivityChange={onActivityChange} disabled={paymentActive} onBeforeEdit={requestContractEdit} /> : <div className="salary-state">Los contratos financieros aún no están disponibles.</div>}
      </section>

    {finance && <>
      <section className="finance-panel finance-auto-details">
        <header><div><span className="section-label">DETALLE DEL CÁLCULO</span><h2>¿De dónde sale cada número?</h2></div><small>No son movimientos de dinero registrados</small></header>
        <div className="finance-detail-columns">
          <details open><summary>Contratos · proyección {ars.format(finance.facturacion)}</summary>{finance.ingresos.map((item) => <p key={item.nombre}><span>{item.nombre}{item.prorrateado ? ` · ${item.diasActivos}/${item.diasDelMes} días` : ""}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Equipo · cálculo {ars.format(finance.sueldos)}</summary>{(data.payroll || []).map((item) => <p key={item.name}><span>{item.name}</span><strong>{ars.format(item.total)}</strong></p>)}{salaryExpenses.map((item) => <p key={item.nombre}><span>{item.nombre}</span><strong>{ars.format(item.importe)}</strong></p>)}</details>
          <details><summary>Gastos fijos · previstos {ars.format(finance.gastosFijosARS)}</summary>{taxExpenses.map((item) => <p key={item.nombre}><span>Día previsto {item.diaPago} · {item.nombre}</span><strong>{ars.format(item.importe)}</strong></p>)}{toolExpenses.map((item) => <p key={item.nombre}><span>Día previsto {item.diaPago} · {item.nombre}{item.moneda === "USD" ? ` · USD ${item.importe}` : ""}</span><strong>{ars.format(item.moneda === "USD" ? item.importe * (exchangeRate?.rounded || 0) : item.importe)}</strong></p>)}</details>
        </div>
      </section>

      <section className="finance-panel"><header><div><span className="section-label">EVOLUCIÓN CALCULADA</span><h2>Proyección mes a mes</h2></div><small>Según el trabajo del mes anterior; no acredita cobros</small></header><BillingChart items={data.billingHistory} selectedPeriod={period} /></section>
      <p className="finance-disclaimer">Los consumos en USD se convierten con dólar tarjeta vendedor y se redondean hacia arriba al próximo múltiplo de $100.</p>
    </>}
  </main>;
}
