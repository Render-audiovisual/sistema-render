import { createServer as nativeCreateServer } from 'node:http';
import { isIP } from 'node:net';

const FAILURE_MESSAGE = 'Render no pudo iniciar. Revisá la configuración del arranque.';
const HTML = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Render · Mantenimiento</title><body><main><h1>Render está en mantenimiento</h1><p>Volvé a intentar en unos minutos.</p></main></body></html>';
const HEALTH = JSON.stringify({ status: 'maintenance', databaseReady: false });
const UNAVAILABLE = JSON.stringify({ status: 'maintenance' });
const failure = () => Object.assign(new Error(FAILURE_MESSAGE), { code: 'RENDER_RUNTIME_START_FAILED' });
function configuration(env) {
  const mode = env.RENDER_MAINTENANCE;
  if (mode !== undefined && mode !== '' && mode !== 'false' && mode !== 'true') throw failure();
  const host = env.HOST === undefined ? '0.0.0.0' : env.HOST;
  if (typeof host !== 'string' || host.length > 255 || host !== 'localhost' && isIP(host) === 0) throw failure();
  const rawPort = env.PORT === undefined ? '3000' : env.PORT;
  if (typeof rawPort !== 'string' || !/^(0|[1-9][0-9]{0,4})$/.test(rawPort)
    || rawPort.length > 5 || Number(rawPort) > 65535 || String(Number(rawPort)) !== rawPort) throw failure();
  return { maintenance: mode === 'true', host, port: Number(rawPort) };
}
function reportFatal() {
  process.exitCode = 1;
  console.error(FAILURE_MESSAGE); // Never include raw errors, configuration or connection details.
}
function close(server) {
  try { server.closeAllConnections?.(); } catch { /* best effort after fatal server error */ }
  try { server.close(() => {}); } catch { /* listener may never have opened */ }
}
function respond(req, res) {
  const readable = req.method === 'GET' || req.method === 'HEAD';
  const root = readable && req.url === '/', health = readable && req.url === '/health';
  const body = root ? HTML : health ? HEALTH : UNAVAILABLE;
  res.writeHead(root || health ? 200 : 503, {
    'Content-Type': root ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  req.resume(); // Discard unsupported request bodies; never parse or dispatch them.
}

// All dependency injection is process-local test machinery, never HTTP/env input.
// Importing this module normally starts it (including LiteSpeed require()). Tests
// importing the reusable functions must first set RENDER_DISABLE_SERVER_START=true.
export async function startRuntimeEntrypoint({ env = process.env,
  importServer = () => import('./server.js'), createServer = nativeCreateServer,
  onFatal = reportFatal } = {}) {
  let server;
  try {
    const config = configuration(env);
    if (!config.maintenance) return { mode: 'application', module: await importServer() };
    // No application/database/dotenv import has occurred on this branch.
    server = createServer(respond);
    server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
    server.maxHeadersCount = 100;
    return await new Promise((resolve, reject) => {
      let ready = false, failed = false;
      server.on('error', () => {
        if (failed) return;
        failed = true;
        close(server);
        if (!ready) reject(failure());
        else { try { onFatal(); } catch { reportFatal(); } }
      });
      server.on('clientError', (_error, socket) => { try { socket.destroy(); } catch { /* no diagnostic echo */ } });
      server.once('listening', () => {
        if (failed) return;
        ready = true;
        resolve({ mode: 'maintenance', server });
      });
      server.listen(config.port, config.host);
    });
  } catch {
    if (server) close(server);
    throw failure();
  }
}

// Explicit terminal catch covers dynamic-import rejection and synchronous factory/
// bind failures. No top-level await: Node24/LiteSpeed can require this ESM file.
export function launchRuntimeEntrypoint(options = {}) {
  return startRuntimeEntrypoint(options).then(result => {
    if (result.mode === 'maintenance' && process.send) {
      try { process.send({ type: 'render-startup-ready', port: result.server.address().port }); }
      catch { close(result.server); throw failure(); }
    }
    return result;
  }).catch(() => {
    try { (options.onFatal ?? reportFatal)(); } catch { reportFatal(); }
    return null;
  });
}

if (process.env.RENDER_DISABLE_SERVER_START !== 'true') void launchRuntimeEntrypoint();
