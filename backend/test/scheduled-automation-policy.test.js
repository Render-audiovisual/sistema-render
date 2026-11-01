import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveScheduledAutomationPolicy as resolve} from '../src/scheduled-automation-policy.js';
const base = () => ({RENDER_AUTOMATIONS_MODE:'scheduled-v1', RENDER_AUTOMATION_JOBS:'editorial,wilson,supervisor',
  RENDER_AUTOMATION_CONNECTION_MODE:'direct', RENDER_DB_ENVIRONMENT:'test',
  DATABASE_URL:'postgresql://fixture@127.0.0.1:5432/example', MIA_SUPERVISOR_ENABLED:'true'});
test('maintenance pauses without reading credentials', () => {
  assert.equal(resolve({RENDER_MAINTENANCE:'true',get DATABASE_URL(){throw Error('secret');}}).paused,true);
});
test('explicit isolated worker has immutable closed policy', () => {
  const policy=resolve(base());
  assert.deepEqual(policy.jobs,['editorial','wilson','supervisor']);
  assert.ok(Object.isFrozen(policy)&&Object.isFrozen(policy.jobs)&&Object.isFrozen(policy.target));
});
for(const [key,value] of [
  ['RENDER_AUTOMATIONS_MODE',''],['RENDER_AUTOMATION_CONNECTION_MODE','transaction'],
  ['RENDER_AUTOMATION_JOBS','editorial,editorial'],['RENDER_AUTOMATION_JOBS','trash'],
  ['RENDER_AUTOMATION_JOBS','editorial, wilson'],['RENDER_BACKGROUND_JOBS','editorial'],
  ['RENDER_ALLOW_BACKGROUND_WRITES','true'],['TASK_AUTOMATIC_DELETION_ENABLED','true'],
  ['TASK_COMPLETED_CLEANUP_ENABLED','true'],['SETUP_DEMO_DATA','true'],
  ['MIA_SUPERVISOR_REASONING_ENABLED','true'],['MIA_SUPERVISOR_ENABLED','false'],
  ['RENDER_DB_ENVIRONMENT','development'],['DATABASE_URL','postgresql://fixture@unknown.invalid/example'],
  ['RENDER_MAINTENANCE','TRUE'],
]) test(`reject unsafe worker ${key}=${value}`,()=>{
  assert.throws(()=>resolve({...base(),[key]:value}),{code:'AUTOMATION_CONFIGURATION_INVALID'});
});
