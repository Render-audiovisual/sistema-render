import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./ProductionResultHistory.jsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('ProductionResultHistory.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
let load;
function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='load')load=node.initializer;ts.forEachChild(node,walk);}
walk(tree);assert.ok(load);
test('retained pagination cannot capture a replacement session or issue an old visit read',async()=>{
  const events=[],owner={current:2},flight={current:false};
  const deps={owner,flight,setBusy:()=>events.push('busy'),setError:()=>events.push('error'),
    createCapturedRequest:()=>assert.fail('Must reject stale generation before session capture')};
  const callback=Function(...Object.keys(deps),`return (${load.getText(tree)});`)(...Object.values(deps));
  await callback(1,8,{generation:1,revision:9,resultados:[]});
  assert.deepEqual(events,[]);assert.equal(flight.current,false);
});
test('rendered pagination passes the evidence generation, not the latest mutable owner',()=>{
  assert.match(source,/load\(page\.generation, page\.next_before_revision, page\)/);
  assert.doesNotMatch(source,/load\(owner\.current, page\.next_before_revision/);
});
