// Cliente mínimo y de solo lectura para la Graph API de Meta.
// El token viaja en el encabezado Authorization (nunca en URLs ni en logs).
const GRAPH_HOST = 'graph.facebook.com';
const DEFAULT_VERSION = 'v23.0';
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
  return Object.freeze({ token, version });
}

export function createGraphClient({ token, version }, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new GraphError('config');

  async function request(url) {
    if (url.hostname !== GRAPH_HOST || url.protocol !== 'https:' || url.port || url.username || url.password)
      throw new GraphError('other');
    url.searchParams.delete('access_token');
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
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
      yield Array.isArray(body.data) ? body.data : [];
      next = typeof body.paging?.next === 'string' ? new URL(body.paging.next) : null;
    }
    // A partial account inventory must never deactivate unseen accounts.
    if (next) throw new GraphError('pagination');
  }

  return Object.freeze({
    // Páginas asignadas al usuario del sistema con su cuenta profesional de IG.
    async listInstagramAccounts() {
      const accounts = [];
      const url = build('me/accounts', {
        fields: 'id,instagram_business_account{id,username,followers_count}', limit: 100,
      });
      for await (const rows of pages(url)) {
        for (const page of rows) {
          const ig = page?.instagram_business_account;
          if (!ig?.id || !ig?.username) continue;
          accounts.push({
            igUserId: String(ig.id), username: String(ig.username), pageId: page.id ? String(page.id) : null,
            followers: Number.isSafeInteger(ig.followers_count) ? ig.followers_count : null,
          });
        }
      }
      return accounts;
    },

    // Publicaciones del feed desde `since` (más nuevas primero). Las historias no se incluyen.
    async listMedia(igUserId, since) {
      const items = [];
      const sinceSeconds = Math.floor(since.getTime() / 1000);
      const url = build(`${igUserId}/media`, {
        fields: 'id,media_type,media_product_type,permalink,timestamp,caption', limit: 50, since: sinceSeconds,
      });
      for await (const rows of pages(url)) {
        let older = false;
        for (const row of rows) {
          const media = normalizeMedia(row);
          if (!media) continue;
          if (media.publishedAt < since) { older = true; continue; }
          items.push(media);
        }
        if (older) break;
      }
      return items;
    },

    // Métricas de una pieza. Prueba conjuntos más chicos si Meta rechaza alguna métrica.
    async mediaInsights(igMediaId) {
      for (const metric of METRIC_SETS) {
        try {
          const body = await request(build(`${igMediaId}/insights`, { metric }));
          return normalizeInsights(body.data);
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
