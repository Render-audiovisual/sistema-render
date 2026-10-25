import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./Publicaciones.jsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('Publicaciones.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const attr=(n,name)=>n.attributes.properties.find(p=>p.name?.text===name);
function nodes(root,predicate){const found=[];function walk(n){if(predicate(n))found.push(n);ts.forEachChild(n,walk);}walk(root);return found;}
test('monthly grid lives inside a named keyboard-scrollable region, hidden for week view',()=>{
  const [region]=nodes(ast,n=>ts.isJsxElement(n)&&attr(n.openingElement,'className')?.initializer?.text==='publication-month-scroll');
  assert.ok(region);
  const opening=region.openingElement;
  assert.equal(attr(opening,'role')?.initializer?.text,'region');
  assert.equal(attr(opening,'aria-label')?.initializer?.text,'Calendario mensual de publicaciones');
  assert.equal(attr(opening,'tabIndex')?.initializer?.expression?.getText(ast),'0');
  assert.equal(attr(opening,'hidden')?.initializer?.expression?.getText(ast),'vista === "semana"');
  assert.equal(nodes(region,n=>ts.isJsxOpeningElement(n)&&attr(n,'className')?.initializer?.expression?.getText(ast)?.includes('cal-grid')).length,1);
  assert.equal(attr(opening,'aria-describedby')?.initializer?.text,'publication-calendar-scroll-hint');
  assert.match(source,/id="publication-calendar-scroll-hint"/);
});
test('calendar region bounds horizontal overflow instead of hiding the full month',()=>{
  const css=readFileSync(new URL('./publicationCalendar.css',import.meta.url),'utf8');
  assert.match(css,/\.publicaciones-viewport \.publication-month-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css,/\.publicaciones-viewport \.publication-month-scroll\s*\{[^}]*min-width:\s*0/s);
  assert.match(css,/\.publicaciones-viewport \.publication-month-scroll\s*\{[^}]*max-width:\s*100%/s);
  assert.match(css,/\.publication-month-scroll\[hidden\]/);
  assert.doesNotMatch(css,/\.cal-grid[^}]*display:\s*none/s,'Month data is not removed to make the page fit');
});
