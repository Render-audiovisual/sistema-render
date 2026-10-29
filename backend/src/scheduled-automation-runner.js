import { resolveScheduledAutomationPolicy } from './scheduled-automation-policy.js';
import { readMigrationIdentity, readMigrationStatus } from './migrations.js';
import { assertStartupMigrationStatus, isLoopbackAddress } from './startup-policy.js';
import { assertCoreSchemaReady } from './startup-schema.js';

const failure = () => Object.assign(new Error('No se pudo completar la automatización programada.'),
  { code: 'AUTOMATION_RUN_FAILED' });
const result = (state, jobs = []) => Object.freeze({ state, jobs: Object.freeze([...jobs]) });
const checkpointSQL = `SELECT 1 FROM public.integracion_auditoria
  WHERE integracion='render_automations' AND accion='scheduled_complete'
    AND canal='system' AND actor_id='render-worker'
    AND detalles->>'job'=$1 AND detalles->>'slot'=$2 LIMIT 1`;
const completeSQL = `INSERT INTO public.integracion_auditoria
  (integracion,canal,actor_id,actor_nombre,accion,detalles)
  VALUES('render_automations','system','render-worker','Render · Automatizaciones','scheduled_complete',$1::jsonb)`;

async function inspectCurrentSchema(db) {
  assertStartupMigrationStatus(await readMigrationStatus(db));
  await assertCoreSchemaReady(db);
}

// One invocation owns its pool. createPool() must enforce TLS/timeouts and a
// verified direct/session connection (never production transaction port 6543).
// No SQL probe here can establish a pooler's mode. Handlers use separate pool
// leases, await all their work, and must not acquire this guard mutex themselves.
// The web process never calls this runner. There are no timers or retries.
export async function runScheduledAutomations(options = {}) {
  let pool, db, listener, poolListener, began = false, owned = false;
  let lost = false, discard = false, failed = false, outcome;
  try {
    const policy = resolveScheduledAutomationPolicy(options.env ?? process.env);
    if (policy.paused) return result('PAUSED');
    // Capture callbacks and closed policy before the first asynchronous wait.
    const factory = options.createPool, handlers = options.handlers;
    const inspect = options.inspectSchema ?? inspectCurrentSchema;
    const clock = options.now ?? (() => new Date());
    if (typeof factory !== 'function' || typeof inspect !== 'function' || typeof clock !== 'function') throw failure();
    const selected = Object.freeze(policy.jobs.map(name => {
      const run = handlers?.[name];
      if (typeof run !== 'function') throw failure();
      return Object.freeze({ name, run });
    }));
    const stamp = clock();
    const time = Date.prototype.getTime.call(stamp);
    if (!Number.isFinite(time)) throw failure();
    const target = Object.freeze({ ...policy.target });
    const alive = () => { if (lost) throw failure(); };
    pool = await factory();
    if (!pool || typeof pool.connect !== 'function' || typeof pool.end !== 'function') throw failure();
    poolListener = () => { lost = true; };
    pool.on?.('error', poolListener);
    db = await pool.connect();
    discard = true;
    if (!db || typeof db.query !== 'function' || typeof db.release !== 'function'
      || typeof db.on !== 'function' || typeof db.removeListener !== 'function') throw failure();
    listener = () => { lost = true; discard = true; };
    db.on('error', listener);
    alive();
    const lock = await db.query('SELECT pg_try_advisory_lock(728194, 1) AS acquired');
    if (lock.rows?.length !== 1 || typeof lock.rows[0]?.acquired !== 'boolean') throw failure();
    owned = lock.rows[0].acquired;
    alive();
    discard = false;
    if (!owned) outcome = result('BUSY');
    else {
      // Identity, ledger and schema are observations only, on the retained
      // guard session. Jobs start only after this read-only transaction closes.
      discard = true;
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      began = true;
      alive();
      const identity = await readMigrationIdentity(db);
      alive();
      if (identity.database !== target.database || identity.username !== target.username || identity.port !== target.port
        || (target.environment !== 'production' && !isLoopbackAddress(identity.address))) throw failure();
      await inspect(db);
      alive();
      await db.query('COMMIT');
      began = false;
      alive();
      discard = false;
      const completed = [];
      for (const { name, run } of selected) {
        alive();
        const interval = name === 'supervisor' ? 300000 : 3600000;
        const slot = new Date(Math.floor(time / interval) * interval).toISOString();
        const checkpoint = await db.query(checkpointSQL, [name, slot]);
        alive();
        if (!Array.isArray(checkpoint.rows) || checkpoint.rows.length > 1) throw failure();
        if (checkpoint.rows.length) continue;
        // Give each callback its own Date so mutation cannot alter later jobs.
        // Domain adapters must throw for busy/retry outcomes (in particular
        // supervisor's {busy:true}); a resolved callback means completed work.
        // Do not inspect/return domain payloads or retry within this invocation.
        await run(pool, Object.freeze({ now: new Date(time) }));
        alive();
        // Autocommit only after domain work succeeds. This is a completion
        // checkpoint, not exactly-once delivery: a crash after domain COMMIT
        // but before this INSERT relies on each domain's existing idempotence.
        const marked = await db.query(completeSQL, [JSON.stringify({ version: 1, job: name, slot })]);
        alive();
        if (marked.rowCount !== 1) throw failure();
        completed.push(name);
      }
      outcome = result('COMPLETED', completed);
    }
  } catch {
    failed = true;
    discard = true;
  } finally {
    if (db) {
      if (began) {
        try { await db.query('ROLLBACK'); } catch { failed = true; discard = true; }
      }
      if (owned) {
        try {
          const unlocked = await db.query('SELECT pg_advisory_unlock(728194, 1) AS released');
          if (unlocked.rows?.length !== 1 || unlocked.rows[0]?.released !== true) throw failure();
        } catch { failed = true; discard = true; }
      }
      if (lost) { failed = true; discard = true; }
      // Keep the error listener attached through release/discard.
      try { db.release(discard ? failure() : undefined); } catch { failed = true; }
      try { if (listener) db.removeListener('error', listener); } catch { failed = true; }
    }
    if (pool) {
      try { await pool.end(); } catch { failed = true; }
      if (lost) failed = true;
      try { if (poolListener) pool.removeListener?.('error', poolListener); } catch { failed = true; }
    }
  }
  if (failed || !outcome) throw failure();
  return outcome;
}
