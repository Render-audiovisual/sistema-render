import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {groupTasksByResponsible,groupTasksByClient} from '../features/render-os/utils/task-groups.js';
import {getTaskViewState,updateTaskViewUrl,effectiveTaskFilterState} from '../features/render-os/utils/task-view-state.js';
import {initials,formatDate} from '../features/render-os/utils/task-formatters.js';
import {STATUSES,canonicalTaskState} from '../features/render-os/constants.js';

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit)}visit(root);return result}
const declarations=['TasksByClient','TasksByResponsible','TaskGroups'].map(name=>{
 const node=nodes(file,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(file)===name))[0];
 return node.getText(file);
}).join('\n');
const compiled=ts.transpileModule(declarations,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
function components(react=React){return new Function('React','useMemo','groupTasksByResponsible','groupTasksByClient','initials','STATUSES','canonicalTaskState','effectiveTaskFilterState','taskResponsiblesLabel','formatDate',`${compiled};return {TasksByClient,TasksByResponsible,TaskGroups}`)(react,fn=>fn(),groupTasksByResponsible,groupTasksByClient,initials,STATUSES,canonicalTaskState,effectiveTaskFilterState,()=> 'Responsable observado',formatDate)}
const users=[{id:11,nombre:'Alex'},{id:22,nombre:'Alex'},{id:33,nombre:'Sin tareas'}];
const tasks=[{id:1,titulo:'Compartida <script>',estado:'en_revision',asignado_a_id:11,colaborador_ids:[22],cliente_id:5,cliente_nombre:'Marca'}, {id:2,titulo:'Otra',estado:'pendiente',asignado_a_id:22,cliente_id:6,cliente_nombre:'Marca'}, {id:3,titulo:'Histórica',estado:'pendiente',asignado_a:'Alex',cliente_nombre:'Marca'}];

test('responsibles deep URL roundtrip retains task/filter/month and supports popstate parser',()=>{
 const before='https://render.test/workspace/tareas?task=91&client=5&responsible=id%3A11&month=2026-10#detail';
 const state={...getTaskViewState(new URL(before).search),view:'responsibles'};
 const url=updateTaskViewUrl(before,state);
 assert.equal(getTaskViewState(url.search).view,'responsibles');
 assert.equal(url.searchParams.get('task'),'91');assert.equal(url.searchParams.get('responsible'),'id:11');assert.equal(url.hash,'#detail');
 for(const view of ['board','list','calendar','clients'])assert.equal(getTaskViewState(updateTaskViewUrl(url,{...state,view}).search).view,view);
});
test('actual responsible JSX SSR shows shared membership, ID-disambiguated names and loaded-only counts',()=>{
 const {TasksByResponsible}=components(),html=renderToStaticMarkup(React.createElement(TasksByResponsible,{tasks,users,onOpen(){}}));
 assert.match(html,/Alex · #11/);assert.match(html,/Alex · #22/);assert.doesNotMatch(html,/Sin tareas/);
 assert.equal((html.match(/Compartida &lt;script&gt;/g)||[]).length,2);
 assert.match(html,/Sin responsable vinculado/);assert.match(html,/2 tareas cargadas/);
  assert.match(html,/1 tarea cargada/);assert.doesNotMatch(html,/1 tareas cargadas/);
  assert.match(html,/Marca · Responsable observado/);
 assert.match(html,/compartidas aparecen en cada responsable/);assert.match(html,/sólo las tareas cargadas con los filtros actuales/);
});
test('group row client text is escaped and missing client remains explicit',()=>{
 const {TaskGroups}=components();
 const html=renderToStaticMarkup(React.createElement(TaskGroups,{groups:[{key:'user:11',label:'Alex',tasks:[{...tasks[0],cliente_nombre:'<img onerror=alert(1)>'},{...tasks[1],cliente_nombre:null}]}],users,onOpen(){}}));
 assert.match(html,/&lt;img onerror=alert\(1\)&gt; · Responsable observado/);
 assert.doesNotMatch(html,/<img/);assert.match(html,/Sin cliente · Responsable observado/);
});
test('actual client JSX SSR does not merge names or infer legacy name-only client identity',()=>{
 const {TasksByClient}=components(),html=renderToStaticMarkup(React.createElement(TasksByClient,{tasks,users,onOpen(){}}));
 assert.match(html,/Marca · #5/);assert.match(html,/Marca · #6/);assert.match(html,/Sin cliente vinculado/);
 assert.equal((html.match(/ros-project-card/g)||[]).length,3);
});
test('actual grouped task button callbacks open canonical task IDs, including shared duplicates',()=>{
 const opened=[],{TaskGroups}=components({...React,createElement:(type,props,...children)=>({type,props:{...props,children}})});
 const tree=TaskGroups({groups:groupTasksByResponsible(tasks,users),users,onOpen:id=>opened.push(id)});
 function visit(node){if(Array.isArray(node)){node.forEach(visit);return}if(!node||typeof node!=='object')return;if(node.type==='button')node.props.onClick();visit(node.props.children)}visit(tree);
 assert.deepEqual(opened.sort(),[1,1,2,3]);
});
test('actual wiring preserves filtered input, pagination and existing guarded openTask/URL flow',()=>{
 assert.equal(file.parseDiagnostics.length,0);
 assert.match(source,/onClick=\{\(\) => setView\("responsibles"\)\}/);
 assert.match(source,/aria-pressed=\{view === "responsibles"\}/);
 assert.match(source,/<TasksByResponsible tasks=\{visible\} users=\{users\} onOpen=\{openTask\}/);
 assert.match(source,/<TasksByClient tasks=\{visible\} users=\{users\} onOpen=\{openTask\}/);
 assert.match(source,/key=\{group.key\}/);assert.doesNotMatch(declarations,/grouped\.has\(name\)/);
 assert.match(source,/setView\(next.view\)/);assert.match(source,/updateTaskViewUrl\(window.location.href, \{ view,/);
 assert.match(source,/onClick=\{onLoadMore\}/);
});
