export const CLIENT_CREATE_MODES = Object.freeze([
  Object.freeze({ value: 'editorial', label: 'Con acuerdo editorial mensual' }),
  Object.freeze({ value: 'basic', label: 'Sin acuerdo mensual' }),
]);

// This is a creation choice, never a persisted client type or permission.
export function buildClientCreatePayload(form, mode = 'editorial') {
  if (!CLIENT_CREATE_MODES.some(option => option.value === mode)) throw new Error('Elegí cómo crear el cliente.');
  if (typeof form?.nombre !== 'string' || !form.nombre.trim()) throw new Error('El nombre del cliente es obligatorio.');
  const nombre = form.nombre.trim();
  if (mode === 'basic') return { nombre };
  return {
    nombre, rubro: form.rubro,
    cuota_reels: Number(form.cuota_reels), cuota_carruseles: Number(form.cuota_carruseles),
    dias_historias: [...form.dias_historias], dias_reels: [...form.dias_reels], dias_carruseles: [...form.dias_carruseles],
    disenador_responsable: form.disenador_responsable, abono_mensual: form.abono_mensual,
    vigente_desde: form.vigente_desde,
  };
}

// Absence of configuration alone says nothing about historical agreements.
export function hasNoConfiguredMonthlyAgreement(client) {
  return client?.configuracion_completa === false
    && client.cuota_reels === 0 && client.cuota_carruseles === 0
    && client.grupo_feed_id == null
    && [client.cuota_feed_reels, client.cuota_feed_carruseles, client.cuota_feed_compartida].every(value => value == null || value === 0)
    && client.abono_mensual == null
    && !client.configuracion_vigente_desde && !client.abono_vigente_desde
    && [client.dias_historias, client.dias_reels, client.dias_carruseles].every(value => value == null || (Array.isArray(value) && value.length === 0));
}

const positiveId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const failure = () => new Error('No se pudo verificar el alta. Revisá la cartera antes de volver a crear el cliente.');
export function verifiedCreatedClient(value, payload, mode) {
  const revision = typeof value?.agreement_revision === 'string' ? /^a1:([1-9]\d*):([1-9]\d*):0:0$/.exec(value.agreement_revision) : null;
  if (!positiveId(value?.id) || value.nombre !== payload.nombre || value.activo !== true
    || !revision || revision[0] !== value.agreement_revision || Number(revision[1]) !== value.id || !positiveId(Number(revision[2]))
    || value.grupo_feed_id !== null) throw failure();
  if (mode === 'basic') {
    if (value.configuracion_completa !== false || value.configuracion_vigente_desde !== null
      || value.fecha_inicio !== null || value.rubro !== null || value.cuota_reels !== 0 || value.cuota_carruseles !== 0
      || value.abono_mensual != null || !hasNoConfiguredMonthlyAgreement(value)) throw failure();
  } else if (mode === 'editorial') {
    if (value.configuracion_completa !== true || value.configuracion_vigente_desde !== `${payload.vigente_desde}-01`
      || value.fecha_inicio !== `${payload.vigente_desde}-01` || value.rubro !== payload.rubro.trim()
      || value.cuota_reels !== payload.cuota_reels || value.cuota_carruseles !== payload.cuota_carruseles
      || value.disenador_responsable !== payload.disenador_responsable
      || !['string','number'].includes(typeof value.abono_mensual) || !Number.isFinite(Number(value.abono_mensual))
      || Number(value.abono_mensual) !== Number(payload.abono_mensual)) throw failure();
    for (const field of ['dias_historias','dias_reels','dias_carruseles']) {
      if (!Array.isArray(value[field]) || value[field].some(day => !Number.isInteger(day) || day < 0 || day > 6)
        || new Set(value[field]).size !== value[field].length
        || JSON.stringify([...value[field]].sort()) !== JSON.stringify([...payload[field]].sort())) throw failure();
    }
  } else throw failure();
  return value;
}

// There is no durable POST receipt. Only the two typed precommit rejections
// permit a corrected, explicit submission. Reads never prove a POST committed.
export function createClientCreation({ capture }) {
  let busy = false, blocked = false, submitted = false, denied = false, scope = null, rejection = null;
  const deny = error => { if ([401,403].includes(error?.status)) { denied = true; blocked = false; scope = null; } };
  return Object.freeze({
    get snapshot() { return Object.freeze({ busy, blocked, submitted, denied, rejection }); },
    async submit(form, mode) {
      if (busy || submitted || denied) throw failure();
      const payload = buildClientCreatePayload(form, mode), body = JSON.stringify(payload);
      scope = capture(); scope.assertCurrent(); submitted = true; busy = true; rejection = null;
      try {
        const value = await scope.request('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        scope.assertCurrent(); return verifiedCreatedClient(value, payload, mode);
      } catch (error) {
        const safeRejection = error?.status === 400 && error.code === 'CLIENT_CREATE_INPUT_INVALID'
          || error?.status === 409 && error.code === 'CLIENT_NAME_EXISTS';
        if (scope.current() && safeRejection) {
          submitted = false; blocked = false;
          rejection = typeof error.message === 'string' && error.message.trim() && error.message.length <= 500 && !/[\u0000-\u001f\u007f]/.test(error.message)
            ? error.message : 'Revisá los datos del cliente antes de volver a enviarlos.';
          scope = null;
        } else { blocked = true; deny(error); }
        throw error;
      }
      finally { busy = false; }
    },
    async refresh(period) {
      if (denied || busy || !blocked || !scope || typeof period !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(period) || period.length !== 7) throw failure();
      scope.assertCurrent(); busy = true;
      try {
        const rows = await scope.request(`/api/clientes?periodo=${period}`, { method: 'GET' });
        scope.assertCurrent();
        if (!Array.isArray(rows) || rows.some(row => !positiveId(row?.id) || typeof row.nombre !== 'string') || new Set(rows.map(row => row.id)).size !== rows.length) throw failure();
        return rows;
      } catch (error) { deny(error); throw error; }
      finally { busy = false; }
    },
  });
}
