import { OAuth2Client } from 'google-auth-library';
import { driveError, validDriveUploadUrl, driveId } from './drive-upload-authority.js';

// OAuth2Client spreads RETRY_CONFIG into getToken/refresh requests, overriding
// constructor defaults. Enforce policy at the final per-instance request seam.
export function bindDriveOAuthTransport(client, signal, { fetchImpl = globalThis.fetch } = {}) {
  const transporter = client.transporter;
  const request = transporter.request.bind(transporter);
  transporter.request = options => {
    signal.throwIfAborted();
    return request({ ...options, retry: false, maxRedirects: 0, timeout: 15000, signal,
      retryConfig: { retry: 0, noResponseRetries: 0, shouldRetry: () => false },
      fetchImplementation: (url, init) => {
        // Also preserve the phase signal at fetch dispatch: Gaxios can replace
        // an already-aborted signal when combining its own timeout signal.
        signal.throwIfAborted();
        const destination = new URL(url);
        if (destination.href !== 'https://oauth2.googleapis.com/token') throw driveError(400, 'DRIVE_URL_INVALID');
        return fetchImpl(url, { ...init, signal, redirect: 'error' });
      },
    });
  };
  return client;
}

export async function defaultDriveProvider({ signal, credentials }) {
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || 'https://sistema.rendercorrientes.com/api/drive/oauth/callback';
  const configured = Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
  // This instance owns its transporter: cancellation also covers getToken and refresh.
  const client = configured ? bindDriveOAuthTransport(new OAuth2Client({ clientId: process.env.GOOGLE_DRIVE_CLIENT_ID, clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET, redirectUri,
    transporterOptions: { signal, timeout: 15000, retry: false, maxRedirects: 0 } }), signal) : null;
  let credentialsLoaded = false, connected = false;
  async function headers() {
    if (!client) throw driveError(503, 'DRIVE_NOT_CONFIGURED');
    if (!credentialsLoaded) {
      if (!credentials?.refresh_token) throw driveError(503, 'GOOGLE_DRIVE_RECONNECT_REQUIRED');
      client.setCredentials(credentials); credentialsLoaded = true;
    }
    const value = await client.getRequestHeaders(); connected = true;
    return typeof value.entries === 'function' ? Object.fromEntries(value.entries()) : value;
  }
  async function request(url, options = {}, authorized = true) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'www.googleapis.com' || u.port || u.username || u.password || u.hash || !(/^\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/.test(u.pathname) || validDriveUploadUrl(url))) throw driveError(400, 'DRIVE_URL_INVALID');
    const auth = authorized ? await headers() : {};
    signal.throwIfAborted();
    return fetch(url, { ...options, signal, redirect: 'error', headers: { ...auth, ...options.headers } });
  }
  async function json(url, options) { const response = await request(url, options); if (!response.ok) throw driveError(503, 'DRIVE_PROVIDER_FAILED'); return response.json(); }
  return {
    status: async () => { if (configured) try { await headers(); } catch { /* status is a safe summary */ } return { configured, connected, reconnectRequired: configured && !connected }; },
    listChildren: async (parentId, { query = '', foldersOnly = false, limit = 100 } = {}) => {
      const escape = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const terms = [`'${escape(parentId)}' in parents`, 'trashed = false'];
      if (query) terms.push(`name contains '${escape(query)}'`);
      if (foldersOnly) terms.push("mimeType = 'application/vnd.google-apps.folder'");
      const params = new URLSearchParams({ q: terms.join(' and '), pageSize: String(Math.min(100, Math.max(1, Number(limit) || 100))), orderBy: 'folder,name_natural', fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,parents)' });
      return json(`https://www.googleapis.com/drive/v3/files?${params}`);
    },
    startUpload: async ({ name, mimeType, size, parentId }) => {
      const response = await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size) }, body: JSON.stringify({ name, mimeType, parents: [parentId] }) });
      if (!response.ok || !validDriveUploadUrl(response.headers.get('location'))) throw driveError(409, 'DRIVE_UPLOAD_UNCERTAIN');
      return { uploadUrl: response.headers.get('location') };
    },
    uploadChunk: async ({ uploadUrl, bytes, contentRange }) => {
      if (!validDriveUploadUrl(uploadUrl)) throw driveError(400, 'DRIVE_URL_INVALID');
      const response = await request(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'Content-Range': contentRange }, body: bytes }, false);
      if (response.status === 308) return { status: 308, received: response.headers.get('range') };
      if (response.status !== 200 && response.status !== 201) throw driveError(409, 'DRIVE_UPLOAD_UNCERTAIN');
      return { status: response.status, file: await response.json() };
    },
    trashFile: async id => { if (!driveId(id)) throw driveError(400, 'DRIVE_FILE_INVALID'); await json(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); },
    generateAuthUrl: async state => { if (!client) throw driveError(503, 'DRIVE_NOT_CONFIGURED'); return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive'], state }); },
    exchangeCode: async code => { if (!client) throw driveError(503, 'DRIVE_NOT_CONFIGURED'); signal.throwIfAborted(); const { tokens } = await client.getToken(code); return { refresh_token: tokens.refresh_token }; },
  };
}
