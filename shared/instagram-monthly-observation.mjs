// Public, read-only evidence contract. No credentials or persistence belong here.
export function instagramShortcode(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    return /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const calendar = Date.parse(value.slice(0,10) + 'T12:00:00Z');
  return Number.isFinite(calendar) && new Date(calendar).toISOString().slice(0,10) === value.slice(0,10);
}

export function validateInstagramMonthlyObservation(value, { clientId, period } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.boundaryVerified !== true ||
    !Number.isSafeInteger(value.clientId) || value.clientId <= 0 || (clientId !== undefined && value.clientId !== clientId) ||
    typeof value.period !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value.period) || (period !== undefined && value.period !== period) ||
    typeof value.handle !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.]{0,29}$/.test(value.handle) || !instant(value.checkedAt) ||
    !Array.isArray(value.posts) || !Array.isArray(value.boundary) || value.boundary.length !== 3 ||
    !Number.isSafeInteger(value.totalPosts) || value.totalPosts < 0) return null;
  const start = Date.parse(`${value.period}-01T00:00:00-03:00`);
  const [year, month] = value.period.split('-').map(Number);
  const end = Date.UTC(year, month, 1, 3);
  const checked = Date.parse(value.checkedAt), seen = new Map(), boundarySeen = new Set();
  const posts = [];
  for (const post of value.posts) {
    const code = instagramShortcode(post?.url);
    const time = Date.parse(post?.publishedAt);
    if (!code || !instant(post.publishedAt) || !['reel','carrusel','imagen'].includes(post.kind) || time < start || time >= end || time > checked) return null;
    if (seen.has(code)) {
      const prior = seen.get(code);
      if (prior.kind !== post.kind || Date.parse(prior.publishedAt) !== time) return null;
      continue;
    }
    const clean = { url: `https://www.instagram.com/${post.kind === 'reel' ? 'reel' : 'p'}/${code}/`, kind: post.kind, publishedAt: new Date(time).toISOString() };
    seen.set(code, clean); posts.push(clean);
  }
  const boundary = [];
  for (const post of value.boundary) {
    const code = instagramShortcode(post?.url), time = Date.parse(post?.publishedAt);
    if (!code || !instant(post.publishedAt) || time >= start || time > checked || boundarySeen.has(code) || seen.has(code)) return null;
    boundarySeen.add(code);
    boundary.push({ url: `https://www.instagram.com/p/${code}/`, publishedAt: new Date(time).toISOString() });
  }
  if (value.totalPosts !== posts.length || checked < start) return null;
  const result = { version: 1, period: value.period, clientId: value.clientId, handle: value.handle, totalPosts: posts.length,
    checkedAt: new Date(checked).toISOString(), boundaryVerified: true, posts, boundary };
  if (value.agencyAttribution !== undefined) {
    const a = value.agencyAttribution;
    if (!a || a.source !== 'owner_confirmation' || !instant(a.confirmedAt) || Date.parse(a.confirmedAt) < checked
      || !Number.isSafeInteger(a.reels) || a.reels < 0 || a.reels > posts.filter(p=>p.kind==='reel').length
      || !Number.isSafeInteger(a.carruseles) || a.carruseles < 0 || a.carruseles > posts.filter(p=>p.kind==='carrusel').length
      || !Array.isArray(a.carouselUrls) || new Set(a.carouselUrls.map(instagramShortcode)).size !== a.carruseles
      || a.carouselUrls.length !== a.carruseles || a.carouselUrls.some(url=>!posts.some(p=>p.kind==='carrusel'&&instagramShortcode(p.url)===instagramShortcode(url)))) return null;
    result.agencyAttribution = { source:a.source, confirmedAt:new Date(a.confirmedAt).toISOString(), reels:a.reels,
      carruseles:a.carruseles, carouselUrls:a.carouselUrls.map(url=>`https://www.instagram.com/p/${instagramShortcode(url)}/`) };
  }
  return result;
}

export function instagramMonthlyGroupObservation(clients, period) {
  if (!clients.length) return null;
  const snapshots = clients.map(client => validateInstagramMonthlyObservation(client.instagram_monthly_observation, { clientId: client.id, period }));
  if (snapshots.some(snapshot => !snapshot)) return null;
  if (snapshots.some(s=>s.agencyAttribution)) {
    // Aggregate attestations cannot identify which shared/collab videos overlap.
    // Do not guess union membership or silently count another feed's work.
    if(snapshots.length!==1) return null;
    const s=snapshots[0],a=s.agencyAttribution;
    return { reels:a.reels,carruseles:a.carruseles,totalPosts:a.reels+a.carruseles,checkedAt:a.confirmedAt,
      agencyConfirmed:true,profileReels:s.posts.filter(p=>p.kind==='reel').length,profileCarruseles:s.posts.filter(p=>p.kind==='carrusel').length };
  }
  const posts = new Map();
  for (const snapshot of snapshots) for (const post of snapshot.posts) {
    const code = instagramShortcode(post.url), prior = posts.get(code);
    if (prior && (prior.kind !== post.kind || prior.publishedAt !== post.publishedAt)) return null;
    posts.set(code, post);
  }
  return { reels: [...posts.values()].filter(post => post.kind === 'reel').length,
    carruseles: [...posts.values()].filter(post => post.kind === 'carrusel').length,
    totalPosts: posts.size, checkedAt: snapshots.map(snapshot => snapshot.checkedAt).sort()[0] };
}
