import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('./WorkspaceReadOnly.jsx',import.meta.url),'utf8');
test('priority selector is removed from the task filter bar, not from task data or editors',()=>{
 const file=ts.createSourceFile('WorkspaceReadOnly.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
 assert.equal(file.parseDiagnostics.length,0);
 const line=source.split('\n').find(line=>line.includes('className={`ros-filter-bar'));
 assert.ok(line);assert.doesNotMatch(line,/Prioridad|setPriority/);
 for(const label of ['Estado','Área','Responsable','Cliente','Sector'])assert.ok(line.includes(`label="${label}"`));
 assert.match(source,/aria-label="Prioridad"/);
});
test('old priority URL preferences cannot leave an invisible server-side filter active',()=>{
 assert.match(source,/const \[priority, setPriority\] = useState\("all"\)/);
 assert.doesNotMatch(source,/setPriority\(next\.priority\)|useState\(initialViewState\.priority\)/);
 assert.match(source,/setSector\(next\.sector\); setPriority\("all"\)/);
});
