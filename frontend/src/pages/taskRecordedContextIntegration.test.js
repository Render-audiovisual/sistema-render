import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('./TaskDetailNotion.css',import.meta.url),'utf8');
test('principal task detail mounts recorded context from its actual authorized task without copying metadata into another store',()=>{
  assert.match(source,/import \{ TaskRecordedContext \} from "\.\.\/components\/TaskRecordedContext.jsx"/);
  assert.equal((source.match(/<TaskRecordedContext task=\{task\}\/>/g)||[]).length,1);
  assert.ok(source.indexOf('<TaskRecordedContext task={task}/>')<source.indexOf('<TaskContentWorkspace task={task}'));
});
test('recorded material remains readable and touchable at narrow widths without introducing a theme layer',()=>{
  assert.match(styles,/\.ros-recorded-context p \{[^}]*overflow-wrap:anywhere;white-space:pre-wrap/);
  assert.match(styles,/\.ros-recorded-context a \{[^}]*min-height:44px/);
  assert.match(styles,/\.ros-recorded-context dt \{ color:var\(--render-muted\)/);
});
