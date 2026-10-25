import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import {build} from 'vite';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const uploader=path.join(root,'src/features/drive/DriveUploader.jsx');
const stylesheet=path.join(root,'src/features/drive/DriveUploader.css');
const workspace=path.join(root,'src/pages/WorkspaceReadOnly.jsx');
const drive=path.join(root,'src/pages/Drive.jsx');
const read=file=>readFileSync(file,'utf8');
const normalize=id=>id.replace(/\\/g,'/').split('?',1)[0];
function selectors(css){const result=new Set();postcss.parse(css).walkRules(rule=>{
  for(const selector of postcss.list.comma(rule.selector))result.add(selector.trim());
});return result;}
const essential=['.drive-uploader','.drive-upload-trigger','.drive-upload-trigger div',
  '.drive-upload-ready','.drive-picker-backdrop','.drive-folder-picker'];

test('the shared uploader directly imports its stylesheet; page CSS no longer owns uploader/picker layout',()=>{
  const tree=ts.createSourceFile(uploader,read(uploader),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(tree.parseDiagnostics.length,0);
  const imports=tree.statements.filter(ts.isImportDeclaration).map(node=>node.moduleSpecifier.text);
  assert.ok(imports.includes('./DriveUploader.css'),'Shared component must own its CSS, not rely on visiting Drive');
  assert.ok(!imports.some(id=>id.endsWith('/pages/Drive.css')));
  const shared=selectors(read(stylesheet)),page=selectors(read(path.join(root,'src/pages/Drive.css')));
  for(const selector of essential){assert.ok(shared.has(selector),`Shared stylesheet retains ${selector}`);
    assert.equal(page.has(selector),false,`Lazy Drive page must not redeclare ${selector}`);}
});

test('actual Vite Workspace static dependency closure loads shared uploader CSS without the lazy Drive page',async()=>{
  let componentImports;
  const result=await build({root,configFile:path.join(root,'vite.config.js'),envFile:false,logLevel:'silent',
    plugins:[{name:'qa-uploader-css-ownership',generateBundle(){
      const info=this.getModuleInfo(uploader);assert.ok(info,'Actual uploader participates in the canonical build');
      componentImports=info.importedIds.map(normalize);
    }}],
    build:{write:false,minify:false,reportCompressedSize:false},
  });
  assert.ok(!Array.isArray(result)&&result.output);
  assert.ok(componentImports.includes(normalize(stylesheet)),'Rollup module graph records uploader-owned CSS import');
  const chunks=result.output.filter(item=>item.type==='chunk');
  const assets=new Map(result.output.filter(item=>item.type==='asset').map(item=>[item.fileName,item]));
  const containing=file=>chunks.filter(chunk=>Object.keys(chunk.modules).some(id=>normalize(id)===normalize(file)));
  const workspaceChunks=containing(workspace),driveChunks=containing(drive);
  assert.equal(workspaceChunks.length,1);assert.equal(driveChunks.length,1);
  assert.notEqual(workspaceChunks[0].fileName,driveChunks[0].fileName,'Exercise genuinely separate lazy page chunks');
  const byName=new Map(chunks.map(chunk=>[chunk.fileName,chunk]));
  const visited=new Set(),loadedCss=new Set();
  function visit(chunk){
    if(visited.has(chunk.fileName))return;visited.add(chunk.fileName);
    for(const name of chunk.viteMetadata?.importedCss??[])loadedCss.add(name);
    // Deliberately follow static imports only. Visiting another route or
    // enumerating all emitted CSS would conceal the original lazy-order bug.
    for(const name of chunk.imports){const dependency=byName.get(name);if(dependency)visit(dependency);}
  }
  visit(workspaceChunks[0]);
  assert.equal(visited.has(driveChunks[0].fileName),false,'Workspace must not need the Drive page chunk');
  const loadedModules=[...visited].flatMap(name=>Object.keys(byName.get(name).modules));
  assert.ok(loadedModules.some(id=>normalize(id)===normalize(uploader)),'Static closure includes actual shared uploader');
  assert.ok(loadedCss.size>0,'Inspect emitted CSS ownership, not source imports alone');
  const cssText=[...loadedCss].map(name=>{
    const asset=assets.get(name);assert.ok(asset,`Referenced CSS asset exists: ${name}`);
    return typeof asset.source==='string'?asset.source:Buffer.from(asset.source).toString('utf8');
  }).join('\n');
  const loadedSelectors=selectors(cssText);
  for(const selector of essential)assert.ok(loadedSelectors.has(selector),`Direct Workspace load receives ${selector}`);
  const rules=[];postcss.parse(cssText).walkRules(rule=>{
    if(postcss.list.comma(rule.selector).some(selector=>selector.trim().replace(/\s*>\s*/g,'>')==='.drive-upload-trigger>div'))rules.push(rule);
  });
  assert.ok(rules.some(rule=>rule.nodes.some(node=>node.type==='decl'&&node.prop==='display'&&node.value==='grid')),
    'Strong/small uploader content receives its real shared grid layout');
});
