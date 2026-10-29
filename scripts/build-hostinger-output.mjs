import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const inputs = Object.freeze(['backend/package.json','backend/package-lock.json','backend/src',
  'backend/scripts','backend/migrations','shared','frontend/dist']);
const within = (parent, value) => {
  const relative = path.relative(parent, value);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const hash = data => createHash('sha256').update(data).digest('hex');
const forbidden = name => name === '.env' || name.startsWith('.env.')
  || /(?:\.dump|\.pem|\.key|\.private(?:\.json|\.log)?)$/i.test(name);

const publicKeyPath = 'backend/src/wilson-public-key.pem';
const sorted = entries => entries.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Check every component, not just the leaf: lstat(backend/src) follows backend.
function checkedPath(root, relative) {
  if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) throw new Error('Release root changed.');
  let current = root;
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..' || part.includes('\\')) throw new Error('Unsafe release path.');
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink() || !within(root, realpathSync(current)))
      throw new Error('Release input cannot contain symlinks or escape its root.');
  }
  return current;
}

function fileEntry(root, relative) {
  const absolute = checkedPath(root, relative), bytes = readFileSync(absolute);
  if (relative === publicKeyPath) {
    // createPublicKey also accepts PRIVATE keys; require exactly one public PEM.
    const pem = bytes.toString('utf8');
    if (!/^\s*-----BEGIN (PUBLIC KEY|RSA PUBLIC KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\s*$/.test(pem))
      throw new Error('The allowed PEM must contain only a public key.');
    try { createPublicKey(pem); } catch { throw new Error('Invalid release public key.'); }
  } else if (relative.split('/').some(forbidden)) throw new Error('Release input contains a private artifact.');
  return {path:relative,type:'file',sha256:hash(bytes)};
}

function inventory(root, prefix = '', skipOwnedDependencies = false) {
  const result = [];
  const directory = prefix ? checkedPath(root, prefix) : root;
  for (const name of readdirSync(directory).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (skipOwnedDependencies && relative === 'backend/node_modules') {
      if (!lstatSync(checkedPath(root, relative)).isDirectory()) throw new Error('Invalid owned dependency directory.');
      continue;
    }
    const absolute = checkedPath(root, relative), stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      if (forbidden(name)) throw new Error('Release input contains a private artifact.');
      result.push({path:relative,type:'directory'}, ...inventory(root, relative, skipOwnedDependencies));
    } else if (stat.isFile()) result.push(fileEntry(root, relative));
    else throw new Error('Unsupported release input.');
  }
  return sorted(result);
}

function inputInventory(source) {
  const entries = new Map();
  for (const relative of inputs) {
    const absolute = checkedPath(source, relative), stat = lstatSync(absolute);
    const parts = relative.split('/');
    for (let i=1;i<parts.length;i++) {
      const parent = parts.slice(0,i).join('/');
      entries.set(parent,{path:parent,type:'directory'});
    }
    if (stat.isDirectory()) {
      entries.set(relative,{path:relative,type:'directory'});
      for (const entry of inventory(source, relative)) entries.set(entry.path,entry);
    } else if (stat.isFile()) entries.set(relative,fileEntry(source, relative));
    else throw new Error('Unsupported release input.');
  }
  return sorted([...entries.values()]);
}

function verifyFrontend(source) {
  let canonical = false;
  const html = readFileSync(checkedPath(source,'frontend/dist/index.html'),'utf8');
  for (const tag of html.matchAll(/<(script|link|img|source|video|audio)\b[^>]*>/gi)) {
    for (const attribute of tag[0].matchAll(/\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gi)) {
      const reference = attribute[3];
      if (/^data:/i.test(reference) && /^(img|source)$/i.test(tag[1])) continue;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) throw new Error('Frontend assets must be local.');
      let decoded;
      try { decoded = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { throw new Error('Invalid frontend asset URL.'); }
      const local = decoded.replace(/^\//,'').replace(/^\.\//,'');
      if (!local || local.includes('\0') || local.includes('\\') || local.split('/').some(p => !p || p === '..' || p === '.'))
        throw new Error('Unsafe frontend asset path.');
      const absolute = checkedPath(source,`frontend/dist/${local}`);
      if (!lstatSync(absolute).isFile()) throw new Error('Frontend asset must be a file.');
      if (tag[1].toLowerCase() === 'script' && attribute[1].toLowerCase() === 'src' && /^assets\/index-[^/]+\.js$/.test(local)) canonical = true;
    }
  }
  if (!canonical) throw new Error('Canonical frontend build is missing.');
}

// node_modules is owned by this invocation, not omitted from integrity proof.
// Internal npm .bin links are valid; any link outside that tree is rejected.
function dependencyInventory(root, prefix = '') {
  const result = [];
  for (const name of readdirSync(path.join(root,prefix)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name, absolute = path.join(root,relative), stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const resolved = realpathSync(absolute);
      if (!within(root,resolved)) throw new Error('Dependency symlink escapes owned node_modules.');
      result.push({path:relative,type:'symlink',target:path.relative(root,resolved).split(path.sep).join('/')});
    } else if (stat.isDirectory()) result.push({path:relative,type:'directory'},...dependencyInventory(root,relative));
    else if (stat.isFile()) result.push({path:relative,type:'file',sha256:hash(readFileSync(absolute))});
    else throw new Error('Unsupported dependency input.');
  }
  return sorted(result);
}

function verifyDependencies(destination) {
  const backend = checkedPath(destination,'backend'), packagePath = checkedPath(destination,'backend/package.json');
  const names = Object.keys(JSON.parse(readFileSync(packagePath,'utf8')).dependencies || {}).sort();
  const require = createRequire(packagePath), required = [];
  let dependencyRoot;
  try { dependencyRoot = checkedPath(destination,'backend/node_modules'); }
  catch (error) { if (error.code !== 'ENOENT' || names.length) throw error; }
  if (dependencyRoot && !lstatSync(dependencyRoot).isDirectory()) throw new Error('Invalid owned node_modules.');
  for (const name of names) {
    if (!/^(?:@[a-z\d_.-]+\/)?[a-z\d_.-]+$/i.test(name) || name.split('/').some(part => part === '.' || part === '..'))
      throw new Error('Invalid runtime dependency name.');
    const entry = require.resolve(name);
    if (!path.isAbsolute(entry) || !within(path.join(backend,'node_modules',name),entry)
        || !within(dependencyRoot,realpathSync(entry)) || !lstatSync(entry).isFile())
      throw new Error('Runtime dependency must resolve inside output node_modules.');
    required.push({name,entry:path.relative(destination,entry).split(path.sep).join('/'),sha256:hash(readFileSync(entry))});
  }
  const files = dependencyRoot ? dependencyInventory(dependencyRoot) : [];
  return {method:'local-resolution-and-inventory',required,files,sha256:hash(JSON.stringify({required,files}))};
}

/**
 * New output only; never remove or overwrite existing output. Manifest-last,
 * NOT atomic publication: failures may leave partial, UNACCEPTED output without
 * a manifest. Retry at a new path. Run with exclusive ownership of source/output;
 * path checks do not defend against a hostile process racing filesystem writes.
 */
export function buildHostingerOutput({sourceRoot=projectRoot,outputRoot=path.join(projectRoot,'hostinger-dist'),
  installDependencies=true,install=(directory)=>execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--prefix',directory],{stdio:'inherit'})}={}){
  if(lstatSync(path.resolve(sourceRoot)).isSymbolicLink())throw new Error('Source root cannot be a symlink.');
  const source=realpathSync(sourceRoot),target=path.resolve(outputRoot);
  const parent=realpathSync(path.dirname(target)),destination=path.join(parent,path.basename(target));
  if(within(destination,source) || ['backend','frontend','shared','.git','.codex','.agents'].some(part=>within(path.join(source,part),destination)))
    throw new Error('Unsafe release destination.');
  const sourceTree=inputInventory(source),sourcePackage=fileEntry(source,'package.json');
  const sourceFiles=sourceTree.filter(entry=>entry.type==='file');
  if(!sourceFiles.some(entry=>entry.path==='backend/src/runtime-entrypoint.js'))
    throw new Error('Verified runtime entrypoint is missing.');
  const rootPackage=JSON.parse(readFileSync(checkedPath(source,'package.json'),'utf8'));
  verifyFrontend(source);
  mkdirSync(destination,{recursive:false,mode:0o700});
  for(const relative of inputs)cpSync(path.join(source,relative),path.join(destination,relative),{recursive:true,errorOnExist:true,force:false});
  const rootPackageBytes=JSON.stringify({name:'render-release',private:true,
    version:rootPackage.version,engines:rootPackage.engines,scripts:{start:'node backend/src/runtime-entrypoint.js'}},null,2)+'\n';
  writeFileSync(path.join(destination,'package.json'),rootPackageBytes,{flag:'wx'});
  if(installDependencies)install(path.join(destination,'backend'));
  const expected=sorted([...sourceTree,{path:'package.json',type:'file',sha256:hash(rootPackageBytes)}]);
  if(JSON.stringify(inventory(destination,'',installDependencies))!==JSON.stringify(expected))
    throw new Error('Release content changed during packaging.');
  const dependencyProof=installDependencies?verifyDependencies(destination):null;
  if(JSON.stringify(inputInventory(source))!==JSON.stringify(sourceTree)
      ||JSON.stringify(fileEntry(source,'package.json'))!==JSON.stringify(sourcePackage))
    throw new Error('Release source changed during packaging.');
  const manifest={version:2,preparedAt:new Date().toISOString(),nodeMajor:Number(process.versions.node.split('.')[0]),
    dependenciesInstalled:installDependencies,dependencyProof,files:sourceFiles,
    directories:sourceTree.filter(entry=>entry.type==='directory').map(entry=>entry.path),
    sourceRootPackageSha256:sourcePackage.sha256,rootPackageSha256:hash(rootPackageBytes),
    limits:['Packaging is not deployment approval.','No database or persistent storage is included.',
      'Manifest-last is not atomic publication; failed output without a manifest is unaccepted. Retry at a new path.',
      'Exclusive source/output ownership is required; concurrent hostile filesystem mutation is outside this contract.',
      'Dependency proof checks local resolution and bytes, not package vulnerabilities or runtime behavior.',
      'Migration, ACL, runtime environment, account and provider gates must be verified separately.']};
  writeFileSync(path.join(destination,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  return {directory:destination,files:sourceFiles.length,manifestSha256:hash(readFileSync(path.join(destination,'release-manifest.json'))),dependenciesInstalled:installDependencies};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length && (args.length!==2 || args[0]!=='--output' || !path.isAbsolute(args[1])))throw new Error('Use --output ABSOLUTE_NEW_DIRECTORY or no arguments.');
  const result=buildHostingerOutput(args.length?{outputRoot:args[1]}:{});
  console.log(JSON.stringify({event:'HOSTINGER_PACKAGE_PREPARED',...result}));
}
