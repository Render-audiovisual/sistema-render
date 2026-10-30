import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDateLabel} from './calendarDateLabel.js';
test('reused calendar formatters preserve Spanish dates, capitalization and UTC across month and leap-year boundaries',()=>{
 for(const day of ['2026-10-01','2026-10-30','2026-11-01','2028-02-29'])for(const options of [{month:'long',year:'numeric'},{weekday:'long',day:'numeric',month:'long'}]){
  const expected=new Intl.DateTimeFormat('es-AR',{timeZone:'UTC',...options}).format(new Date(`${day}T00:00:00Z`));
  assert.equal(calendarDateLabel(day,options),expected.charAt(0).toLocaleUpperCase('es-AR')+expected.slice(1));
 }
});
