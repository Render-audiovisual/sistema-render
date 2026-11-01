// Explicit one-shot cron entrypoint. No web startup, migrations or dotenv.
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Uso: node backend/scripts/run-scheduled-automations.js run');
    return;
  }
  if (args.length !== 1 || args[0] !== 'run') throw new Error('Argumentos inválidos');
  const env = Object.freeze({...process.env});
  const {runScheduledAutomations} = await import('../src/scheduled-automation-runner.js');
  const outcome = await runScheduledAutomations({env,
    createPool: async () => {
      const [{AuthorityBoundPool}, {buildDatabasePoolConfig}] = await Promise.all([
        import('../src/database-authority-context.js'), import('../src/database-transport.js'),
      ]);
      const config = buildDatabasePoolConfig(env);
      if (!config) throw new Error('Destino requerido');
      return new AuthorityBoundPool({...config, max:4, query_timeout:120000,
        statement_timeout:110000, lock_timeout:10000, idleTimeoutMillis:1000});
    },
    handlers: {
      editorial: async (pool, context) => {
        const {runScheduledEditorial} = await import('../src/scheduled-editorial.js');
        await runScheduledEditorial(pool, context);
      },
      wilson: async (pool, context) => {
        const {runWilsonScheduledDigest} = await import('../src/wilson-chat.js');
        await runWilsonScheduledDigest(pool, context);
      },
      supervisor: async (pool, {now}) => {
        const {runMiaSupervisor} = await import('../src/mia-supervisor.js');
        const result = await runMiaSupervisor(pool, {now, dryRun:false, env:{
          APP_URL:env.APP_URL, MIA_SUPERVISOR_ENABLED:env.MIA_SUPERVISOR_ENABLED,
          MIA_SUPERVISOR_REASONING_ENABLED:'false',
        }});
        if (result?.busy) throw new Error('Supervisor ocupado');
      },
      instagram: async (pool, {now}) => {
        const {runInstagramSync} = await import('../src/instagram-sync.js');
        await runInstagramSync(pool, {now, env:{
          META_SYSTEM_USER_TOKEN:env.META_SYSTEM_USER_TOKEN, META_GRAPH_VERSION:env.META_GRAPH_VERSION,
          META_BUSINESS_ID:env.META_BUSINESS_ID,
        }});
      },
      instagram_reporte: async (pool, {now}) => {
        const {runInstagramWeeklyReport} = await import('../src/instagram-weekly-report.js');
        await runInstagramWeeklyReport(pool, {now, env:{
          INSTAGRAM_AI_REPORTS_ENABLED:env.INSTAGRAM_AI_REPORTS_ENABLED,
          ANTHROPIC_API_KEY:env.ANTHROPIC_API_KEY, INSTAGRAM_AI_MODEL:env.INSTAGRAM_AI_MODEL,
        }});
      },
    },
  });
  console.log(JSON.stringify(outcome));
}
void main().catch(() => {
  console.error('No se pudo completar la automatización programada.');
  process.exitCode = 1;
});
