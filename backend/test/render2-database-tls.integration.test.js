import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, access, chmod } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const hostname = 'db.test';
const rootPattern = /^\/private\/tmp\/render2-tls-[A-Za-z0-9]+$/;

// This is a physical socket/TLS + installed pg wire-startup proof, NOT a
// PostgreSQL server, password/SCRAM authentication test or SQL persistence test.
// Ordinary discovery does not import DB configuration or generate certificates.
test('database transport verifies CA and original hostname with actual pg TLS, using local-only synthetic PostgreSQL startup', {
  skip: process.env.RENDER2_RUN_LOCAL_TLS !== 'true', timeout: 90000,
}, async t => {
  const { buildDatabasePoolConfig } = await import('../src/database-transport.js');
  const root = await mkdtemp('/private/tmp/render2-tls-');
  assert.match(root, rootPattern);
  t.after(async () => {
    assert.match(root, rootPattern); // Never delete a configured or broad directory.
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), error => error.code === 'ENOENT');
    t.diagnostic(`Own ephemeral TLS certificate directory removed: ${root}`);
  });
  await chmod(root, 0o700);
  const file = name => path.join(root, name);
  const openssl = args => {
    try {
      execFileSync('/opt/homebrew/bin/openssl', args, { cwd: root, timeout: 15000,
        env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8', OPENSSL_CONF: '/dev/null' }, stdio: 'pipe' });
    } catch {
      // Do not dump child-process output, key material or ambient environment.
      throw new Error('Could not generate the isolated synthetic TLS certificates with installed OpenSSL.');
    }
  };
  for (const name of ['trusted', 'untrusted']) {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
      '-keyout', file(`${name}-ca.key`), '-out', file(`${name}-ca.pem`), '-subj', `/CN=Render2 isolated ${name} CA`,
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    await chmod(file(`${name}-ca.key`), 0o600);
  }
  const peers = [['matching', hostname, 'DNS'], ['mismatch', 'not-db.test', 'DNS'],
    ['ipv6matching', '2001:db8::10', 'IP'], ['ipv6mismatch', '2001:db8::11', 'IP'], ['expired', hostname, 'DNS']];
  for (const [index, [name, dns, type]] of peers.entries()) {
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', file(`${name}.key`),
      '-out', file(`${name}.csr`), '-subj', `/CN=${dns}`, '-addext', `subjectAltName=${type}:${dns}`,
      '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'extendedKeyUsage=serverAuth']);
    openssl(['x509', '-req', '-in', file(`${name}.csr`), '-CA', file('trusted-ca.pem'), '-CAkey', file('trusted-ca.key'),
      '-set_serial', String(5567701 + index), ...(name === 'expired'
        ? ['-not_before', '20200101000000Z', '-not_after', '20200102000000Z'] : ['-days', '2']),
      '-sha256', '-copy_extensions', 'copy',
      '-out', file(`${name}.pem`)]);
    await chmod(file(`${name}.key`), 0o600);
  }
  const trustedCA = await readFile(file('trusted-ca.pem'), 'utf8');
  const untrustedCA = await readFile(file('untrusted-ca.pem'), 'utf8');
  const certificates = {};
  for (const [name] of peers) certificates[name] = {
    key: await readFile(file(`${name}.key`)), cert: await readFile(file(`${name}.pem`)),
  };
  assert.equal(new X509Certificate(certificates.matching.cert).checkHost(hostname), hostname);
  assert.equal(new X509Certificate(certificates.mismatch.cert).checkHost(hostname), undefined);

  async function exercise({ certificate = 'matching', ca, accepts, expectedHost = hostname, errorCode }) {
    const sockets = new Set(), seen = { sslRequests: 0, startups: 0, secure: 0, queries: 0, names: [], violations: [] };
    const context = tls.createSecureContext(certificates[certificate]);
    const server = net.createServer(raw => {
      sockets.add(raw); raw.on('close', () => sockets.delete(raw)); raw.on('error', () => {});
      raw.setTimeout(5000, () => raw.destroy());
      let incoming = Buffer.alloc(0);
      const sslRequest = chunk => {
        incoming = Buffer.concat([incoming, chunk]);
        if (incoming.length < 8) return;
        raw.off('data', sslRequest);
        if (incoming.length !== 8 || incoming.readUInt32BE(0) !== 8 || incoming.readUInt32BE(4) !== 80877103) {
          seen.violations.push('Expected the PostgreSQL SSLRequest, not plaintext Startup'); raw.destroy(); return;
        }
        seen.sslRequests += 1; raw.write('S');
        const secured = new tls.TLSSocket(raw, { isServer: true, secureContext: context });
        sockets.add(secured); secured.on('close', () => sockets.delete(secured)); secured.on('error', () => {});
        secured.on('secure', () => { seen.secure += 1; seen.names.push(secured.servername); });
        let startup = Buffer.alloc(0), started = false;
        secured.on('data', data => {
          if (started) {
            // End ('X') is the only permitted post-startup packet. No SQL is implemented.
            if (data[0] !== 88) { seen.queries += 1; secured.destroy(); }
            else secured.end();
            return;
          }
          startup = Buffer.concat([startup, data]);
          if (startup.length < 8) return;
          const length = startup.readUInt32BE(0);
          if (length < 8 || length > 65536 || startup.readUInt32BE(4) !== 196608) {
            seen.violations.push('Invalid PostgreSQL Startup packet'); secured.destroy(); return;
          }
          if (startup.length < length) return;
          if (startup.length !== length) { seen.violations.push('Unexpected bytes after Startup'); secured.destroy(); return; }
          seen.startups += 1; started = true;
          // Synthetic AuthenticationOk + ReadyForQuery let installed pg finish
          // connect(). They deliberately do not establish real DB authentication.
          const authOK = Buffer.alloc(9); authOK[0] = 82; authOK.writeUInt32BE(8, 1); authOK.writeUInt32BE(0, 5);
          secured.write(Buffer.concat([authOK, Buffer.from([90, 0, 0, 0, 5, 73])]));
        });
      };
      raw.on('data', sslRequest);
    });
    let client;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address(); assert.equal(address.address, '127.0.0.1'); assert.ok(address.port > 0);
      const urlHost = net.isIP(expectedHost) === 6 ? `[${expectedHost}]` : expectedHost;
      const connectionString = `postgresql://render2_tls_fixture:synthetic_unused@${urlHost}:${address.port}/render2_tls_test`;
      const config = buildDatabasePoolConfig({ DATABASE_URL: connectionString, ...(ca === undefined ? {} : { RENDER_DB_CA_PEM: ca }) });
      assert.ok(config); assert.equal(config.host, expectedHost);
      assert.equal(Object.hasOwn(config, 'connectionString'), false, 'No second URL parse can override validated transport fields');
      assert.equal(config.ssl.rejectUnauthorized, true);
      assert.equal(Object.hasOwn(config, 'stream'), false, 'No production stream override is introduced');
      const requested = [];
      class LoopbackOnlySocket extends net.Socket {
        connect(port, host) {
          assert.equal(host, expectedHost, 'Keep the remote hostname in pg; never replace it to bypass TLS verification');
          assert.equal(Number(port), address.port);
          requested.push({ host, port: Number(port) });
          // Test-only routing: numeric loopback, no DNS or remote network path.
          // pg Connection.connect still receives db.test and supplies that exact
          // name to its ordinary TLS SNI/checkServerIdentity implementation.
          return super.connect({ host: '127.0.0.1', port: address.port });
        }
      }
      client = new pg.Client({ ...config, connectionTimeoutMillis: 3000, stream: () => new LoopbackOnlySocket() });
      client.on('error', () => {});
      assert.equal(client.host, expectedHost);
      assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
      let failure;
      try { await client.connect(); } catch (error) { failure = error; }
      assert.deepEqual(requested, [{ host: expectedHost, port: address.port }]);
      if (accepts) {
        assert.equal(failure, undefined, 'Trusted matching certificate must complete actual pg connect');
        assert.equal(client.connection.stream.authorized, true);
        assert.equal(seen.startups, 1); assert.equal(seen.secure, 1);
        if (net.isIP(expectedHost)) {
          assert.equal(Boolean(client.connection.stream.servername), false);
          assert.equal(seen.names.length, 1); assert.equal(Boolean(seen.names[0]), false);
        } else {
          assert.equal(client.connection.stream.servername, hostname); assert.deepEqual(seen.names, [hostname]);
        }
      } else {
        assert.ok(failure, 'Certificate failure must reject actual pg connect');
        if (errorCode) assert.equal(failure.code, errorCode);
        else if (certificate.includes('mismatch')) assert.equal(failure.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
        else if (certificate === 'expired') assert.equal(failure.code, 'CERT_HAS_EXPIRED');
        else assert.ok(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
          'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(failure.code), 'Expected a certificate trust-chain rejection');
        assert.equal(seen.startups, 0, 'Unverified peer must never receive PostgreSQL Startup credentials');
      }
      assert.equal(seen.sslRequests, 1); assert.equal(seen.queries, 0); assert.deepEqual(seen.violations, []);
    } finally {
      // Destroy only this case's sockets before awaiting listener close, even
      // when pg timed out or validation failed before a completed handshake.
      if (client) { client.connection.stream.destroy(); await client.end().catch(() => {}); }
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(() => resolve()));
      assert.equal(server.listening, false);
    }
  }

  await t.test('trusted explicit CA and matching original hostname complete actual pg TLS/Startup without SQL', () =>
    exercise({ ca: trustedCA, accepts: true }));
  await t.test('hosting single-line public CA preserves real TLS chain validation', () =>
    exercise({ ca: trustedCA.replace(/[\r\n]/g,''), accepts: true }));
  await t.test('hosting single-line public CA does not trust another issuer', () =>
    exercise({ ca: untrustedCA.replace(/[\r\n]/g,''), accepts: false }));
  await t.test('hosting single-line public CA still rejects a wrong SAN', () =>
    exercise({ certificate:'mismatch',ca:trustedCA.replace(/[\r\n]/g,''),accepts:false }));
  await t.test('valid CA bundle can contain another root without disabling identity verification', () =>
    exercise({ ca: `${untrustedCA}\n${trustedCA}`, accepts: true }));
  await t.test('untrusted CA rejects before PostgreSQL Startup', () =>
    exercise({ ca: untrustedCA, accepts: false }));
  await t.test('omitted private CA does not silently trust a self-issued test chain', () =>
    exercise({ accepts: false }));
  await t.test('trusted issuer but wrong certificate SAN rejects original hostname before PostgreSQL Startup', () =>
    exercise({ certificate: 'mismatch', ca: trustedCA, accepts: false }));
  await t.test('trusted issuer with expired certificate rejects before PostgreSQL Startup', () =>
    exercise({ certificate: 'expired', ca: trustedCA, accepts: false }));
  await t.test('remote IPv6 identity is checked by exact IP SAN without DNS/CN fallback or SNI', () =>
    exercise({ certificate: 'ipv6matching', ca: trustedCA, accepts: true, expectedHost: '2001:db8::10' }));
  await t.test('remote IPv6 wrong IP SAN rejects before PostgreSQL Startup', () =>
    exercise({ certificate: 'ipv6mismatch', ca: trustedCA, accepts: false, expectedHost: '2001:db8::10' }));
  await t.test('remote IPv6 never accepts a DNS-only certificate or its common name as an IP identity', () =>
    exercise({ certificate: 'matching', ca: trustedCA, accepts: false, expectedHost: '2001:db8::10', errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID' }));
  await t.test('loopback remains plaintext by default without influencing remote TLS cases', () => {
    const local = buildDatabasePoolConfig({ DATABASE_URL: 'postgresql://render2_tls_fixture@127.0.0.1:55678/render2_tls_test' });
    assert.equal(local.ssl, false);
  });
});
