import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import postcss from 'postcss';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
function todayAction(name,context){
 const tree=ts.createSourceFile(name,read(name),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);let button;
 function visit(node){if(ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='button'&&node.attributes.properties.some(p=>p.name?.getText(tree)==='className'&&p.initializer?.text==='calendar-today'))button=node;ts.forEachChild(node,visit);}visit(tree);assert.ok(button);
 const callback=button.attributes.properties.find(p=>p.name?.getText(tree)==='onClick').initializer.expression.getText(tree);
 return Function(...Object.keys(context),`return (${callback});`)(...Object.values(context));
}
test('publication Today changes only selected date/month, leaving client and content filters to the canonical merger',()=>{
 let changed;todayAction('./Calendar.jsx',{today:'2026-10-30',change:value=>{changed=value;}})();assert.deepEqual(changed,{mes:'2026-10',dia:'2026-10-30'});
});
test('production Today retains client and view and goes through existing unsaved-change context gate',()=>{
 let args;todayAction('./Productions.jsx',{today:'2026-10-30',clientId:'7',tab:'calendar',changeContext:(...value)=>{args=value;}})();assert.deepEqual(args,['7','calendar','2026-10','2026-10-30']);
 assert.match(read('./Productions.jsx'),/const changeContext = [^\n]+=> mayLeave\(\(\)=>\{/);
});
test('task Today updates the month context and closes the old day summary without changing any tasks',()=>{
 let date,selected,month;todayAction('./WorkspaceReadOnly.jsx',{today:'2026-10-30',setCursor:value=>{date=value;},setSelectedDate:value=>{selected=value;},onMonthChange:value=>{month=value;}})();
 assert.equal(date.getFullYear(),2026);assert.equal(date.getMonth(),9);assert.equal(date.getDate(),1);assert.equal(selected,'');assert.equal(month,'2026-10');
});
test('shared stylesheet keeps mobile calendar visible, seven bounded columns, large task day targets and reduced-motion support',()=>{
 const text=read('./OperationalCalendars.css'),css=postcss.parse(text);
 assert.match(text,/\.productions-page \.prod-month-grid\{display:block\}/);
 assert.match(text,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
 assert.match(text,/\.ros-calendar-day-number\{width:100%;height:44px;min-height:44px/);
 assert.match(text,/prefers-reduced-motion:no-preference/);
 assert.doesNotMatch(text,/!important|transition:all/);
 css.walkRules(rule=>{for(const selector of postcss.list.comma(rule.selector))assert.match(selector.trim(),/^(\.principal-calendar|\.productions-page|\.render-workspace)/);});
});
