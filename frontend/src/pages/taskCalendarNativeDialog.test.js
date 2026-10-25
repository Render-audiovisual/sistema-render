import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import ts from 'typescript';

const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
assert.equal(tree.parseDiagnostics.length,0);
const owner=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='TaskCalendar');assert.ok(owner);
function nodes(root,predicate){const result=[];function walk(node){if(predicate(node))result.push(node);ts.forEachChild(node,walk);}walk(root);return result;}
const attr=(node,key)=>node.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.getText(tree)===key);
const expression=(node,key)=>attr(node,key)?.initializer?.expression?.getText(tree);
const declaration=name=>nodes(owner,node=>ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)[0]?.initializer;
const opening=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='Modal')[0];assert.ok(opening);
const compiled=ts.transpileModule(owner.getText(tree),{compilerOptions:{jsx:ts.JsxEmit.React,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;

// Actual function/JSX, injected hook scheduling only. No DOM, UA focus/top layer,
// HTTP, providers, database or replacement implementation of its callbacks.
function fixture({dayCount=4,extraDays=false}={}) {
  const states=[],refs=[],events=[];let stateIndex=0,refIndex=0,current;
  const tasks=Array.from({length:dayCount},(_,index)=>({id:index+21,titulo:`QA task ${index}`,cliente_nombre:'QA client',
    fecha_vencimiento:'2026-10-29',estado:'pendiente'}));
  tasks.push({id:900,titulo:'Undated QA',estado:'pendiente',fecha_vencimiento:null});
  if(extraDays)tasks.push({id:901,titulo:'Other day QA',estado:'pendiente',fecha_vencimiento:'2026-10-28'},
    {id:902,titulo:'Other month QA',estado:'pendiente',fecha_vencimiento:'2026-11-29'});
  const before=structuredClone(tasks),users=[{id:7,nombre:'QA'}];
  function Modal(){return null;}
  const deps={React,Modal,
    useState(initial){const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
      return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;events.push(['state',index,states[index]]);}];},
    useRef(initial){const index=refIndex++;return refs[index]||=( {current:initial} );},
    getHoyLocalISO:()=> '2026-10-29',areaForTask:()=> 'produccion',effectiveTaskFilterState:task=>task.estado,
    STATUSES:[{id:'pendiente',label:'Pendiente',color:'#888'}],taskResponsiblesLabel:()=> 'QA · #7'};
  const Calendar=Function(...Object.keys(deps),`${compiled}\nreturn TaskCalendar;`)(...Object.values(deps));
  const render=()=>{stateIndex=0;refIndex=0;current=Calendar({tasks,users,monthValue:'2026-10',
    onOpen:id=>events.push(['open',id]),onMonthChange:month=>events.push(['month',month])});return current;};
  render();
  const find=predicate=>{
    const result=[];
    function walk(value){if(Array.isArray(value)){value.forEach(walk);return;}if(!React.isValidElement(value))return;
      if(predicate(value))result.push(value);walk(value.props.children);}
    walk(current);return result;
  };
  return{tasks,before,refs,states,events,Modal,render,find,
    dialog:()=>find(element=>element.type===Modal)[0],
    day:()=>find(element=>element.type==='button'&&element.props.className==='ros-calendar-day-number'&&element.props['aria-label']==='Ver resumen del 29')[0],
    more:()=>find(element=>element.type==='button'&&element.props.className==='ros-calendar-more')[0]};
}

test('actual calendar summary uses one native chrome-free shared dialog with named overlay and explicit focus/return refs',()=>{
  assert.ok(attr(opening,'native'));assert.equal(attr(opening,'native').initializer,undefined);
  assert.equal(expression(opening,'chrome'),'false');assert.ok(attr(opening,'closeOnBackdropClick'));
  assert.equal(attr(opening,'overlayClassName').initializer.text,'ros-day-preview-backdrop');
  assert.equal(expression(opening,'initialFocusRef'),'dayCloseRef');assert.equal(expression(opening,'returnFocusRef'),'dayInvokerRef');
  assert.equal(declaration('dayCloseRef').getText(tree),'useRef(null)');
  assert.equal(declaration('dayInvokerRef').getText(tree),'useRef(null)');
  assert.match(expression(opening,'overlayAriaLabel'),/Resumen del día.*selectedDateLabel/);
  const section=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='section'
    &&attr(node,'className')?.initializer?.text==='ros-day-preview')[0];assert.ok(section);
  assert.equal(attr(section,'role'),undefined);assert.equal(attr(section,'aria-modal'),undefined);
  assert.equal(nodes(owner,node=>ts.isJsxAttribute(node)&&node.name.getText(tree)==='autoFocus').length,0);
});

test('both rendered day-number and more callbacks capture the exact invoking button before selecting the day',()=>{
  for(const kind of ['day','more']) {
    const f=fixture();assert.equal(f.dialog(),undefined);const target={kind},callback=f[kind]().props.onClick;
    callback({currentTarget:target,target:{notTheInvoker:true}});
    assert.equal(f.refs[1].current,target);assert.deepEqual(f.events,[['state',1,'2026-10-29']]);
    f.render();const dialog=f.dialog();assert.ok(dialog);
    assert.equal(dialog.props.native,true);assert.equal(dialog.props.chrome,false);assert.equal(dialog.props.closeOnBackdropClick,true);
    assert.equal(dialog.props.returnFocusRef,f.refs[1]);assert.equal(dialog.props.returnFocusRef.current,target);
    assert.equal(dialog.props.initialFocusRef,f.refs[0]);assert.match(dialog.props.overlayAriaLabel,/^Resumen del día: .*29/);
    assert.deepEqual(f.tasks,f.before);
  }
});

test('shared cancel/backdrop close callback and custom close clear only day selection, never open or mutate a task',()=>{
  for(const kind of ['overlay','button']) {
    const f=fixture(),target={kind:'original-invoker'};f.day().props.onClick({currentTarget:target});f.render();
    const dialog=f.dialog();
    const close=f.find(element=>element.type==='button'&&element.props['aria-label']==='Cerrar resumen');assert.equal(close.length,1);
    assert.equal(close[0].props.ref,f.refs[0]);assert.equal(close[0].props.className,'modal-close');assert.equal(close[0].props.type,'button');
    f.events.length=0;
    if(kind==='overlay')dialog.props.onClose();else close[0].props.onClick();
    assert.deepEqual(f.events,[['state',1,'']]);f.render();assert.equal(f.dialog(),undefined);
    assert.equal(f.refs[1].current,target);assert.deepEqual(f.tasks,f.before);
  }
});

test('opening an actual summary task clears selection first and forwards its unchanged ID exactly once',()=>{
  const f=fixture();f.more().props.onClick({currentTarget:{kind:'more'}});f.render();
  const rows=f.find(element=>element.type==='button'&&element.key==='22');assert.ok(rows.length);
  // Both calendar and summary contain the same ID. Execute the summary row,
  // whose callback delegates through openFromSummary rather than direct onOpen.
  const callback=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='button'
    &&expression(node,'onClick')?.includes('openFromSummary(task.id)'))[0];assert.ok(callback);
  const summaryRow=rows.at(-1);f.events.length=0;summaryRow.props.onClick();
  assert.deepEqual(f.events,[['state',1,''],['open',22]]);f.render();assert.equal(f.dialog(),undefined);
  assert.deepEqual(f.tasks,f.before);
});

test('month movement retains canonical selection clearing and YYYY-MM callback, with no task operation',()=>{
  for(const [label,month] of [['Mes anterior','2026-09'],['Mes siguiente','2026-11']]) {
    const f=fixture();f.day().props.onClick({currentTarget:{}});f.render();f.events.length=0;
    const button=f.find(element=>element.type==='button'&&element.props['aria-label']===label)[0];button.props.onClick();
    assert.deepEqual(f.events.map(row=>row[0]),['state','state','month']);
    assert.deepEqual(f.events[0],['state',1,'']);assert.deepEqual(f.events[2],['month',month]);
    f.render();assert.equal(f.dialog(),undefined);assert.deepEqual(f.tasks,f.before);
  }
});

test('TaskCalendar has no competing global Escape listener, manual dialog lifecycle or business transport',()=>{
  const code=owner.getText(tree);
  assert.doesNotMatch(code,/addEventListener|removeEventListener|keydown|Escape|showModal\(|\.close\(|\.focus\(|localStorage|sessionStorage|apiRequest\(|fetch\(/);
  assert.equal(nodes(owner,node=>ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect').length,0);
  assert.equal(nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='Modal').length,1);
  const invokers=nodes(owner,node=>ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='button'
    &&['ros-calendar-day-number','ros-calendar-more'].includes(attr(node,'className')?.initializer?.text));
  assert.equal(invokers.length,2);
  for(const invoker of invokers)assert.equal(expression(invoker,'onClick'),'(event) => openDay(event, key)');
});

test('actual day button keeps its numeric day and reports the full loaded count, not the three desktop cards',()=>{
  for(const count of [0,1,4,12]){
    const f=fixture({dayCount:count,extraDays:true}),button=f.day();
    assert.equal(button.props['aria-label'],'Ver resumen del 29');
    assert.equal(button.props['aria-description'],`${count} ${count===1?'tarea cargada':'tareas cargadas'}`);
    assert.equal(React.Children.toArray(button.props.children)[0],29);
    const badges=f.find(element=>element.type==='span'&&element.props.className==='ros-calendar-day-count');
    const badge=React.Children.toArray(button.props.children).find(element=>React.isValidElement(element));
    if(count===0)assert.equal(badge,undefined);
    else{assert.equal(badge.props.className,'ros-calendar-day-count');assert.equal(badge.props.children,count);assert.equal(badge.props['aria-hidden'],'true');}
    assert.equal(badges.length,(count>0?1:0)+1,'Only the current month dated days receive a badge');
    assert.deepEqual(f.tasks,f.before);
  }
});

test('actual day summary includes every task beyond three, excludes undated/other days and opens the last exact ID',()=>{
  for(const count of [0,1,4,12]){
    const f=fixture({dayCount:count,extraDays:true});f.day().props.onClick({currentTarget:{kind:'day'}});f.render();
    const list=f.find(element=>element.props.className==='ros-day-preview-list')[0];
    const rows=[list.props.children].flat(Infinity).filter(element=>React.isValidElement(element)&&element.type==='button');
    assert.deepEqual(rows.map(element=>element.key),Array.from({length:count},(_,index)=>String(index+21)));
    if(count){f.events.length=0;rows.at(-1).props.onClick();assert.deepEqual(f.events,[['state',1,''],['open',count+20]]);}
    else assert.equal(f.find(element=>element.props.className==='ros-day-preview-empty').length,1);
    assert.deepEqual(f.tasks,f.before);
  }
});

test('desktop direct task cards still open unchanged IDs without selecting the day or using the summary',()=>{
  const f=fixture({dayCount:12});
  const cards=f.find(element=>element.type==='button'&&element.props.className?.startsWith('ros-calendar-task '));
  assert.equal(cards.length,3);assert.equal(f.dialog(),undefined);
  f.events.length=0;cards[2].props.onClick();assert.deepEqual(f.events,[['open',23]]);
  f.render();assert.equal(f.dialog(),undefined);assert.deepEqual(f.tasks,f.before);
});
