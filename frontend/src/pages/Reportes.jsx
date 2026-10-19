import React, { useEffect, useState } from 'react';
import { getHoyLocalISO } from '../utils.jsx';
import { ROL_LABELS } from '../constants.js';
import { getReportPeriodRange } from '../shared/reports/report-utils.js';
import { pushUrlContext, readUrlContext, replaceUrlContext } from '../shared/navigation/url-context.js';
import { buildEmployeeReport, buildHistoricalProductionReport, buildProductionRegistryReport, historicalUnassignedEditingCount, uniqueReportTasks, editorialRecords, summarizeEditorialRecords, clientQuotaReport, employeeTaskDetails, employeeFormatBreakdown, personalEditorialReport } from '../shared/reports/production-registry-report.js';
import './ReportProductionRegistry.css';

const PERIODS = [['mes_actual', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['ultimos_30', 'Últimos 30 días']];
const initialPeriod = () => {
  const value = readUrlContext(window.location.search, { periodo: 'mes_actual' }).periodo;
  return PERIODS.some(([id]) => id === value) ? value : 'mes_actual';
};
const VIDEO_STATES = { planificado: 'Planificado', grabado: 'Grabado', pendiente: 'Pendiente', repetir: 'Repetir' };
const PHOTO_STATES = { realizada: 'Realizada', pendiente: 'Pendiente', repetir: 'Repetir' };
const FORMAT_LABELS = { carruseles: 'Carruseles', reels: 'Reels', historias: 'Historias', otros: 'Otros' };
const TASK_LABELS = { pendiente: 'Pendiente', en_progreso: 'En proceso', en_revision: 'Para revisar', aprobada: 'Aprobada', finalizada: 'Finalizada', publicada: 'Finalizada (alias histórico)' };
function Metric({ value, label }) {
  return <div className="rpr-metric"><strong>{value}</strong><span>{label}</span></div>;
}
function EditorialTable({ rows }) {
  return <div className="rpr-table-wrap"><table><caption className="rpr-sr-only">Programación y confirmaciones manuales por formato</caption><thead><tr><th>Formato</th><th>Programadas por fecha</th><th>Confirmadas manualmente en el período</th><th>Históricas con fecha, sin confirmar</th><th>Sin fecha real válida (históricas)</th><th>Históricas sin fecha de período</th><th>Estados de registros fechados en el rango</th></tr></thead><tbody>{rows.map(row => <tr key={row.formato}><th scope="row">{FORMAT_LABELS[row.formato]}</th><td>{row.programadas}</td><td>{row.publicadas}</td><td>{row.historicalFechadas}</td><td>{row.legacy}</td><td>{row.legacySinFecha}</td><td>{row.estados.map(state => state.estado + ': ' + state.total).join(' · ') || 'Sin registros fechados'}</td></tr>)}</tbody></table></div>;
}
function PersonDetails({ person, tasks, data, range }) {
  const details = employeeTaskDetails(tasks, person.id, range);
  const formats = employeeFormatBreakdown(tasks, person.id, range);
  const editorial = personalEditorialReport(tasks, person.id, data.historias, data.publicaciones, range);
  return <section className="rpr-person-detail" aria-label={'Detalle de tareas de ' + person.nombre + ' #' + person.id}>
    <h3>Trabajo por formato · {person.nombre} · #{person.id}</h3>
    <div className="rpr-metrics">{formats.map(format => <div key={format.formato}><strong>{FORMAT_LABELS[format.formato]}</strong><p>{format.finalizadas} finalizadas de {format.total} tareas · {format.enRevision} para revisar · {format.aprobadas} aprobadas</p>{format.total > 0 && <progress aria-label={'Tareas finalizadas de ' + FORMAT_LABELS[format.formato] + ' de usuario #' + person.id} max={format.total} value={format.finalizadas}/>}</div>)}</div>
    <ul className="rpr-task-list">{details.map(task => <li key={task.id}><div>{task.href ? <a href={task.href}>#{task.id} · {task.titulo}</a> : <strong>#{task.id} · {task.titulo}</strong>}<p>{FORMAT_LABELS[task.formato]} · {TASK_LABELS[task.estado] || task.estado || 'Sin estado'} <small>(estado almacenado: {task.estado || 'no disponible'})</small></p></div><p>Entrega: {task.fecha_entrega || 'Sin fecha'}<br/>Finalización: {task.finalizada || 'Sin fecha registrada'}<br/>Actualización: {task.actualizada || 'Sin fecha'}</p>{!task.href && <small>Registro histórico; sin enlace operativo disponible.</small>}</li>)}</ul>
    {!details.length && <p>Sin tareas del período para este ID.</p>}
    <h3>Mis piezas asignadas{!editorial.available ? ': sin atribución verificable' : ''}</h3>
    <p className="rpr-muted">Solo vínculos de tareas por ID a historias o publicaciones visibles en esta respuesta. No se atribuyen por nombres ni por cliente.</p>
    {!editorial.available ? <p>No disponible: no hay vínculos editoriales verificables con registros visibles. Esto no significa cero piezas asignadas.</p> : <EditorialTable rows={editorial.rows}/>}
    {editorial.missing > 0 && <p>{editorial.missing} piezas vinculadas no disponibles en esta respuesta. No se cuentan como cero ni se reconstruyen desde tareas.</p>}
  </section>;
}
export function ReportesEquipoPage() {
  const [period, setPeriod] = useState(initialPeriod);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [today, setToday] = useState(getHoyLocalISO);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const range = getReportPeriodRange(period, new Date(today + 'T12:00:00'));
  useEffect(() => { replaceUrlContext({ periodo: period }); }, [period]);
  useEffect(() => {
    const restore = () => setPeriod(initialPeriod());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    let active = true, fetching = false;
    const abort = new AbortController();
    const load = async (silent = false) => {
      if (fetching) return;
      fetching = true;
      if (!silent) { setLoading(true); setData(null); }
      const query = new URLSearchParams({ desde: range.desde, hasta: range.hasta,
        mes_configuracion: period === 'mes_pasado' ? range.desde.slice(0, 7) : today.slice(0, 7) });
      try {
        const response = await fetch('/api/reportes/datos?' + query, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('No se pudieron cargar los reportes.');
        const payload = await response.json();
        if (active) { setData(payload); setError(''); }
      } catch (reason) {
        if (active && reason.name !== 'AbortError') setError('No se pudieron actualizar los reportes. Los datos anteriores pueden estar desactualizados.');
      } finally { fetching = false; if (active) setLoading(false); }
    };
    const refresh = () => {
      const next = getHoyLocalISO();
      if (next !== today) { setToday(next); return; }
      if (document.visibilityState === 'visible') load(true);
    };
    load();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; abort.abort(); window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [period, range.desde, range.hasta, today]);
  const tasks = uniqueReportTasks(data?.tareas, data?.tareasRenderOs);
  const employees = buildEmployeeReport(data?.usuarios, tasks, range, today);
  const production = buildProductionRegistryReport(data?.producciones, data?.usuarios, range);
  const historical = buildHistoricalProductionReport(tasks, production.normalizedSourceIds, range);
  const unassignedEditing = historicalUnassignedEditingCount(data?.entregasEdicion, range);
  const editorial = editorialRecords(data?.historias, data?.publicaciones);
  const editorialSummary = summarizeEditorialRecords(editorial, range);
  const quotas = clientQuotaReport(data?.clientes, editorial, range);
  const quotaMonth = period === 'mes_pasado' ? range.desde.slice(0, 7) : today.slice(0, 7);
  return <main className="rpr-page" aria-label="Reportes del equipo"><div className="frame"><div className="content">
    <header className="rpr-heading"><span className="rpr-eyebrow">Reportes</span><h1>Trabajo y producción</h1><p>Registros del período, sin información económica ni objetivos estimados.</p></header>
    <nav className="rpr-periods" aria-label="Período del reporte">{PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => { pushUrlContext({ periodo: id }); setPeriod(id); }}>{label}</button>)}</nav>
    <p className="rpr-muted">Desde {range.desde} hasta {range.hasta} (sin incluir ese día).</p>
    {error && <p className="rpr-error" role="alert">{error}</p>}
    {loading ? <p role="status">Cargando reportes…</p> : !data ? <p>No hay datos disponibles. Cambiá de período para volver a intentar.</p> : <>
      <section className="rpr-panel" aria-labelledby="rpr-editorial"><header><h2 id="rpr-editorial">Programación y publicación editorial</h2><p>Programación y confirmaciones manuales por fecha real, en horario de Córdoba.</p></header>
        <EditorialTable rows={editorialSummary}/>
        <details className="rpr-visit"><summary>Cómo se cuentan las publicaciones</summary><p className="rpr-muted">Una pieza puede estar programada y confirmada; las columnas no se suman. La confirmación requiere el registro manual del servidor con usuario y fecha, nunca una tarea finalizada, una checklist o una fecha histórica aislada. No equivale a verificación externa de una red social. El historial sin confirmación se muestra por separado y sin fecha de período no se asigna a este mes.</p></details>
        <details className="rpr-visit"><summary>Ver registros y estados editoriales</summary><ul className="rpr-task-list">{editorial.filter(row => [row.programada, row.publicada, row.historica_fecha].some(date => date && date.slice(0, 10) >= range.desde && date.slice(0, 10) < range.hasta) || (row.historica && !row.programada && !row.historica_fecha)).map(row => <li key={row.key}><strong>{row.domain === 'historia' ? 'Historia' : 'Publicación'} #{row.id} · {FORMAT_LABELS[row.formato]}</strong><span>Estado: {row.estado || 'Sin estado'}</span><span>Programada: {row.programada || 'Sin fecha'} · Confirmada: {row.publicada || 'Sin confirmación manual'}{row.historica && ` · Histórica: ${row.historica_fecha || 'sin fecha válida'}`}</span></li>)}</ul></details>
      </section>
      <section className="rpr-panel" aria-labelledby="rpr-quotas"><header><h2 id="rpr-quotas">Cuotas por cliente y feed</h2><p>Cuota mensual configurada · {quotaMonth}. Un feed compartido tiene una sola cuota, no una por cuenta. Sin atribución a personas por nombre.</p></header>
        {period === 'ultimos_30' && <p className="rpr-muted">El rango móvil no equivale a un mes: estas cuotas son referencia mensual, sin porcentaje ni objetivo prorrateado.</p>}
        <p className="rpr-muted">Solo incluye piezas visibles según tus permisos; no mide el cumplimiento global de la cuota.</p>
        {!quotas.length ? <p>No hay cuotas de clientes disponibles en esta respuesta.</p> : <div className="rpr-table-wrap"><table><caption className="rpr-sr-only">Cuotas mensuales y confirmaciones visibles del rango real</caption><thead><tr><th>Cliente / feed</th><th>Cuota mensual de carruseles</th><th>Cuota mensual de reels</th><th>Carruseles confirmados en el período real</th><th>Reels confirmados en el período real</th></tr></thead><tbody>{quotas.map(group => <tr key={group.key}><th scope="row">{group.shared ? 'Feed compartido · ' + group.key : 'Cliente'}<small>{group.accounts.map(account => account.nombre + ' (#' + account.id + ')').join(', ')}</small>{group.conflict && <small>Cuotas en conflicto: no se infiere un valor.</small>}</th><td>{group.carruseles ?? 'No disponible'}</td><td>{group.reels ?? 'No disponible'}</td><td>{group.metrics.find(row => row.formato === 'carruseles').publicadas} visibles</td><td>{group.metrics.find(row => row.formato === 'reels').publicadas} visibles</td></tr>)}</tbody></table></div>}
      </section>
      <section className="rpr-panel" aria-labelledby="rpr-production"><header><h2 id="rpr-production">Registro de producción</h2><p>Visitas y material registrado. Participar en una visita no atribuye la autoría de sus videos.</p></header>
        {!production.available ? <p role="status">El registro normalizado no está disponible para este período. No se reemplaza con cifras históricas.</p> : <>
          <div className="rpr-metrics"><Metric value={production.visits} label="Visitas"/><Metric value={production.videos} label="Registros de video"/><Metric value={production.recorded} label="Registros de video grabados"/><Metric value={production.photos} label="Registros de fotos"/><Metric value={production.realizedPhotos} label="Registros de fotos realizados"/></div>
          <p className="rpr-muted">Cada ID de video se cuenta una vez. Son registros de visita, no piezas editoriales únicas, cuotas ni publicaciones.</p>
          {!production.clients.length && <p className="rpr-muted">No hay visitas registradas en este período.</p>}
          {production.clients.map(client => <section className="rpr-client" key={client.id}><h3>{client.nombre}</h3>{client.visits.map(visit => <details className="rpr-visit" key={visit.id}><summary><span><time dateTime={visit.fecha}>{visit.fecha}</time> · {visit.titulo || 'Visita'}</span><span>{visit.videos.length} videos · {visit.fotos.length} registros de fotos</span></summary>
            <p className="rpr-muted">Participantes: {visit.participants.map(person => person.nombre + ' · #' + person.id).join(', ') || 'Sin participantes registrados'}</p>
            <ul className="rpr-media">{visit.videos.map(video => <li key={'video:' + video.id}><span>Video · {video.titulo || 'Sin título'}</span><span>{VIDEO_STATES[video.estado] || 'Estado sin reconocer'}</span></li>)}{visit.fotos.map(photo => <li key={'photo:' + photo.id}><span>Fotos · {photo.tipo || 'Sin tipo'}</span><span>{PHOTO_STATES[photo.estado] || 'Estado sin reconocer'}</span></li>)}</ul>
            {!visit.videos.length && !visit.fotos.length && <p className="rpr-muted">Sin material registrado.</p>}
          </details>)}</section>)}
        </>}
      </section>
      <section className="rpr-panel" aria-labelledby="rpr-employees"><header><h2 id="rpr-employees">Trabajo por persona</h2><p>Tareas por fecha de entrega; sin ella, fecha de finalización o última actualización. Asignación y colaboración por ID.</p></header>
        <p className="rpr-muted">{employees.uniqueTasks} tareas únicas · {employees.unattributed} sin identidad verificable. Una tarea compartida aparece en cada participante; las filas no se suman como producción global.</p>
        <div className="rpr-table-wrap"><table><caption className="rpr-sr-only">Estado de las tareas por persona</caption><thead><tr><th>Persona</th><th>Tareas</th><th>Para revisar</th><th>Aprobadas</th><th>Finalizadas</th><th>No finalizadas</th><th>Vencidas</th></tr></thead><tbody>{employees.rows.map(person => <React.Fragment key={person.id}><tr><th scope="row"><button type="button" className="rpr-person-button" aria-expanded={selectedPerson === person.id} aria-controls={'rpr-person-' + person.id} onClick={() => setSelectedPerson(selectedPerson === person.id ? null : person.id)}>{person.nombre} · Ver tareas</button><small>#{person.id} · {ROL_LABELS[person.rol] || 'Sin rol'}</small></th><td>{person.total}</td><td>{person.enRevision}</td><td>{person.aprobadas}</td><td>{person.finalizadas}</td><td>{person.pendientes}</td><td>{person.vencidas}</td></tr><tr hidden={selectedPerson !== person.id}><td colSpan={7} id={'rpr-person-' + person.id}>{selectedPerson === person.id && <PersonDetails person={person} tasks={tasks} data={data} range={range}/>}</td></tr></React.Fragment>)}</tbody></table></div>
        {!employees.rows.length && <p className="rpr-muted">No hay personas identificadas disponibles en esta respuesta.</p>}
        <p className="rpr-muted">Finalizar una tarea no demuestra publicación real. Revisión y aprobación se muestran por separado.</p>
      </section>
      <section className="rpr-panel" aria-labelledby="rpr-history"><header><h2 id="rpr-history">Histórico · Filmaciones agregadas</h2><p>Cantidades del sistema anterior, sin videos individuales verificables. No se suman al registro normalizado ni se atribuyen por nombres.</p></header>
        <p className="rpr-muted">Se excluyen tareas de origen marcadas por la base con registros individuales, aunque la visita haya cambiado de fecha. Las asignaciones mensuales solo se muestran en períodos de mes completo.</p>
        {!production.available && <p className="rpr-muted">No se puede comprobar todo el solapamiento con producción: no combines estas cifras con otros reportes.</p>}
        {historical.length ? <ul className="rpr-media">{historical.map(client => <li key={client.id}><span>{client.nombre}</span><span>{client.recorded} videos declarados</span></li>)}</ul> : <p className="rpr-muted">Sin cantidades históricas para este período.</p>}
        <h3>Edición histórica · Sin identidad verificable</h3><p>{unassignedEditing} entregas sin ID de editor en la respuesta del período. No se atribuyen a personas por nombre ni se suman a sus tareas actuales.</p>
      </section>
    </>}
  </div></div></main>;
}
