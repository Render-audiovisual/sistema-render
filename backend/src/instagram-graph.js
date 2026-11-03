// Cliente mínimo y de solo lectura para la Graph API de Meta.
// Auth via Authorization. Only Meta's debug_token contract also requires an
// input_token parameter; diagnostic URLs/bodies must never be logged/returned.
const GRAPH_HOST = 'graph.facebook.com';
const DEFAULT_VERSION = 'v23.0';
export const MEDIA_COVERS_ACTION = 'media_covers_v1';
export const COVER_MAX_AGE_MS = 24 * 3600000;

// Only raster URLs on Meta's CDN, never arbitrary URLs or raw video assets.
// Signed CDN parameters are retained; Graph credentials must never persist.
export function normalizeCoverUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash ||
      !/^(?:[a-z0-9-]+\.)+(?:cdninstagram\.com|fbcdn\.net)$/.test(u.hostname) ||
      !/\.(?:jpe?g|png|webp|avif)$/i.test(decodeURIComponent(u.pathname)) ||
      [...u.searchParams.keys()].some(k => /^(?:access_token|token|authorization|bearer)$/i.test(k))) return null;
    return u.href;
  } catch { return null; }
}

export function normalizeMediaCover(row) {
  if (row?.media_type === 'VIDEO') return normalizeCoverUrl(row.thumbnail_url);
  if (row?.media_type === 'IMAGE') return normalizeCoverUrl(row.media_url);
  if (row?.media_type === 'CAROUSEL_ALBUM') {
    const first = row.children?.data?.[0];
    if (first?.media_type === 'VIDEO') return normalizeCoverUrl(first.thumbnail_url);
    if (first?.media_type === 'IMAGE') return normalizeCoverUrl(first.media_url);
  }
  return null;
}

// Closed, account-bound cache contract, independent from certified feed counts.
export function normalizeCoverSnapshot(value, { clientId, igUserId, now = new Date() }) {
  const iso = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
  if (value?.version !== 1 || value.clientId !== clientId || value.igUserId !== igUserId ||
    !iso(value.checkedAt) || Date.parse(value.checkedAt) > +now || !Array.isArray(value.items) || value.items.length > 1000) return null;
  const items = [], seen = new Set();
  for (const item of value.items) {
    if (!/^[1-9]\d{0,39}$/.test(item?.id) || seen.has(item.id) || !['reel', 'carrusel', 'imagen'].includes(item.kind) ||
      !iso(item.checkedAt) || Date.parse(item.checkedAt) > Date.parse(value.checkedAt)) return null;
    seen.add(item.id);
    items.push({ id: item.id, kind: item.kind, url: normalizeCoverUrl(item.url), checkedAt: item.checkedAt });
  }
  return { version: 1, clientId, igUserId, checkedAt: value.checkedAt, items };
}
const METRIC_SETS = Object.freeze([
  'reach,views,likes,comments,saved,shares,total_interactions',
  'reach,likes,comments,saved,shares,total_interactions',
  'reach,likes,comments,saved',
]);
const METRIC_COLUMNS = Object.freeze({
  reach: 'alcance', views: 'vistas', likes: 'likes', comments: 'comentarios',
  saved: 'guardados', shares: 'compartidos', total_interactions: 'interacciones',
});

export class GraphError extends Error {
  constructor(kind, { status = 0, code = 0 } = {}) {
    super(`Meta Graph API: ${kind}`);
    this.kind = kind; this.status = status; this.graphCode = code;
  }
}

// auth = token inválido/vencido (detiene todo), rate = límite de Meta (reintentar
// en la próxima corrida), permission = la cuenta no autorizó métricas,
// metric = métrica no soportada, other = resto.
function classify(status, error) {
  const code = Number(error?.code) || 0;
  if (code === 190 || status === 401) return 'auth';
  if ([4, 17, 32, 613, 80001, 80002].includes(code) || status === 429) return 'rate';
  if (code === 10 || code === 200 || (code >= 200 && code < 300) || status === 403) return 'permission';
  if (code === 100) return 'metric';
  return 'other';
}

export function resolveGraphConfig(env = {}) {
  const token = env.META_SYSTEM_USER_TOKEN;
  if (typeof token !== 'string' || token.length < 20 || token.length > 1024 || /\s/.test(token))
    throw new GraphError('config');
  const version = env.META_GRAPH_VERSION || DEFAULT_VERSION;
  if (!/^v\d{1,2}\.\d$/.test(version)) throw new GraphError('config');
  const businessId = env.META_BUSINESS_ID || null;
  if (businessId !== null && (typeof businessId !== 'string' || !/^[1-9]\d{0,31}$/.test(businessId)))
    throw new GraphError('config');
  return Object.freeze({ token, version, businessId });
}

export function createGraphClient({ token, version, businessId = null }, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== 'function' || (businessId !== null && (typeof businessId !== 'string' || !/^[1-9]\d{0,31}$/.test(businessId))))
    throw new GraphError('config');

  async function request(url, requestTimeoutMs = timeoutMs) {
    if (url.hostname !== GRAPH_HOST || url.protocol !== 'https:' || url.port || url.username || url.password)
      throw new GraphError('other');
    url.searchParams.delete('access_token');
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch { throw new GraphError('network'); }
    let body = null;
    try { body = await response.json(); } catch { /* cuerpo no JSON */ }
    if (!response.ok || body?.error) {
      const kind = classify(response.status, body?.error);
      throw new GraphError(kind, { status: response.status, code: Number(body?.error?.code) || 0 });
    }
    if (!body || typeof body !== 'object') throw new GraphError('other');
    return body;
  }

  const build = (path, params) => {
    const url = new URL(`https://${GRAPH_HOST}/${version}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url;
  };

  async function* pages(url, maxPages = 20) {
    let next = url;
    for (let page = 0; next && page < maxPages; page += 1) {
      const body = await request(next);
      if (!Array.isArray(body.data) || (body.paging != null &&
        (typeof body.paging !== 'object' || Array.isArray(body.paging))) ||
        (body.paging?.next != null && (typeof body.paging.next !== 'string' || !body.paging.next)))
        throw new GraphError('pagination');
      yield body.data;
      next = typeof body.paging?.next === 'string' ? new URL(body.paging.next) : null;
    }
    // A partial account inventory must never deactivate unseen accounts.
    if (next) throw new GraphError('pagination');
  }

  return Object.freeze({
    // Read-only diagnostics, isolated from the sync worker's existing methods.
    async debugToken() {
      return (await request(build('debug_token', { input_token: token }))).data;
    },
    async listConnectionPages() {
      const found = new Map();
      const collect = async (source, withTasks = true) => {
        try { for await (const rows of pages(build(source, {
          fields: `id,name,${withTasks ? 'tasks,' : ''}instagram_business_account{id}`, limit: 100,
        }), 5)) for (const page of rows) {
          if (!page?.id) continue;
          const id = String(page.id), prior = found.get(id);
          found.set(id, { ...page, tasks_known: prior?.tasks_known === true || Array.isArray(page.tasks),
            tasks: [...new Set([...(Array.isArray(prior?.tasks) ? prior.tasks : []), ...(Array.isArray(page.tasks) ? page.tasks : [])])] });
        } } catch(error) {
          if (withTasks && error instanceof GraphError && error.kind === 'metric') return collect(source, false);
          throw error;
        }
      };
      try {
        await collect('me/accounts');
        if (found.size || !businessId) return [...found.values()];
      } catch (error) {
        if (!businessId || !(error instanceof GraphError) || !['permission', 'metric'].includes(error.kind)) throw error;
      }
      found.clear();
      await collect(`${businessId}/owned_pages`);
      await collect(`${businessId}/client_pages`);
      return [...found.values()];
    },
    async listAdAccounts() {
      const found = new Map();
      for await (const rows of pages(build('me/adaccounts', { fields: 'id,name,account_status', limit: 100 }), 5))
        for (const account of rows) if (account?.id) found.set(String(account.id), account);
      return [...found.values()];
    },
    // Páginas asignadas al usuario del sistema con su cuenta profesional de IG.
    async listInstagramAccounts() {
      const byId = new Map();
      const collect = async source => {
        for await (const rows of pages(build(source, {
          fields: 'id,instagram_business_account{id,username,followers_count}', limit: 100,
        }))) {
          for (const page of rows) {
            const ig = page?.instagram_business_account;
            if (!ig?.id || !ig?.username) continue;
            byId.set(String(ig.id), {
              igUserId: String(ig.id), username: String(ig.username), pageId: page.id ? String(page.id) : null,
              followers: Number.isSafeInteger(ig.followers_count) ? ig.followers_count : null,
            });
          }
        }
      };
      try {
        await collect('me/accounts');
        if (byId.size || !businessId) return [...byId.values()];
      } catch (error) {
        if (!businessId || !(error instanceof GraphError) || !['permission', 'metric'].includes(error.kind)) throw error;
      }
      // Both portfolio edges must be complete. A nonempty owned_pages result
      // must NOT skip client_pages, or shared client accounts would disappear.
      // Any partial/error result throws before storeAccounts can deactivate IDs.
      byId.clear();
      await collect(`${businessId}/owned_pages`);
      await collect(`${businessId}/client_pages`);
      return [...byId.values()];
    },

    // Complete bounded traversal: pinned/out-of-order old posts do not prove
    // the rest of the window is exhausted. Stories are intentionally excluded.
    async listMedia(igUserId, since, until = null) {
      if (!(since instanceof Date) || !Number.isFinite(+since) ||
        (until !== null && (!(until instanceof Date) || !Number.isFinite(+until) || +until < +since)))
        throw new GraphError('config');
      const items = new Map(), seen = new Map();
      const sinceSeconds = Math.floor(since.getTime() / 1000);
      const url = build(`${igUserId}/media`, {
        fields: 'id,media_type,media_product_type,permalink,timestamp,caption', limit: 50, since: sinceSeconds,
      });
      for await (const rows of pages(url)) {
        for (const row of rows) {
          if (row?.media_product_type === 'STORY') continue;
          const publishedAt = typeof row?.timestamp === 'string' ? new Date(row.timestamp) : null;
          if (!publishedAt || !Number.isFinite(+publishedAt)) throw new GraphError('inventory');
          // Timestamp alone can exclude legacy/IGTV or newly published items.
          // Keep traversing: no ordering assumption and no normalization of
          // irrelevant historical formats. Invalid timestamps cannot be excluded.
          if (+publishedAt < +since || (until !== null && +publishedAt > +until)) continue;
          const media = normalizeMedia(row);
          // Silently dropping a malformed feed item would certify a false zero.
          if (!media) throw new GraphError('inventory');
          const serialized = JSON.stringify(media), prior = seen.get(media.igMediaId);
          if (prior !== undefined && prior !== serialized) throw new GraphError('inventory');
          seen.set(media.igMediaId, serialized);
          items.set(media.igMediaId, media);
        }
      }
      return [...items.values()];
    },

    // Optional, separate read: fields/permissions for covers cannot invalidate
    // a complete feed inventory. Never fetch image bytes or expose the token.
    async mediaCover(igMediaId) {
      if (typeof igMediaId !== 'string' || !/^[1-9]\d{0,39}$/.test(igMediaId)) throw new GraphError('config');
      const body = await request(build(igMediaId, {
        fields: 'id,media_type,thumbnail_url,media_url,children.limit(1){media_type,thumbnail_url,media_url}',
      }), Math.min(timeoutMs, 5000));
      if (String(body.id) !== igMediaId) return null;
      return normalizeMediaCover(body);
    },

    // Métricas de una pieza. Prueba conjuntos más chicos si Meta rechaza alguna métrica.
    async mediaInsights(igMediaId) {
      for (const metric of METRIC_SETS) {
        try {
          const body = await request(build(`${igMediaId}/insights`, { metric }));
          const result = normalizeInsights(body.data);
          // Combined views already include Facebook. Fetch separately so an
          // unsupported crossposting metric cannot remove ordinary insights.
          const extra = {};
          for (const names of ['crossposted_views,facebook_views', 'crossposted_views', 'facebook_views']) {
            if (names === 'crossposted_views' && extra.crossposted_views !== undefined) continue;
            if (names === 'facebook_views' && extra.facebook_views !== undefined) continue;
            try {
              const cross = await request(build(`${igMediaId}/insights`, { metric: names }));
              for (const row of cross.data ?? []) {
                if (!['crossposted_views', 'facebook_views'].includes(row?.name)) continue;
                const value = row.total_value?.value ?? row.values?.[0]?.value;
                if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) extra[row.name] = value;
              }
              if (names.includes(',') && extra.crossposted_views !== undefined && extra.facebook_views !== undefined) break;
            } catch (error) {
              if (!(error instanceof GraphError) || !['metric', 'permission'].includes(error.kind)) throw error;
            }
          }
          return { ...result, vistas_instagram: result.vistas,
            vistas_total: extra.crossposted_views ?? null, vistas_facebook: extra.facebook_views ?? null };
        } catch (error) {
          if (error instanceof GraphError && error.kind === 'metric') continue;
          throw error;
        }
      }
      throw new GraphError('metric');
    },
  });
}

export function normalizeMedia(row) {
  if (!row || typeof row !== 'object' || !/^\d{1,40}$/.test(String(row.id ?? ''))) return null;
  const product = row.media_product_type, type = row.media_type;
  let tipo = null;
  if (product === 'REELS' || (type === 'VIDEO' && product === 'FEED')) tipo = 'reel';
  else if (type === 'CAROUSEL_ALBUM' && product !== 'STORY') tipo = 'carrusel';
  else if (type === 'IMAGE' && product === 'FEED') tipo = 'imagen';
  if (!tipo) return null;
  const publishedAt = new Date(row.timestamp);
  if (!Number.isFinite(publishedAt.getTime())) return null;
  let permalink;
  try {
    const url = new URL(row.permalink);
    if (url.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(url.hostname)) return null;
    permalink = `https://www.instagram.com${url.pathname}`;
  } catch { return null; }
  const caption = typeof row.caption === 'string' ? row.caption.slice(0, 2200) : '';
  return { igMediaId: String(row.id), tipo, permalink, caption, publishedAt };
}

export function normalizeInsights(data) {
  const result = { alcance: null, vistas: null, likes: null, comentarios: null, guardados: null, compartidos: null, interacciones: null };
  if (!Array.isArray(data)) return result;
  for (const entry of data) {
    const column = METRIC_COLUMNS[entry?.name];
    if (!column) continue;
    const raw = entry.total_value?.value ?? entry.values?.[0]?.value;
    if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+$/.test(raw))) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= 0) result[column] = value;
  }
  return result;
}
