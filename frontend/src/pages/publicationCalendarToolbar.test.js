import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';

// Actual JSX/handler execution and scoped static CSS contracts, not mounted
// React, browser geometry, native select policy or touch certification.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function parse(source) { const file=ts.createSourceFile('contract.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);assert.equal(file.parseDiagnostics.length,0);return file; }
function find(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
const tree=parse(read('./Publicaciones.jsx'));
const page=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PublicacionesCalendarioTab');assert.ok(page);
const attr=(element,name)=>element.openingElement.attributes.properties.find(node=>ts.isJsxAttribute(node)&&node.name.text===name);
const matches=find(page,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='FilterSelect');
assert.equal(matches.length,1);const field=matches[0];
function signature(node){
  if(ts.isJsxText(node)){const text=node.text.replace(/\s+/g,' ').trim();return text?['jsx-text',text]:null;}
  const children=node.getChildren();return children.length?[node.kind,...children.map(signature).filter(value=>value!==null)]:[node.kind,typeof node.text==='string'?node.text:node.getText()];
}
function evaluate(source,bindings={}){const js=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return Function('React',...Object.keys(bindings),`${js};return result;`)(React,...Object.values(bindings));}
const sharedTree=parse(read('../components/FilterSelect.jsx'));
const sharedFn=sharedTree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FilterSelect');assert.ok(sharedFn);
const FilterSelect=evaluate(`const result=(${sharedFn.getText().replace(/^export\s+/,'')});`);

test('calendar type field preserves its controlled value, parent context callback and mapped options',()=>{
  // Explicit native-select baseline; no git dependency after committing.
  const baseline=find(parse(`<select value={filtroTipo} onChange={(event) => onCalendarContextChange?.({ type: event.target.value })}>{FILTROS.map((f) => (<option key={f.key} value={f.key}>{f.label}</option>))}</select>`),ts.isJsxElement)[0];
  const native=field.openingElement.attributes.properties.filter(node=>!ts.isJsxAttribute(node)||!['label','className','aria-label'].includes(node.name.text));
  assert.deepEqual(native.map(signature),baseline.openingElement.attributes.properties.map(signature));
  assert.deepEqual(field.children.map(signature).filter(Boolean),baseline.children.map(signature).filter(Boolean));
  assert.equal(attr(field,'label')?.initializer?.text,'Tipo');
  assert.equal(attr(field,'className')?.initializer?.text,'editorial-type-filter');
  assert.equal(attr(field,'aria-label')?.initializer?.text,'Tipo de publicación');
  for(let parent=field.parent;parent;parent=parent.parent)assert.ok(!ts.isJsxElement(parent)||parent.openingElement.tagName.getText()!=='label','Shared component is not nested in another label');
  const imports=tree.statements.filter(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='../components/FilterSelect.jsx');
  assert.equal(imports.length,1);assert.ok(imports[0].importClause.namedBindings.elements.some(node=>node.name.text==='FilterSelect'&&!node.propertyName));
});

test('actual FILTROS and real component SSR expose a named native select; original handler forwards the selected type',()=>{
  const declarations=find(page,node=>ts.isVariableDeclaration(node)&&node.name.getText()==='FILTROS');assert.equal(declarations.length,1);
  const memo=declarations[0].initializer;assert.equal(memo.expression.getText(),'useMemo');
  const FILTROS=evaluate(`const result=(${memo.arguments[0].getText()})();`);
  assert.deepEqual(FILTROS,[{key:'todos',label:'Todo'},{key:'video',label:'Reels'},{key:'carrusel',label:'Carruseles'}]);
  const changes=[];
  const element=evaluate(`const result=(${field.getText()});`,{FilterSelect,FILTROS,filtroTipo:'video',onCalendarContextChange:value=>changes.push(value)});
  element.props.onChange({target:{value:'carrusel'}});assert.deepEqual(changes,[{type:'carrusel'}]);
  const label=FilterSelect(element.props);assert.equal(label.type,'label');
  const select=React.Children.toArray(label.props.children).find(node=>node.type==='select');assert.ok(select);
  assert.equal(select.props.value,'video');assert.equal(select.props.onChange,element.props.onChange);
  assert.equal(select.props['aria-label'],'Tipo de publicación');
  const html=renderToStaticMarkup(element);
  assert.match(html,/<label class="render-filter-field editorial-type-filter"><span>Tipo<\/span><select/);
  assert.match(html,/<option value="video" selected="">Reels<\/option>/);
  assert.deepEqual([...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(match=>[match[1],match[2]]),[['todos','Todo'],['video','Reels'],['carrusel','Carruseles']]);
  assert.doesNotMatch(html,/role="(?:combobox|listbox)"|<button/);
});

test('the actual toolbar keeps month/week, Today and guarded refresh actions rather than hiding them to fit',()=>{
  const toolbar=find(page,node=>ts.isJsxElement(node)&&attr(node,'className')?.initializer?.text==='cal-filters');assert.equal(toolbar.length,1);
  const buttons=find(toolbar[0],node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='button');assert.equal(buttons.length,4);
  assert.ok(buttons.every(node=>attr(node,'type')?.initializer?.text==='button'));
  const refresh=buttons.find(node=>attr(node,'onClick')?.initializer?.expression?.getText()==='actualizarCalendario');assert.ok(refresh);
  assert.equal(attr(refresh,'disabled')?.initializer?.expression?.getText(),'actualizando');
  for(const button of buttons){assert.equal(attr(button,'hidden'),undefined);assert.equal(attr(button,'aria-hidden'),undefined);}
});

const css=postcss.parse(read('../styles.css'));
const design=postcss.parse(read('../design-system.css'));
test('legacy calendar/select/label/chevron styling excludes the shared type field in place',()=>{
  const paint=/^(?:font(?:-.+)?|line-height|letter-spacing|text-transform|color|background(?:-.+)?|border(?:-.+)?|padding(?:-.+)?|outline(?:-.+)?|height|min-height|appearance)$/;
  for(const [name,root] of [['styles.css',css],['design-system.css',design]])root.walkRules(rule=>{
    const declarations=rule.nodes.filter(node=>node.type==='decl');
    for(const selector of postcss.list.comma(rule.selector)){
      const relevant=/\.(?:cal-filters|editorial-type-filter)\b/.test(selector);
      if(!relevant)continue;
      if(/(?:^|[\s>+~,(])select(?=$|[\s.#[:>+~,)])/.test(selector)&&declarations.some(node=>paint.test(node.prop)))
        assert.ok(selector.includes(':not(.render-filter-select)'),`${name}: select presentation still matches ${selector}`);
      if((/\blabel\b/.test(selector)||selector.includes('.editorial-type-filter'))&&!selector.includes('select')&&
        (selector.includes('::after')||declarations.some(node=>/^(?:font(?:-.+)?|color|letter-spacing|text-transform)$/.test(node.prop))))
        assert.ok(selector.includes(':not(.render-filter-field)'),`${name}: inherited label/chevron still matches ${selector}`);
    }
  });
});

test('toolbar and filter container have a wrapping responsive contract, with no action-hiding rules',()=>{
  // Evaluate only exact known container selectors, their specificity and
  // supported width media. This is not a browser or a general CSS engine.
  function valuesAt(className,width){
    const result=new Map();let order=0;
    for(const root of [css,design])root.walkRules(rule=>{
      const candidates=postcss.list.comma(rule.selector).filter(selector=>[`.${className}`,`.publicaciones-viewport .${className}`].includes(selector.trim()));
      if(!candidates.length)return;
      for(let ancestor=rule.parent;ancestor&&ancestor.type!=='root';ancestor=ancestor.parent){
        assert.equal(ancestor.type,'atrule');assert.equal(ancestor.name,'media');
        const conditions=ancestor.params.split(/\s+and\s+/);
        for(const condition of conditions){const match=/^\(\s*(max|min)-width\s*:\s*(\d+)px\s*\)$/.exec(condition.trim());assert.ok(match,`Explicitly support new media: ${ancestor.params}`);if(match[1]==='max'?width>Number(match[2]):width<Number(match[2]))return;}
      }
      const specificity=Math.max(...candidates.map(selector=>selector.includes('.publicaciones-viewport')?2:1));
      for(const declaration of rule.nodes.filter(node=>node.type==='decl')){
        const rank=[declaration.important?1:0,specificity,++order],old=result.get(declaration.prop);
        if(!old||rank[0]>old.rank[0]||rank[0]===old.rank[0]&&(rank[1]>old.rank[1]||rank[1]===old.rank[1]&&rank[2]>old.rank[2]))result.set(declaration.prop,{value:declaration.value,rank});
      }
    });
    return Object.fromEntries([...result].map(([key,item])=>[key,item.value]));
  }
  for(const width of [320,390,440,480,760,768,1024,1120,1280,1440]){
    const toolbar=valuesAt('cal-toolbar',width);
    assert.equal(toolbar.display,'flex',`toolbar/${width}`);assert.equal(toolbar['flex-wrap'],'wrap');
    const filters=valuesAt('cal-filters',width);
    if(width<=760){
      assert.equal(filters.display,'grid');
      assert.equal(filters['grid-template-columns'],width<=440?'minmax(0, 1fr)':'repeat(2, minmax(0, 1fr))');
      assert.equal(filters.width,'100%');
    }else{
      assert.equal(filters.display,'flex');assert.equal(filters['flex-wrap'],'wrap');
      assert.equal(filters.flex,'1 1 640px','Keep the filters line together when wrapping below the month context');
    }
  }
  for(const root of [css,design])root.walkRules(rule=>{
    if(!/(?:\.cal-(?:toolbar|filters|monthnav|navbtn)|\.editorial-view-toggle)/.test(rule.selector))return;
    for(const node of rule.nodes.filter(node=>node.type==='decl')){
      assert.ok(!(node.prop==='display'&&node.value==='none')&&!(node.prop==='visibility'&&node.value==='hidden')&&!(node.prop==='opacity'&&node.value==='0'),`Do not conceal toolbar content: ${rule.selector}`);
    }
  });
});
