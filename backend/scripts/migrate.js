import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDatabaseTarget, isLoopbackAddress, assertMigrationTargetIdentity } from '../src/startup-policy.js';

export const MIGRATION_HELP = `Migraciones explícitas (no se ejecutan al iniciar la aplicación).
Uso:
  node scripts/migrate.js [help|--help]
  node scripts/migrate.js status
  node scripts/migrate.js apply --plan HASH --database NAME --user NAME

Requiere DATABASE_URL y RENDER_DB_ENVIRONMENT explícitos para status/apply.
status solo inspecciona. apply solo admite destinos locales no productivos y
requiere el plan actual y la identidad exacta; nunca instala dependencias.`;

const invalid = message => Object.assign(new Error(message), { cliInput: true });
const safeName = value => typeof value === 'string' && value.length > 0 && value.length <= 63
  && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

export function parseMigrationCommand(argv) {
  if(!Array.isArray(argv) || argv.some(arg=>typeof arg!=='string'))throw invalid('Argumentos inválidos. Usá help.');
  if(!argv.length || (argv.length===1 && ['help','--help','-h'].includes(argv[0])))return{command:'help'};
  const [command,...args]=argv;
  if(command==='status' && !args.length)return{command};
  if(command!=='apply')throw invalid('Comando o argumentos no permitidos. Usá help.');
  const flags={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i],value=args[i+1];
    if(!['--plan','--database','--user'].includes(key)||Object.hasOwn(flags,key)||typeof value!=='string'||!value||value.startsWith('--'))throw invalid('apply exige --plan, --database y --user, sin duplicados ni opciones adicionales.');
    flags[key]=value;
  }
  if(!/^[0-9a-f]{64}$/.test(flags['--plan']||'') || !safeName(flags['--database']) || !safeName(flags['--user']))throw invalid('apply exige --plan SHA256, --database y --user válidos.');
  return{command,planHash:flags['--plan'],database:flags['--database'],username:flags['--user']};
}

export function validateMigrationCliEnvironment(env, request) {
  let target;
  // Shared policy rejects URL query overrides for status AND apply, without
  // printing raw configuration or consulting PG* connection defaults.
  try {target=readDatabaseTarget(env);}catch{throw invalid('DATABASE_URL PostgreSQL y RENDER_DB_ENVIRONMENT explícitos y sin opciones de URL son obligatorios.');}
  const {environment,database,username}=target;
  if(!safeName(database)||!safeName(username))throw invalid('La identidad configurada no es válida.');
  if(request.command==='apply') {
    if(environment==='production'||!isLoopbackAddress(target.hostname))throw invalid('apply solo admite un destino loopback declarado no productivo.');
    if(database!==request.database||username!==request.username)throw invalid('--database y --user deben coincidir con el destino configurado.');
  }
  return target;
}

/** Injectable entrypoint: help/config failures never import a DB module. */
export async function runMigrationCli({argv=process.argv.slice(2),env=process.env,
  loadPool=()=>import('../src/db.js'),loadEngine=()=>import('../src/migrations.js'),
  write=message=>console.log(message),writeError=message=>console.error(message)}={}) {
  let pool,engine;
  try {
    const request=parseMigrationCommand(argv);
    if(request.command==='help'){write(MIGRATION_HELP);return 0;}
    const config=validateMigrationCliEnvironment(env,request);
    engine=await loadEngine();
    ({pool}=await loadPool());
    let identity,status,plan;
    const client=await pool.connect();
    try {
      identity=await engine.readMigrationIdentity(client);
      if(isLoopbackAddress(config.hostname))assertMigrationTargetIdentity(identity,config);
      else if(identity.database!==config.database || identity.username!==config.username || Number(identity.port)!==config.port) {
        throw invalid('La identidad actual no coincide con el destino configurado.');
      }
      status=await engine.readMigrationStatus(client);
      plan=engine.buildMigrationPlan({environment:config.environment,identity,status});
    }finally{client.release();}
    if(request.command==='status') {
      write(JSON.stringify({environment:config.environment,identity,status,planHash:plan},null,2));
      return 0;
    }
    if(identity.database!==request.database || identity.username!==request.username || plan!==request.planHash)throw invalid('El plan o la identidad actual cambió. Ejecutá status y revisá la aprobación.');
    // Runner revalidates the approved identity/plan AFTER its chain-wide lock.
    await engine.runMigrations(pool,{log:message=>write(message)},{approval:{environment:config.environment,
      expectedIdentity:identity,planHash:request.planHash,purpose:'local-explicit'}});
    return 0;
  }catch(error){
    const controlled=error?.cliInput===true || (typeof engine?.MigrationPolicyError==='function' && error instanceof engine.MigrationPolicyError);
    writeError(controlled?error.message:'No se pudo completar la operación de migraciones. Revisá la configuración y el estado; no se muestran detalles de conexión.');
    return 1;
  }
  finally{if(pool)try{await pool.end();}catch{/* Never disclose connection diagnostics. */}}
}

if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  process.exitCode=await runMigrationCli();
}
