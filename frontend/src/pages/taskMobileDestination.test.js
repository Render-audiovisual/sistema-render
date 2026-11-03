import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {BOARD_COLUMNS,STATUSES,canonicalTaskState} from '../features/render-os/constants.js';
const file=ts.createSourceFile('WorkspaceReadOnly.jsx',readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
let move;
function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='move')move=node.initializer.arguments[0];ts.forEachChild(node,walk);}walk(file);
function fixture({compactBoard=true,allowed=true,pending=false}={}){
 const columns=[],writes=[];
 const deps={compactBoard,BOARD_COLUMNS,STATUSES,canonicalTaskState,orderState:{},isTaskUpdatePending:()=>pending,
  sesion:{usuario:{id:1}},canUserMoveTaskToState:()=>allowed,isProductionVisitTask:()=>false,
  onError:()=>{},onUpdate:(...args)=>{writes.push(args);return Promise.resolve();},onApprove:()=>Promise.resolve(),openTask:()=>{},setMobileBoardColumn:id=>columns.push(id)};
 return {columns,writes,move:Function(...Object.keys(deps),`return (${move.getText(file)});`)(...Object.values(deps))};
}
test('actual mobile move opens destination for all four states including Finalizadas alias',()=>{
 for(const [estado,column] of [['pendiente','pendiente'],['en_progreso','en_progreso'],['en_revision','en_revision'],['finalizada','finalizadas']]){
  const f=fixture(); assert.equal(f.move({id:1,estado:estado==='pendiente'?'en_progreso':'pendiente'},estado),'move');
  assert.deepEqual(f.columns,[column]);assert.equal(f.writes.length,1);
 }
});
test('desktop and rejected, pending or unchanged moves do not change mobile navigation',()=>{
 for(const options of [{compactBoard:false},{allowed:false},{pending:true}]){
  const f=fixture(options);f.move({id:1,estado:'pendiente'},'en_progreso');assert.deepEqual(f.columns,[]);
 }
 const f=fixture();f.move({id:1,estado:'pendiente'},'pendiente');assert.deepEqual(f.columns,[]);assert.deepEqual(f.writes,[]);
});
