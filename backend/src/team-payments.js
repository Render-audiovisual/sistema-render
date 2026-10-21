import { createHash } from 'node:crypto';
import { captureFinanceActor, withFinanceSnapshot } from './finance-snapshot.js';

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const invalid = () => fail(400, 'TEAM_PAYMENT_INPUT_INVALID', 'Revisá los datos explícitos del registro de pago.');
const conflict = () => fail(409, 'TEAM_PAYMENT_CONFLICT', 'El registro o la solicitud cambió. Revisá el estado actual antes de continuar.');
const storedFault = () => new Error('Invalid team payment storage observation.');
const id = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const uuid = value => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const month = value => typeof value === 'string' && value.length === 7 && /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
function date(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function closed(value, fields, required = fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function text(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw invalid();
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 500) throw invalid();
  return normalized;
}
function amount(value) {
  if (typeof value !== 'string' || value.length > 15 || !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(value)) throw invalid();
  const [whole, fractional = ''] = value.split('.');
  const result = `${whole}.${fractional.padEnd(2, '0')}`;
  if (BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0')) <= 0n) throw invalid();
  return result;
}
function driveUrl(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2000 || /[\s\\\u0000-\u001f\u007f]/.test(value)
    || !/^https:\/\/drive\.google\.com(?:[/?#]|$)/.test(value)) throw invalid();
  let parsed; try { parsed = new URL(value); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com' || parsed.username || parsed.password || parsed.port) throw invalid();
  return value;
}
function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function normalizeTeamPaymentInput(body, currentDate = today()) {
  closed(body, ['operation_key', 'recipient_id', 'fecha_pago', 'periodo_trabajo', 'moneda', 'importe', 'referencia', 'drive_url', 'attestation']);
  if (!uuid(body.operation_key) || !id(body.recipient_id) || !date(body.fecha_pago) || !date(currentDate)
    || body.fecha_pago > currentDate || !month(body.periodo_trabajo) || body.moneda !== 'ARS' || body.attestation !== true) throw invalid();
  return Object.freeze({ operation_key: body.operation_key, recipient_id: body.recipient_id, fecha_pago: body.fecha_pago,
    periodo_trabajo: body.periodo_trabajo, moneda: 'ARS', importe: amount(body.importe), referencia: text(body.referencia),
    drive_url: driveUrl(body.drive_url), attestation: true });
}
export function teamPaymentId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !id(Number(value)) || String(Number(value)) !== value) throw invalid();
  return Number(value);
}
function expectedRevision(value, targetId) {
  if (value === undefined) throw fail(428, 'TEAM_PAYMENT_REVISION_REQUIRED', 'Abrí el registro actual antes de anularlo.');
  const match = typeof value === 'string' && /^pay1:([1-9][0-9]*):([1-9][0-9]*)$/.exec(value);
  if (!match || match[0] !== value || !id(Number(match[1])) || !id(Number(match[2]))) throw invalid();
  if (Number(match[1]) !== targetId) throw conflict();
  return Number(match[2]);
}
export function normalizeTeamPaymentVoidInput(body, targetId) {
  if (!id(targetId)) throw invalid();
  closed(body, ['operation_key', 'expected_revision', 'reason', 'attestation'], ['operation_key', 'reason', 'attestation']);
  const version = expectedRevision(body.expected_revision, targetId);
  if (!uuid(body.operation_key) || body.attestation !== true) throw invalid();
  return Object.freeze({ operation_key: body.operation_key, expected_revision: `pay1:${targetId}:${version}`, reason: text(body.reason), attestation: true });
}
export function teamPaymentIntentHash(operation, targetId, normalized) {
  if (!['recorded', 'voided'].includes(operation) || (operation === 'recorded' ? targetId !== null : !id(targetId))) throw invalid();
  const { operation_key: _key, ...body } = normalized;
  return createHash('sha256').update(JSON.stringify({ operation, targetId, body })).digest('hex');
}

// Deliberately closed projection: never SELECT *, user credentials, payroll
// estimates, bank/provider metadata or caller-supplied actor labels.
export const TEAM_PAYMENT_READ_SQL = `SELECT p.id,p.recipient_id,p.recipient_name,p.recorded_by_id,p.recorded_by_name,
  to_char(p.fecha_pago,'YYYY-MM-DD') AS fecha_pago,to_char(p.periodo_trabajo,'YYYY-MM') AS periodo_trabajo,
  p.moneda,p.importe::text AS importe,p.referencia,p.drive_url,p.provenance,p.status,p.version,p.created_at,
  p.voided_at,p.voided_by_id,p.void_reason FROM team_payments p`;
function iso(value) {
  if (!(value instanceof Date) && typeof value !== 'string') throw storedFault();
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw storedFault();
  return parsed.toISOString();
}
function label(value) { return typeof value === 'string' && value.trim().length > 0; }
export function teamPaymentDto(row) {
  if (!row || ![row.id, row.recipient_id, row.recorded_by_id, row.version].every(id)
    || !label(row.recipient_name) || !label(row.recorded_by_name) || !date(row.fecha_pago) || !month(row.periodo_trabajo)
    || row.moneda !== 'ARS' || row.provenance !== 'manual' || !['recorded', 'voided'].includes(row.status)) throw storedFault();
  try {
    if (amount(row.importe) !== row.importe || text(row.referencia) !== row.referencia || driveUrl(row.drive_url) !== row.drive_url) throw storedFault();
    if (row.status === 'recorded' ? row.voided_at !== null || row.voided_by_id !== null || row.void_reason !== null
      : !id(row.voided_by_id) || text(row.void_reason) !== row.void_reason || row.voided_at === null) throw storedFault();
  } catch { throw storedFault(); }
  return { id: row.id, recipient_id: row.recipient_id, recipient_name: row.recipient_name, recorded_by_id: row.recorded_by_id,
    recorded_by_name: row.recorded_by_name, fecha_pago: row.fecha_pago, periodo_trabajo: row.periodo_trabajo,
    moneda: 'ARS', importe: row.importe, referencia: row.referencia, drive_url: row.drive_url, provenance: 'manual',
    status: row.status, revision: `pay1:${row.id}:${row.version}`, created_at: iso(row.created_at),
    voided_at: row.voided_at === null ? null : iso(row.voided_at), voided_by_id: row.voided_by_id, void_reason: row.void_reason };
}
const noQuery = query => closed(query ?? {}, []);
export async function readTeamPaymentContext(pool, auth, query = {}) {
  const observed = captureFinanceActor(auth); noQuery(query);
  return withFinanceSnapshot(pool, observed, async db => {
    const rows = (await db.query('SELECT id,nombre,usuario,rol FROM usuarios WHERE activo IS TRUE ORDER BY nombre,id')).rows;
    const recipients = rows.map(row => {
      if (!id(row.id) || !label(row.nombre) || typeof row.usuario !== 'string' || typeof row.rol !== 'string') throw storedFault();
      return { id: row.id, nombre: row.nombre, usuario: row.usuario, rol: row.rol };
    });
    return { version: 1, recipients };
  });
}
export async function readTeamPayments(pool, auth, query) {
  const observed = captureFinanceActor(auth);
  closed(query, ['periodo']);
  if (!month(query.periodo)) throw invalid();
  const period = query.periodo;
  return withFinanceSnapshot(pool, observed, async db => {
    const rows = (await db.query(`${TEAM_PAYMENT_READ_SQL} WHERE p.fecha_pago >= $1::date
      AND p.fecha_pago < ($1::date + interval '1 month') ORDER BY p.fecha_pago DESC,p.id DESC`, [`${period}-01`])).rows;
    const items = rows.map(teamPaymentDto);
    if (items.some(item => item.fecha_pago.slice(0, 7) !== period)) throw storedFault();
    const cents = items.filter(item => item.status === 'recorded').reduce((total, item) => total + BigInt(item.importe.replace('.', '')), 0n);
    return { version: 1, periodo: period, items, total_recorded_ars: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}` };
  });
}
async function payment(db, paymentId, lock = false) {
  const row = (await db.query(`${TEAM_PAYMENT_READ_SQL} WHERE p.id=$1${lock ? ' FOR UPDATE OF p' : ''}`, [paymentId])).rows[0];
  if (!row) throw fail(404, 'TEAM_PAYMENT_NOT_FOUND', 'Registro de pago no encontrado.');
  return teamPaymentDto(row);
}
async function writePayment(pool, captured, operation, targetId, input) {
  const hash = teamPaymentIntentHash(operation, targetId, input), db = await pool.connect();
  let discard;
  try {
    await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // Same mutex as user administration; never hold actor SHARE while waiting.
    await db.query('SELECT pg_advisory_xact_lock(20261019, 1)');
    const actor = (await db.query('SELECT id,rol,activo,session_version,nombre,usuario FROM usuarios WHERE id=$1 FOR SHARE', [captured.id])).rows[0];
    if (!actor || actor.id !== captured.id || actor.activo !== true || actor.session_version !== captured.session_version)
      throw fail(401, 'TEAM_PAYMENT_SESSION_INVALID', 'La sesión cambió. Volvé a iniciar sesión.');
    if (actor.rol !== 'admin') throw fail(403, 'TEAM_PAYMENT_FORBIDDEN', 'Solo administración puede registrar pagos.');
    if (!label(actor.nombre)) throw storedFault();
    const receipt = (await db.query('SELECT intent_hash,payment_id FROM team_payment_receipts WHERE actor_id=$1 AND operation_key=$2', [actor.id, input.operation_key])).rows[0];
    if (receipt) {
      if (receipt.intent_hash !== hash) throw conflict();
      if (!id(receipt.payment_id)) throw storedFault();
      const current = await payment(db, receipt.payment_id, true);
      await db.query('COMMIT');
      return { status: 200, body: { version: 1, payment: current, replayed: true } };
    }
    let paymentId, recipientName;
    if (operation === 'recorded') {
      const recipient = (await db.query('SELECT id,nombre,activo FROM usuarios WHERE id=$1 FOR SHARE', [input.recipient_id])).rows[0];
      if (!recipient || recipient.id !== input.recipient_id || recipient.activo !== true) throw fail(409, 'TEAM_PAYMENT_RECIPIENT_UNAVAILABLE', 'Elegí una persona activa del contexto actual.');
      if (!label(recipient.nombre)) throw storedFault();
      recipientName = recipient.nombre;
      paymentId = (await db.query(`INSERT INTO team_payments
        (recipient_id,recipient_name,recorded_by_id,recorded_by_name,fecha_pago,periodo_trabajo,moneda,importe,referencia,drive_url,provenance,status)
        VALUES ($1,$2,$3,$4,$5::date,$6::date,'ARS',$7::numeric,$8,$9,'manual','recorded') RETURNING id`,
      [recipient.id, recipient.nombre, actor.id, actor.nombre, input.fecha_pago, `${input.periodo_trabajo}-01`, input.importe, input.referencia, input.drive_url])).rows[0]?.id;
      if (!id(paymentId)) throw storedFault();
    } else {
      const current = await payment(db, targetId, true);
      if (current.status !== 'recorded' || current.revision !== input.expected_revision) throw conflict();
      const version = expectedRevision(input.expected_revision, targetId);
      if (version === 2147483647) throw conflict();
      paymentId = (await db.query(`UPDATE team_payments SET status='voided',version=version+1,voided_at=now(),voided_by_id=$2,void_reason=$3
        WHERE id=$1 AND status='recorded' AND version=$4 RETURNING id`, [targetId, actor.id, input.reason, version])).rows[0]?.id;
      if (paymentId !== targetId) throw conflict();
    }
    await db.query('INSERT INTO team_payment_events(payment_id,actor_id,kind,reason) VALUES($1,$2,$3,$4)',
      [paymentId, actor.id, operation, operation === 'recorded' ? input.referencia : input.reason]);
    await db.query('INSERT INTO team_payment_receipts(actor_id,operation_key,intent_hash,payment_id) VALUES($1,$2,$3,$4)', [actor.id, input.operation_key, hash, paymentId]);
    const current = await payment(db, paymentId);
    if (operation === 'recorded' ? current.status !== 'recorded' || current.recorded_by_id !== actor.id || current.recorded_by_name !== actor.nombre
      || current.recipient_id !== input.recipient_id || current.fecha_pago !== input.fecha_pago || current.periodo_trabajo !== input.periodo_trabajo
      || current.recipient_name !== recipientName || current.revision !== `pay1:${paymentId}:1`
      || current.importe !== input.importe || current.referencia !== input.referencia || current.drive_url !== input.drive_url
      : current.status !== 'voided' || current.voided_by_id !== actor.id || current.void_reason !== input.reason
        || current.revision !== `pay1:${targetId}:${expectedRevision(input.expected_revision, targetId) + 1}`) throw storedFault();
    await db.query('COMMIT');
    return { status: operation === 'recorded' ? 201 : 200, body: { version: 1, payment: current, replayed: false } };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (rollback) { discard = rollback; }
    throw error;
  } finally { db.release(discard); }
}
export function recordTeamPayment(pool, auth, body) {
  const captured = captureFinanceActor(auth), input = normalizeTeamPaymentInput(body);
  return writePayment(pool, captured, 'recorded', null, input);
}
export function voidTeamPayment(pool, auth, rawId, body) {
  const captured = captureFinanceActor(auth), targetId = teamPaymentId(rawId), input = normalizeTeamPaymentVoidInput(body, targetId);
  return writePayment(pool, captured, 'voided', targetId, input);
}
export function createTeamPaymentsRouter({ express, pool }) {
  const router = express.Router();
  const handle = read => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { const result = await read(req); return res.status(result.status ?? 200).json(result.body ?? result); }
    catch (error) {
      if ([400, 401, 403, 404, 409, 428].includes(error.status)) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return next(error);
    }
  };
  router.get('/contexto', handle(req => readTeamPaymentContext(pool, req.auth, req.query)));
  router.get('/', handle(req => readTeamPayments(pool, req.auth, req.query)));
  router.post('/', handle(req => { noQuery(req.query); return recordTeamPayment(pool, req.auth, req.body); }));
  router.post('/:id/anular', handle(req => { noQuery(req.query); return voidTeamPayment(pool, req.auth, req.params.id, req.body); }));
  return router;
}
