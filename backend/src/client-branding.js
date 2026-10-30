// Small raster logos are stored as versioned branding events in PostgreSQL.
// No external fetch, executable SVG or browser-only persistence is accepted.
export function validateClientLogo(value) {
  if (value === null) return null;
  const fail = () => { throw Object.assign(new Error('Usá un logo PNG, JPG o WebP de hasta 200 KB.'), {status:400}); };
  if (typeof value !== 'string' || value.length > 280000) return fail();
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return fail();
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 204800 || bytes.length < 12 || bytes.toString('base64') !== match[2]) return fail();
  const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid) return fail();
  return value;
}
export async function saveClientLogo(db, actor, clientId, logo) {
  await db.query(`INSERT INTO integracion_auditoria(integracion,canal,actor_id,actor_nombre,accion,resultado,detalles)
    VALUES('client_branding','web',$1,$2,'logo_updated','ok',$3::jsonb)`,
  [String(actor.id), actor.nombre || actor.usuario || 'Dirección', JSON.stringify({clientId:Number(clientId),logo})]);
}
