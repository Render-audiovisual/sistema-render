// Dedicated cron entrypoint: no editorial work, task writes, WhatsApp or AI.
async function main(){
  const args=process.argv.slice(2);
  if(args.length===1&&['--help','-h'].includes(args[0])){
    console.log('Uso: node backend/scripts/run-instagram-automation.js run');return;
  }
  if(args.length!==1||args[0]!=='run')throw new Error('Argumentos inválidos');
  const {runInstagramScheduled}=await import('../src/instagram-scheduled-worker.js');
  const outcome=await runInstagramScheduled();
  console.log(JSON.stringify({worker:'instagram',at:new Date().toISOString(),...outcome}));
}
void main().catch(()=>{
  console.error('No se pudo actualizar Instagram automáticamente.');process.exitCode=1;
});
