import test from 'node:test';
import assert from 'node:assert/strict';
import { supervisionSummary, HOME_SUPERVISION_SQL, SUPERVISION_TEAMS } from '../src/home-supervision.js';
import { readPersonalHome, PERSONAL_HOME_SQL } from '../src/personal-home.js';

test('supervision is selected by verified profile and current server role, never user display name', async () => {
  for (const [role,profile,expected] of [['admin','agustin',[11,8]],['admin','franco',[10,9]],['diseno','agustin',null],['admin',undefined,null]]) {
    let queried = null;
    const db = { release(){}, async query(sql,params) {
      if (sql.startsWith('SELECT id,nombre,rol')) return {rows:[{id:17,nombre:'Franco',rol:role,activo:true,session_version:1}]};
      if (sql===PERSONAL_HOME_SQL) return {rows:[{home:{today:'2026-11-04'}}]};
      if (sql===HOME_SUPERVISION_SQL) {queried=params[0];return {rows:[]};}
      if (sql.startsWith('SELECT id,nombre FROM usuarios')) return {rows:[]};
      return {rows:[]};
    }};
    const home=await readPersonalHome({connect:async()=>db},{id:17,session_version:1,owner_profile:profile});
    assert.deepEqual(queried,expected);assert.equal(Boolean(home.supervision),Boolean(expected));
  }
});

test('supervision teams use stable IDs and shared tasks count once per client', () => {
  assert.deepEqual(SUPERVISION_TEAMS, { agustin:[11,8], franco:[10,9] });
  const row = { id:1,titulo:'Shared',estado:'finalizada',deadline:'2026-11-07',cliente_id:2,cliente:'Synthetic',members:[8,11] };
  const data = supervisionSummary([row,row], [{id:8,nombre:'Synthetic A'},{id:11,nombre:'Synthetic B'}], '2026-11-04');
  assert.equal(data.clients[0].total,1); assert.equal(data.clients[0].done,1);
  assert.equal(data.people[0].done,1); assert.equal(data.people[1].done,1);
  assert.equal(data.priorities.length,0);
});
test('feed group links preserve separate client task progress without duplicating the feed identity', () => {
  const base={estado:'pendiente',deadline:'2026-11-07',members:[8],grupo_feed_id:1};
  const data=supervisionSummary([{...base,id:1,cliente_id:5,cliente:'Hortícola'},{...base,id:2,cliente_id:6,cliente:'Market'}],[],'2026-11-04');
  assert.equal(data.clients.length,2);
  assert.deepEqual(data.clients.map(c=>c.statsKey),['grupo-1','grupo-1']);
  assert.ok(data.clients.every(c=>c.total===1));
});
test('priority is overdue, today, review, then future or undated; monthly progress excludes future months', () => {
  const base = {cliente_id:2,cliente:'Synthetic',members:[8],estado:'pendiente'};
  const rows = [{...base,id:1,titulo:'Future',deadline:'2026-12-01'},
    {...base,id:2,titulo:'Review',deadline:null,estado:'en_revision'},
    {...base,id:3,titulo:'Today',deadline:'2026-11-04'},
    {...base,id:4,titulo:'Overdue',deadline:'2026-11-02'}];
  const data = supervisionSummary(rows,[{id:8,nombre:'Synthetic'}],'2026-11-04');
  assert.deepEqual(data.priorities.map(row=>row.id),[4,3,2,1]);
  assert.equal(data.clients[0].total,2);
  assert.match(HOME_SUPERVISION_SQL,/EXISTS\(SELECT 1 FROM tarea_asignaciones/);
  assert.doesNotMatch(HOME_SUPERVISION_SQL,/\b(?:UPDATE|DELETE|INSERT)\b/);
});
