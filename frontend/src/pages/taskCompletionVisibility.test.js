import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isWorkingTask} from '../features/render-os/utils/working-task-view.js';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
let update;
function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='updateTask')update=node;ts.forEachChild(node,walk);}walk(file);
test('actual optimistic update keeps completion visible until canonical server response',()=>{
 assert.equal(file.parseDiagnostics.length,0);
 const run=update.initializer.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(file)==='run').declarationList.declarations[0].initializer;
 const optimistic=run.body.statements.find(n=>ts.isIfStatement(n)&&n.expression.getText(file).includes('["finalizada", "publicada"]'));
 assert.ok(optimistic);
 const task={id:1,estado:'en_revision',propiedades_extra:{workspace:'render_os'}};
 for(const estado of ['finalizada','publicada']){
  let rows=[task],writes=0;
  new Function('changes','id','setTasks',optimistic.getText(file))({estado},1,fn=>{writes++;rows=fn(rows);});
  assert.equal(writes,0);assert.equal(isWorkingTask(rows[0]),true);
  const confirmed={...task,estado,propiedades_extra:{workspace:'render_os',finalizada_at:'2026-11-03T15:00:00.000Z'}};
  assert.equal(isWorkingTask(confirmed),true);
 }
 let rows=[task];new Function('changes','id','setTasks',optimistic.getText(file))({estado:'en_progreso'},1,fn=>{rows=fn(rows);});assert.equal(rows[0].estado,'en_progreso');
 assert.doesNotMatch(optimistic.getText(file),/finalizada_at\s*[:=]/);
});
