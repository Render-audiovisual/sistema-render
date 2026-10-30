import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('day agenda only renders in an accessible dismissible dialog, never a sidebar',()=>{
  const source=readFileSync(new URL('./Calendar.jsx',import.meta.url),'utf8');
  assert.match(source,/dayOpen&&<Modal native closeOnBackdropClick/);
  assert.match(source,/aria-haspopup="dialog"/);
  assert.match(source,/dayTrigger.current=event.currentTarget;setDayOpen\(true\)/);
  assert.match(source,/onClose=\{\(\)=>setDayOpen\(false\)\} returnFocusRef=\{dayTrigger\}/);
  assert.equal((source.match(/aria-label="Agenda del día"/g)||[]).length,1);
  const css=readFileSync(new URL('./Calendar.css',import.meta.url),'utf8');
  assert.match(css,/calendar-day-overlay::backdrop\{[^}]*backdrop-filter:blur\(7px\)/);
  assert.match(css,/principal-calendar-layout.principal-calendar-full\{grid-template-columns:minmax\(0,1fr\)/);
});
