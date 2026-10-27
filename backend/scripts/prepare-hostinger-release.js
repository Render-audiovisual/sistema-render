import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareReleasePreparationPlan,assertReleasePreparationPlanCurrent} from '../src/release-preparation-plan.js';
import {validateHostingerReleaseConfig} from '../src/hostinger-release-config.js';

export const RELEASE_PREPARATION_HELP=`Preparación offline, sin conexión a Hostinger ni PostgreSQL.
  prepare --input ABSOLUTE_METADATA_JSON --output ABSOLUTE_NEW_JSON
  check --input ABSOLUTE_CURRENT_METADATA_JSON --plan ABSOLUTE_PLAN_JSON --output ABSOLUTE_NEW_JSON
  config --input ABSOLUTE_PRIVATE_CONFIG_JSON --output ABSOLUTE_NEW_REPORT_JSON
No existe apply/deploy. Un plan coincidente NO autoriza publicación.
config recibe {env,nodeVersion,currentDatabaseUrl,currentJwtSecret,frontendGoogleClientId?}; nunca imprime valores.
Usar archivos privados y conservar la configuración actual; no pegar secretos en argumentos.`;
const invalid=()=>new Error('Preparación no válida. Revisá los archivos y argumentos; no se aplicaron cambios.');
export function parseReleasePreparationArgs(argv){
  if(!Array.isArray(argv)||argv.some(x=>typeof x!=='string'))throw invalid();
  if(!argv.length||argv.length===1&&['help','--help','-h'].includes(argv[0]))return{command:'help'};
  const [command,...args]=argv;
  if(!['prepare','check','config'].includes(command))throw invalid();
  const allowed=command==='check'?['--input','--plan','--output']:['--input','--output'],flags={};
  for(let i=0;i<args.length;i+=2){
    const [key,value]=args.slice(i,i+2);
    if(!allowed.includes(key)||Object.hasOwn(flags,key)||typeof value!=='string'||!path.isAbsolute(value)||/[\u0000-\u001f\u007f]/.test(value))throw invalid();
    flags[key]=value;
  }
  if(allowed.some(key=>!flags[key]))throw invalid();
  return{command,input:flags['--input'],output:flags['--output'],...(command==='check'?{plan:flags['--plan']}:{})};
}
async function readPrivateJson(file){
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>4*1024*1024||(stat.mode&0o077)!==0)throw invalid();
    return JSON.parse(await handle.readFile('utf8'));
  }finally{await handle.close();}
}
async function writeNewJson(file,value){
  const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');}finally{await handle.close();}
}
export async function runReleasePreparationCli({argv=process.argv.slice(2),write=console.log,writeError=console.error}={}){
  try{
    const args=parseReleasePreparationArgs(argv);
    if(args.command==='help'){write(RELEASE_PREPARATION_HELP);return 0;}
    const input=await readPrivateJson(args.input);let result;
    if(args.command==='config'){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['env','nodeVersion','currentDatabaseUrl','currentJwtSecret','frontendGoogleClientId'].includes(k))
        ||!input.env||typeof input.env!=='object'||Array.isArray(input.env))throw invalid();
      result=validateHostingerReleaseConfig(input.env,{nodeVersion:input.nodeVersion,currentDatabaseUrl:input.currentDatabaseUrl,currentJwtSecret:input.currentJwtSecret,frontendGoogleClientId:input.frontendGoogleClientId});
    }else if(args.command==='prepare')result=prepareReleasePreparationPlan(input);
    else{
      const stored=await readPrivateJson(args.plan);
      const normalized=prepareReleasePreparationPlan(stored.metadata);
      if(JSON.stringify(stored)!==JSON.stringify(normalized))throw invalid();
      result=assertReleasePreparationPlanCurrent({expectedPlanHash:normalized.planHash,input});
    }
    await writeNewJson(args.output,result);
    write(JSON.stringify(args.command==='config'?{event:'HOSTINGER_CONFIGURATION_REVIEWED',configurationValid:result.configurationValid,releaseApproved:false}
      :{event:'RELEASE_PREPARATION_RECORDED',state:result.state,planHash:result.planHash,executable:false,authorized:false}));
    return args.command==='config'&&!result.configurationValid?2:0;
  }catch{writeError('No se pudo completar la preparación offline. No se muestran secretos ni se aplican cambios de servidor.');return 1;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runReleasePreparationCli();
