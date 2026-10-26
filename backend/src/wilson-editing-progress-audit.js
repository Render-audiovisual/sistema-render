import { createHash } from 'node:crypto';
import { loadEditingProgressAudit, normalizeEditingProgressQuery } from './editing-progress-ledger.js';

const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;
const denied = () => Object.assign(new Error('Esta auditoría requiere administración por chat privado.'), { status: 403 });

// Mount AFTER canonical signature-v2 middleware and resolveWilsonUser. This
// router does not establish transport authenticity or grant service access.
export function createWilsonEditingProgressAuditRouter({ express, pool }) {
  const router = express.Router();
  router.get('/auditoria-edicion', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    let db, discard;
    try {
      const w = req.wilson;
      if (!w || w.privateChat !== true || w.systemActor || !positive(w.userId)
        || w.channel !== 'whatsapp' || typeof w.actorId !== 'string' || !w.actorId.trim()) throw denied();
      // Copy before the first await; query/transport objects may be mutable.
      const captured = { userId: w.userId, channel: w.channel, actorId: w.actorId };
      const normalized = normalizeEditingProgressQuery(req.query);
      const query = { periodo: normalized.periodo, ...(normalized.editorId === null ? {} : { editor_id: String(normalized.editorId) }) };
      db = await pool.connect();
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await db.query(`SELECT u.id,u.rol,u.activo FROM usuarios u WHERE u.whatsapp_habilitado IS TRUE
          AND (u.whatsapp_id_hash=$1 OR EXISTS(SELECT 1 FROM mia_whatsapp_identities i
            WHERE i.usuario_id=u.id AND i.actor_hash=$1 AND i.enabled IS TRUE)) ORDER BY u.id`,
        [createHash('sha256').update(captured.actorId.replace(/^\+/, '')).digest('hex')]);
      const actor = result.rows[0];
      if (result.rows.length !== 1 || actor.id !== captured.userId || actor.activo !== true || actor.rol !== 'admin') throw denied();
      const body = await loadEditingProgressAudit(db, query);
      await db.query('COMMIT');
      return res.json(body);
    } catch (error) {
      if (db) { try { await db.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; } }
      if (error.status) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return next(error);
    } finally { db?.release(discard); }
  });
  return router;
}
