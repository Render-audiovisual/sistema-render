// Complete feed observations, separate from task status and metric availability.
export const FEED_SNAPSHOT_ACTION = 'feed_snapshot_v1';
export const FEED_FRESHNESS_MS = 3 * 3600000;
export const feedCountsAreTrusted = status => ['current','historical','confirmed'].includes(status);
const id = value => typeof value === 'string' && /^[1-9]\d{0,39}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function feedMonthBounds(period) {
  if (typeof period !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Mes inválido');
  const [year,month]=period.split('-').map(Number);
  return {start:Date.UTC(year,month-1,1,3),end:Date.UTC(year,month,1,3)};
}
export function validateFeedCountSnapshot(value,{clientId,igUserId,period}={}) {
  try {
    if (!value || value.version!==1 || value.source!=='meta_graph_feed' || !Number.isSafeInteger(value.clientId) || value.clientId<=0 || !id(value.igUserId) ||
      !/^[A-Za-z0-9_.]{1,30}$/.test(value.username) || !date(value.windowStart) || !date(value.checkedAt) || !Array.isArray(value.posts) || value.posts.length>5000 ||
      (clientId!==undefined&&value.clientId!==clientId)||(igUserId!==undefined&&value.igUserId!==igUserId)||(period!==undefined&&value.period!==period)) return null;
    const {start,end}=feedMonthBounds(value.period),checked=Date.parse(value.checkedAt);
    if(Date.parse(value.windowStart)>start||checked<start) return null;
    const posts=[],seen=new Set();
    for(const post of value.posts){
      if(!id(post?.id)||!['reel','carrusel','imagen'].includes(post.kind)||!date(post.publishedAt)||seen.has(post.id))return null;
      const time=Date.parse(post.publishedAt);if(time<start||time>=end||time>checked)return null;
      seen.add(post.id);posts.push({id:post.id,kind:post.kind,publishedAt:post.publishedAt});
    }
    return {version:1,source:'meta_graph_feed',clientId:value.clientId,igUserId:value.igUserId,username:value.username,
      period:value.period,windowStart:value.windowStart,checkedAt:value.checkedAt,posts};
  }catch{return null;}
}
export function buildFeedCountSnapshots({clientId,igUserId,username,from,to,media}) {
  if(!(from instanceof Date)||!(to instanceof Date)||!Number.isFinite(+from)||!Number.isFinite(+to)||+from>+to||!Array.isArray(media))throw new Error('Ventana inválida');
  const unique=new Map();
  for(const item of media){
    if(!id(item?.igMediaId)||!['reel','carrusel','imagen'].includes(item.tipo)||!(item.publishedAt instanceof Date)||!Number.isFinite(+item.publishedAt)||+item.publishedAt<+from||+item.publishedAt>+to)throw new Error('Inventario inválido');
    const post={id:item.igMediaId,kind:item.tipo,publishedAt:item.publishedAt.toISOString()},prior=unique.get(post.id);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(post))throw new Error('Publicación contradictoria');
    unique.set(post.id,post);
  }
  const snapshots=[];
  // A rolling 90-day read fully covers at most four calendar months.
  const cursor=new Date(from.getTime()-3*3600000);cursor.setUTCDate(1);cursor.setUTCHours(3,0,0,0);
  while(+cursor<=+to){
    const period=cursor.toISOString().slice(0,7),{start,end}=feedMonthBounds(period);
    if(start>=+from){
      const snapshot=validateFeedCountSnapshot({version:1,source:'meta_graph_feed',clientId,igUserId,username,period,windowStart:from.toISOString(),checkedAt:to.toISOString(),
        posts:[...unique.values()].filter(p=>Date.parse(p.publishedAt)>=start&&Date.parse(p.publishedAt)<end).sort((a,b)=>a.id.localeCompare(b.id))});
      if(!snapshot)throw new Error('Cobertura inválida');snapshots.push(snapshot);
    }
    cursor.setUTCMonth(cursor.getUTCMonth()+1);
  }
  return snapshots;
}
export function instagramFeedGroupCounts(clients,period,{now=new Date()}={}) {
  if(!Array.isArray(clients)||!clients.length||!Number.isFinite(+now))return {status:'unavailable',reels:null,carruseles:null,checkedAt:null};
  const snapshots=clients.map(c=>validateFeedCountSnapshot(c.instagram_feed_snapshot,{clientId:c.id,igUserId:c.instagram_account_id,period}));
  if(snapshots.some(s=>!s)||clients.some(c=>c.instagram_account_active!==true))return {status:'unavailable',reels:null,carruseles:null,checkedAt:null};
  const posts=new Map();
  for(const s of snapshots)for(const post of s.posts){const prior=posts.get(post.id);if(prior&&(prior.kind!==post.kind||prior.publishedAt!==post.publishedAt))return {status:'unavailable',reels:null,carruseles:null,checkedAt:null};posts.set(post.id,post);}
  const checkedAt=snapshots.map(s=>s.checkedAt).sort()[0],age=+now-Date.parse(checkedAt),{end}=feedMonthBounds(period),closed=+now>=end;
  if(age<0)return {status:'unavailable',reels:null,carruseles:null,checkedAt:null};
  if(closed&&snapshots.some(s=>Date.parse(s.checkedAt)<end))return {status:'unavailable',reason:'month_incomplete',reels:null,carruseles:null,checkedAt};
  return {status:closed?'historical':age<=FEED_FRESHNESS_MS?'current':'stale',reels:[...posts.values()].filter(p=>p.kind==='reel').length,
    carruseles:[...posts.values()].filter(p=>p.kind==='carrusel').length,imagenes:[...posts.values()].filter(p=>p.kind==='imagen').length,checkedAt,posts:[...posts.values()]};
}
