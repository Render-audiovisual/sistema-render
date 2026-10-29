import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

const invalid = () => new Error('Configuración de transporte PostgreSQL no válida. Revisá el destino explícito y su autoridad TLS.');
const controls = /[\u0000-\u001f\u007f]/;
function target(value) {
  try {
    if (typeof value !== 'string' || !value || value.length > 65536 || value.trim() !== value || controls.test(value)) throw invalid();
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || value.includes('?') || value.includes('#')) throw invalid();
    const host = decodeURIComponent(url.hostname).replace(/^\[|\]$/g, '').toLowerCase();
    const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
    const database = decodeURIComponent(url.pathname.slice(1));
    const port = Number(url.port || 5432);
    if (!host || (!isIP(host) && !/^[a-z0-9._-]+$/i.test(host)) || !user || !database
      || database.includes('/') || [user,password,database].some(text => controls.test(text))
      || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw invalid();
    return { host, user, password, database, port };
  } catch { throw invalid(); } // Never retain a URL/credential-bearing parser error.
}

export function isLoopbackDatabaseUrl(value) {
  try { return ['localhost', '127.0.0.1', '::1'].includes(target(value).host); }
  catch { return false; }
}

function certificateBundle(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 262144) throw invalid();
  // A single-line hosting input can remove PEM line breaks. Reconstruct only
  // one strictly bounded public certificate; X509 parsing and CA validation
  // below still apply. This never accepts private keys, paths or trust bypasses.
  if (!/[\r\n]/.test(value)) {
    const flat = value.trim().match(/^-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=]+)-----END CERTIFICATE-----$/);
    if (flat) value = `-----BEGIN CERTIFICATE-----\n${flat[1]}\n-----END CERTIFICATE-----`;
  }
  const pattern = /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g;
  const certificates = value.match(pattern);
  if (!certificates?.length || certificates.length > 16 || value.replace(pattern, '').trim()) throw invalid();
  try { for (const pem of certificates) if (new X509Certificate(pem).ca !== true) throw invalid(); }
  catch { throw invalid(); }
  return certificates.join('\n');
}

/** No connections, file reads, environment mutation or trust bypasses. */
export function buildDatabasePoolConfig(env = {}) {
  // Inert imports must not let pg defaults select an inherited PGHOST target.
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === '') return null;
  const parsed = target(env.DATABASE_URL), local = ['localhost', '127.0.0.1', '::1'].includes(parsed.host);
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw invalid();
  if (env.PGSSLMODE && env.PGSSLMODE !== 'verify-full') throw invalid();
  if (local && env.PGSSLMODE) throw invalid();
  if (env.PGSSLNEGOTIATION && env.PGSSLNEGOTIATION !== 'postgres') throw invalid();
  for (const key of ['PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLCRL']) if (env[key]) throw invalid();
  const ca = env.RENDER_DB_CA_PEM === undefined ? undefined : certificateBundle(env.RENDER_DB_CA_PEM);
  if (local && ca !== undefined) throw invalid(); // Never silently ignore an intended TLS trust configuration.
  const { password, ...connection } = parsed;
  return {
    ...connection,
    // A supplied function prevents pg from falling back to PGPASSWORD/.pgpass
    // when this explicit URL intentionally carries an empty password.
    password: () => password,
    sslnegotiation: 'postgres',
    connectionTimeoutMillis: 10000,
    ssl: local ? false : {
      rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(ca === undefined ? {} : { ca }),
      // pg sets SNI for DNS names but not IP literals. Always bind certificate
      // identity to the validated destination, including remote IPv4/IPv6.
      checkServerIdentity: (_name, certificate) => {
        if (isIP(connection.host) !== 6) return checkServerIdentity(connection.host, certificate);
        // Node24's DNS-to-ASCII step rejects bare IPv6 in checkServerIdentity.
        // OpenSSL's X509 IP-SAN verifier handles the literal without DNS/CN fallback.
        try { if (new X509Certificate(certificate.raw).checkIP(connection.host)) return undefined; } catch { /* Invalid peer certificate denies. */ }
        return Object.assign(new Error('El certificado PostgreSQL no coincide con el destino.'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      },
    },
  };
}
