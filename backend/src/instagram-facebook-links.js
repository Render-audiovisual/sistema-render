// Operator-verified links only. Never match by caption/date or guess a Page.
export const FACEBOOK_LINK_ACTION = 'facebook_verified_media_link_v1';
const id = value => typeof value === 'string' && /^[1-9]\d{0,39}$/.test(value);
export function validFacebookLink(v, now = new Date()) {
  return v?.version === 1 && v.active === true && v.verifiedBy === 'visual_content'
    && [v.igMediaId,v.igUserId,v.pageId,v.facebookVideoId].every(id)
    && Number.isSafeInteger(v.clientId) && v.clientId > 0
    && typeof v.verifiedAt === 'string' && Number.isFinite(Date.parse(v.verifiedAt)) && Date.parse(v.verifiedAt) <= +now
    && typeof v.instagramPermalink === 'string' && /^https:\/\/www\.instagram\.com\/reel\/[A-Za-z0-9_-]+\/$/.test(v.instagramPermalink)
    && v.facebookPermalink === `https://www.facebook.com/reel/${v.facebookVideoId}/`;
}

export async function readVerifiedFacebookLinks(db, account, now = new Date()) {
  const rows = (await db.query(`SELECT detalles FROM integracion_auditoria
    WHERE integracion='instagram_graph' AND canal='system' AND actor_id='render-worker'
      AND accion=$1 AND resultado='ok' ORDER BY id DESC`, [FACEBOOK_LINK_ACTION])).rows;
  const latest = new Map();
  for (const {detalles:v} of rows) if (id(v?.igMediaId) && !latest.has(v.igMediaId)) latest.set(v.igMediaId,v);
  const valid = [...latest.values()].filter(v=>validFacebookLink(v,now));
  const used = new Map();
  for (const v of valid) used.set(v.facebookVideoId,(used.get(v.facebookVideoId)??0)+1);
  return new Map(valid.filter(v=>v.igUserId===account.ig_user_id && v.clientId===account.cliente_id
    && v.pageId===account.page_id && used.get(v.facebookVideoId)===1).map(v=>[v.igMediaId,v]));
}

export async function completeVerifiedFacebookViews(graph, item, values, link) {
  if (!link || item.tipo !== 'reel' || item.permalink !== link.instagramPermalink
    || item.igMediaId !== link.igMediaId || values.vistas_facebook !== null && values.vistas_facebook !== undefined) return values;
  const facebook = await graph.facebookVideoViews(link.pageId,link.facebookVideoId);
  if (!Number.isSafeInteger(facebook) || facebook < 0) return values;
  const instagram = values.vistas_instagram ?? values.vistas ?? null;
  const sum = Number.isSafeInteger(instagram) && instagram >= 0 ? instagram+facebook : null;
  return {...values,vistas_facebook:facebook,vistas_total:values.vistas_total ?? (Number.isSafeInteger(sum)?sum:null),
    facebookLink:link};
}

// Operator executor only; no HTTP route. Its caller retains the scheduler mutex.
// Serialize registrations separately and perform no network I/O under row locks.
export async function registerVerifiedFacebookLinks(pool, links, now = new Date()) {
  if (!Array.isArray(links) || links.length < 1 || links.length > 10 || links.some(v=>!validFacebookLink(v,now))
    || new Set(links.map(v=>v.igMediaId)).size!==links.length
    || new Set(links.map(v=>v.facebookVideoId)).size!==links.length) throw new Error('Vínculos no válidos');
  const db=await pool.connect();let discard;
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(728194,91)');
    const rows=(await db.query(`SELECT detalles FROM integracion_auditoria
      WHERE integracion='instagram_graph' AND canal='system' AND actor_id='render-worker'
        AND accion=$1 AND resultado='ok' ORDER BY id DESC`,[FACEBOOK_LINK_ACTION])).rows;
    const latest=new Map();for(const {detalles:v}of rows)if(id(v?.igMediaId)&&!latest.has(v.igMediaId))latest.set(v.igMediaId,v);
    let registered=0;
    for(const v of [...links].sort((a,b)=>a.igMediaId.localeCompare(b.igMediaId))){
      const current=(await db.query(`SELECT m.ig_media_id,m.ig_user_id,m.cliente_id,m.permalink,m.tipo,a.page_id,a.activa
        FROM instagram_media m JOIN instagram_cuentas a ON a.ig_user_id=m.ig_user_id AND a.cliente_id=m.cliente_id
        JOIN clientes c ON c.id=a.cliente_id
        WHERE m.ig_media_id=$1 AND COALESCE(c.activo,true) FOR UPDATE OF a`,[v.igMediaId])).rows[0];
      if(!current?.activa||current.tipo!=='reel'||current.ig_user_id!==v.igUserId||current.cliente_id!==v.clientId
        ||current.page_id!==v.pageId||current.permalink!==v.instagramPermalink)throw new Error('Cambió la cuenta o la publicación');
      for(const old of latest.values())if(validFacebookLink(old,now)&&old.facebookVideoId===v.facebookVideoId&&old.igMediaId!==v.igMediaId)
        throw new Error('Video de Facebook ya vinculado');
      const previous=latest.get(v.igMediaId);
      if(previous){
        if(!validFacebookLink(previous,now)||['igUserId','clientId','pageId','facebookVideoId','instagramPermalink','facebookPermalink'].some(k=>previous[k]!==v[k]))
          throw new Error('Vínculo previo diferente o revocado');
        continue;
      }
      const result=await db.query(`INSERT INTO integracion_auditoria
        (integracion,canal,actor_id,actor_nombre,accion,resultado,detalles)
        VALUES('instagram_graph','system','render-worker','Render · Instagram',$1,'ok',$2::jsonb)`,[FACEBOOK_LINK_ACTION,JSON.stringify(v)]);
      if(result.rowCount!==1)throw new Error('No se pudo registrar el vínculo');
      latest.set(v.igMediaId,v);registered++;
    }
    await db.query('COMMIT');return registered;
  }catch(error){try{await db.query('ROLLBACK');}catch(e){discard=e;}throw error;}
  finally{db.release(discard);}
}
