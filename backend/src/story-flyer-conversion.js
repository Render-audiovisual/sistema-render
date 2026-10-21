const fail = (message, status, code) => Object.assign(new Error(message), { status, code });

export async function convertUnlinkedFlyer(pool, rawId) {
  if (typeof rawId !== 'string' || !/^[1-9]\d*$/.test(rawId)
    || !Number.isSafeInteger(Number(rawId)) || Number(rawId) > 2147483647) {
    throw fail('Flyer inválido.', 400, 'FLYER_INVALID');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const source = await db.query("SELECT * FROM publicaciones WHERE id=$1 AND tipo='flyer' FOR UPDATE", [rawId]);
    if (!source.rowCount) throw fail('Flyer no encontrado en publicaciones.', 404, 'FLYER_NOT_FOUND');
    const piece = source.rows[0];
    // Deleting an attached publication can CASCADE its tasks or sever history.
    // Only an unlinked, unconfirmed record may use this legacy conversion.
    const links = await db.query(`SELECT
      EXISTS(SELECT 1 FROM tareas WHERE publicacion_id=$1)
      OR EXISTS(SELECT 1 FROM cliente_objetivo_piezas WHERE publicacion_id=$1)
      OR EXISTS(SELECT 1 FROM produccion_videos WHERE publicacion_id=$1)
      OR EXISTS(SELECT 1 FROM publicacion_envios WHERE publicacion_id=$1)
      OR EXISTS(SELECT 1 FROM editorial_publicacion_eventos WHERE publicacion_id=$1)
      OR EXISTS(SELECT 1 FROM editorial_archive_events WHERE publicacion_id=$1) AS linked`, [rawId]);
    if (links.rows[0].linked || [true,'true'].includes(piece.metadata?.archivado_tablero)
      || piece.estado === 'publicada' || piece.fecha_publicación_real != null) {
      throw fail('Este flyer tiene vínculos o historial. Se conserva sin convertir para no perder información.', 409, 'FLYER_REQUIRES_REVIEW');
    }
    const metadata = { ...(piece.metadata || {}), migrada_desde_flyer_id: piece.id, flyer_origen: piece };
    const result = await db.query(`INSERT INTO historias
      (cliente_id,estado,fecha_programada,responsable,responsable_diseño,responsable_revisión,responsable_publicacion,
       idea,copy,material_referencia,aclaraciones,prioridad,metadata,fecha_diseño_entrega,fecha_revisión_aprobación)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
      RETURNING id,cliente_id,estado,to_char(fecha_programada,'YYYY-MM-DD') AS fecha_programada,
        idea,copy,material_referencia,aclaraciones,prioridad,created_at`,
    [piece.cliente_id, piece.estado, piece.fecha_programada, piece.responsable, piece.responsable_diseño,
      piece.responsable_revisión, piece.responsable_publicacion, piece.idea, piece.copy, piece.material_referencia,
      piece.aclaraciones, piece.prioridad, JSON.stringify(metadata), piece.fecha_diseño_entrega, piece.fecha_revisión_aprobación]);
    await db.query('DELETE FROM publicaciones WHERE id=$1', [rawId]);
    await db.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}
