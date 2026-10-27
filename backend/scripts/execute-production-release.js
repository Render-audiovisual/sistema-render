import { open, realpath, stat } from 'node:fs/promises';
import { constants, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDatabaseTarget, isLoopbackAddress } from '../src/startup-policy.js';
import { buildDatabasePoolConfig } from '../src/database-transport.js';

export const PRODUCTION_RELEASE_HELP = `Ejecutor explícito, separado de prepare-hostinger-release.js.
  execute --request ABSOLUTE_PRIVATE_JSON --approval ABSOLUTE_PRIVATE_JSON --artifact ABSOLUTE_INSTALLED_DIRECTORY --backup ABSOLUTE_PRIVATE_BACKUP --receipt ABSOLUTE_NEW_PRIVATE_JSON
Requiere DATABASE_URL y RENDER_DB_ENVIRONMENT explícitos; nunca cambia el entorno.
Verifica manifest v2 y bytes instalados antes de conectar. No existe --force.
La aprobación externa es privada, con vencimiento y de un solo intento (incluso si falla).
isolated-rehearsal solo permite loopback; NO constituye aprobación productiva.
No autentica Hostinger ni verifica su configuración real. No genera aprobaciones.
Verifica bytes del backup, NO que pueda restaurarse ni que corresponda al snapshot.
Mantenimiento/configuración/conexión/restauración son atestaciones del operador
externas, no hechos independientemente verificados por un hash o booleano.
Mantener propiedad exclusiva del artefacto y del directorio privado de aprobaciones.
No borrar ni trasladar marcas .release-used-*; conservarlas tras fallos.`;

const invalid = () => new Error('Release execution rejected.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const within = (root, file) => { const relative = path.relative(root, file); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value && !/[\u0000-\u001f\u007f]/.test(value);
const sort = rows => rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function parseProductionReleaseArgs(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) throw invalid();
  if (!argv.length || argv.length === 1 && ['help', '--help', '-h'].includes(argv[0])) return { command: 'help' };
  const [command, ...rest] = argv, keys = ['--request', '--approval', '--artifact', '--backup', '--receipt'], flags = {};
  if (command !== 'execute' || rest.length !== 10) throw invalid();
  for (let index = 0; index < rest.length; index += 2) {
    const [key, value] = rest.slice(index, index + 2);
    if (!keys.includes(key) || Object.hasOwn(flags, key) || !absolute(value)) throw invalid();
    flags[key] = value;
  }
  if (keys.some(key => !flags[key]) || new Set(Object.values(flags)).size !== 5) throw invalid();
  return { command, request: flags['--request'], approval: flags['--approval'], artifact: flags['--artifact'], backup: flags['--backup'], receipt: flags['--receipt'] };
}

// Match the v2 packager's inventory, including npm's internal .bin symlinks.
// Nothing is executed or installed while verifying. Exclusive filesystem
// ownership is required, as with build-hostinger-output.mjs itself.
export function verifyInstalledReleaseArtifact(root, expectedSha256) {
  if (!absolute(root) || !hex(expectedSha256) || realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw invalid();
  const checked = relative => {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw invalid();
    let current = root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink() || !within(root, realpathSync(current))) throw invalid();
    }
    return current;
  };
  const manifestBytes = readFileSync(checked('release-manifest.json'));
  if (manifestBytes.length > 16 * 1024 * 1024 || hash(manifestBytes) !== expectedSha256) throw invalid();
  const manifest = JSON.parse(manifestBytes);
  if (manifest.version !== 2 || manifest.dependenciesInstalled !== true || !Array.isArray(manifest.files)
    || !Array.isArray(manifest.directories) || !hex(manifest.rootPackageSha256)
    || manifest.nodeMajor !== Number(process.versions.node.split('.')[0])) throw invalid();
  const expected = [...manifest.files, ...manifest.directories.map(relative => ({ path: relative, type: 'directory' })),
    { path: 'package.json', type: 'file', sha256: manifest.rootPackageSha256 }];
  if (new Set(expected.map(row => row.path)).size !== expected.length || expected.some(row => row.type === 'file'
    ? !exact(row, ['path', 'type', 'sha256']) || !hex(row.sha256) : !exact(row, ['path', 'type']) || row.type !== 'directory')) throw invalid();
  for (const row of expected) checked(row.path);
  const inventory = (directory, prefix = '', dependencyRoot = null) => {
    const rows = [];
    for (const name of readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name, file = path.join(directory, name), info = lstatSync(file);
      if (!dependencyRoot && (relative === 'release-manifest.json' || relative === 'backend/node_modules')) continue;
      if (info.isSymbolicLink()) {
        if (!dependencyRoot || !within(dependencyRoot, realpathSync(file))) throw invalid();
        rows.push({ path: relative, type: 'symlink', target: path.relative(dependencyRoot, realpathSync(file)).split(path.sep).join('/') });
      } else if (info.isDirectory()) rows.push({ path: relative, type: 'directory' }, ...inventory(file, relative, dependencyRoot));
      else if (info.isFile()) rows.push({ path: relative, type: 'file', sha256: hash(readFileSync(file)) });
      else throw invalid();
    }
    return sort(rows);
  };
  if (JSON.stringify(inventory(root)) !== JSON.stringify(sort(expected))) throw invalid();
  const proof = manifest.dependencyProof;
  if (!exact(proof, ['method', 'required', 'files', 'sha256']) || proof.method !== 'local-resolution-and-inventory'
    || !Array.isArray(proof.required) || !Array.isArray(proof.files) || !hex(proof.sha256)
    || hash(JSON.stringify({ required: proof.required, files: proof.files })) !== proof.sha256) throw invalid();
  let dependencies = [];
  try {
    const dependencyRoot = checked('backend/node_modules');
    if (!lstatSync(dependencyRoot).isDirectory()) throw invalid();
    dependencies = inventory(dependencyRoot, '', dependencyRoot);
  } catch (error) { if (error.code !== 'ENOENT' || proof.files.length || proof.required.length) throw error; }
  if (JSON.stringify(dependencies) !== JSON.stringify(proof.files)) throw invalid();
  const packageJson = JSON.parse(readFileSync(checked('backend/package.json'), 'utf8'));
  const names = Object.keys(packageJson.dependencies || {}).sort();
  if (JSON.stringify(proof.required.map(row => row.name)) !== JSON.stringify(names)) throw invalid();
  for (const row of proof.required) {
    if (!exact(row, ['name', 'entry', 'sha256']) || !hex(row.sha256) || typeof row.entry !== 'string'
      || !row.entry.startsWith(`backend/node_modules/${row.name}/`) || hash(readFileSync(checked(row.entry))) !== row.sha256) throw invalid();
  }
  return Object.freeze({ root, manifestSha256: expectedSha256 });
}

async function privateDirectory(directory) {
  if (await realpath(directory) !== directory) throw invalid();
  const info = await stat(directory);
  if (!info.isDirectory() || (info.mode & 0o077) || info.uid !== process.getuid()) throw invalid();
}
async function readPrivate(file) {
  await privateDirectory(path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 16 * 1024 * 1024) throw invalid();
    const bytes = await handle.readFile();
    return { value: JSON.parse(bytes), sha256: hash(bytes) };
  } finally { await handle.close(); }
}
async function newPrivate(file) {
  await privateDirectory(path.dirname(file));
  return open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
}
async function durableJson(handle, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (!written.bytesWritten) throw invalid();
    offset += written.bytesWritten;
  }
  await handle.truncate(bytes.length); await handle.sync();
}
async function privateBackupHash(file) {
  await privateDirectory(path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid() || (before.mode & 0o077) || before.size === 0) throw invalid();
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw invalid();
    return digest.digest('hex');
  } finally { await handle.close(); }
}

/** Request transport envelope: {version:1,environment,manifestSha256,assignmentIntent}.
 * Private approval: {version:1,purpose,environment,requestSha256,nonce,
 * issuedAt,expiresAt,executorApproval}. Engine validates its own inner contract.
 * Approval is external authority evidence, NOT authenticated by a digest.
 * Exclusive marker is local one-attempt protection, not a cross-host DB receipt.
 */
export async function runProductionReleaseCli({ argv = process.argv.slice(2), env = process.env,
  now = () => Date.now(), loadExecutor = root => import(pathToFileURL(path.join(root, 'backend/src/production-release-executor.js')).href),
  createPool = async config => { const { default: pg } = await import('pg'); return new pg.Pool({ ...config, max: 1 }); },
  persistReceipt = durableJson, write = console.log, writeError = console.error } = {}) {
  let pool, receipt, claimed = false, committed = false;
  let receiptLinkage = Object.freeze({});
  try {
    const args = parseProductionReleaseArgs(argv);
    if (args.command === 'help') { write(PRODUCTION_RELEASE_HELP); return 0; }
    const target = readDatabaseTarget(env), config = buildDatabasePoolConfig(env);
    if (!config) throw invalid();
    const input = await readPrivate(args.request), { value: approval } = await readPrivate(args.approval), request = input.value;
    if (!exact(request, ['version', 'environment', 'manifestSha256', 'assignmentIntent']) || request.version !== 1
      || request.environment !== target.environment || !hex(request.manifestSha256)
      || !exact(request.assignmentIntent, ['choices', 'exceptions']) || !Array.isArray(request.assignmentIntent.choices)
      || !Array.isArray(request.assignmentIntent.exceptions)
      || !exact(approval, ['version', 'purpose', 'environment', 'requestSha256', 'nonce', 'issuedAt', 'expiresAt', 'executorApproval'])
      || approval.version !== 1 || !['production-release', 'isolated-rehearsal'].includes(approval.purpose)
      || approval.environment !== target.environment || approval.requestSha256 !== input.sha256 || !hex(approval.nonce)
      || !Number.isSafeInteger(approval.issuedAt) || !Number.isSafeInteger(approval.expiresAt)
      || approval.issuedAt > now() || approval.expiresAt <= now() || approval.expiresAt - approval.issuedAt > 30 * 60 * 1000
      || !approval.executorApproval || typeof approval.executorApproval !== 'object'
      || approval.executorApproval.environment !== target.environment || approval.executorApproval.purpose !== approval.purpose
      || approval.executorApproval.artifactSha256 !== request.manifestSha256
      || !hex(approval.executorApproval.scopeSha256)
      || typeof approval.executorApproval.expiresAt !== 'string'
      || Date.parse(approval.executorApproval.expiresAt) !== approval.expiresAt
      || approval.purpose === 'production-release' && target.environment !== 'production'
      || approval.purpose === 'isolated-rehearsal' && (!['test', 'sandbox'].includes(target.environment) || !isLoopbackAddress(target.hostname))) throw invalid();
    // Copy only validated SHA-256 primitives, never error fields or mutable
    // approval payloads. Keep the same attempt linkage even after an uncertain
    // COMMIT or a subsequent receipt-persistence failure.
    if (!hex(input.sha256)) throw invalid();
    receiptLinkage = Object.freeze({ scopeSha256: approval.executorApproval.scopeSha256, requestSha256: input.sha256 });
    const artifact = verifyInstalledReleaseArtifact(args.artifact, request.manifestSha256);
    if ([args.receipt, args.approval, args.request, args.backup].some(file => within(args.artifact, file))
      || await privateBackupHash(args.backup) !== approval.executorApproval.backup?.sha256) throw invalid();
    const engine = await loadExecutor(artifact.root);
    if (typeof engine.executeProductionRelease !== 'function') throw invalid();
    receipt = await newPrivate(args.receipt); // Fail BEFORE writes if existing/unwritable.
    const marker = await newPrivate(path.join(path.dirname(args.approval), `.release-used-${approval.nonce}`));
    claimed = true;
    try { await durableJson(marker, { version: 1, requestSha256: input.sha256, nonce: approval.nonce }); }
    finally { await marker.close(); }
    const directory = await open(path.dirname(args.approval), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    if (approval.expiresAt <= now()) throw invalid();
    // Reverify immediately before connecting/execution. No npm, server, HTTP or
    // environment rewrite. The engine is loaded from this verified artifact.
    verifyInstalledReleaseArtifact(args.artifact, request.manifestSha256);
    const scoped = approval.executorApproval;
    if (!Array.isArray(scoped.sql) || !scoped.sql.length || scoped.sql.some(row => !exact(row, ['name', 'sha256'])
      || typeof row.name !== 'string' || !/^[0-9]+_[A-Za-z0-9_]+\.sql$/.test(row.name) || !hex(row.sha256))
      || new Set(scoped.sql.map(row => row.name)).size !== scoped.sql.length) throw invalid();
    const migrations = scoped.sql.map(row => {
      const bytes = readFileSync(path.join(artifact.root, 'backend/migrations', row.name));
      if (hash(bytes) !== row.sha256) throw invalid();
      return { name: row.name, bytes };
    });
    pool = await createPool(config); pool.on?.('error', () => {});
    let consumedByEngine = false;
    const result = await engine.executeProductionRelease(pool, {
      approval: scoped, artifactBytes: readFileSync(path.join(artifact.root, 'release-manifest.json')),
      migrations, assignmentIntent: request.assignmentIntent,
    }, { environment: target.environment, now, consumeApproval: async scope => {
      if (consumedByEngine || !exact(scope, ['scopeSha256', 'expiresAt']) || scope.scopeSha256 !== scoped.scopeSha256
        || scope.expiresAt !== scoped.expiresAt || now() >= approval.expiresAt) throw invalid();
      consumedByEngine = true;
      return true;
    } });
    if (!consumedByEngine || result?.state !== 'COMMITTED' || result.scopeSha256 !== scoped.scopeSha256) throw invalid();
    committed = true;
    await persistReceipt(receipt, { version: 1, event: 'RELEASE_EXECUTION_COMPLETED', purpose: approval.purpose,
      environment: target.environment, ...receiptLinkage, manifestSha256: artifact.manifestSha256,
      state: 'COMMITTED', operatorAttestations: 'accepted-not-independently-verified', backupFileBytesShaVerified: true,
      backupRestorationProven: false, configurationActual: 'unverified-by-cli', hostingerAuthenticated: false });
    write(JSON.stringify({ event: 'RELEASE_EXECUTION_COMPLETED', purpose: approval.purpose, configurationActual: 'unverified' }));
    return 0;
  } catch (error) {
    const state = committed ? 'COMMITTED_RECEIPT_UNCONFIRMED' : error?.code === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'ABORTED_OR_UNCONFIRMED';
    if (receipt) try { await persistReceipt(receipt, { version: 1, event: 'RELEASE_EXECUTION_FAILED', approvalAttemptConsumed: claimed,
      ...receiptLinkage, state, retryRequiresNewApproval: true, stateRequiresInspection: true }); } catch { /* Keep generic output; never retry writes. */ }
    writeError(JSON.stringify({ event: 'RELEASE_EXECUTION_FAILED', state, retryRequiresNewApproval: true,
      message: 'Revisá el estado y el recibo privado; no reintentar con la misma aprobación. No se muestran secretos.' }));
    return 1;
  } finally {
    if (pool) try { await pool.end(); } catch { /* Never echo connection errors. */ }
    if (receipt) try { await receipt.close(); } catch { /* Receipt may require operator inspection. */ }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runProductionReleaseCli();
