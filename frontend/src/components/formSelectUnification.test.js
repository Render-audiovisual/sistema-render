import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';

// Explicit pre-135 native-select contracts captured during review. No git,
// network, app runtime or DB dependency; these remain valid after committing.
// AST equivalence ignores formatting, NOT literal content or callback bodies.
const contracts = [
  ['Productions','CreateVisit','Cliente',
    `required value={draft.cliente_id} disabled={locked} onChange={e=>setDraft({...draft,cliente_id:e.target.value})}`,
    `<option value="">Elegí un cliente</option>{clients.map(client=><option value={client.id} key={client.id}>{client.nombre}</option>)}`],
  ['Productions','MediaForm','Estado',
    `value={draft.estado} disabled={busy} onChange={e=>setDraft({...draft,estado:e.target.value})}`,
    `{Object.entries(video ? VIDEO_STATES : PHOTO_STATES).map(([id,label])=><option key={id} value={id}>{label}</option>)}`],
  ['Productions','SendToEditing','Editor',
    `required value={editorId} disabled={busy} onChange={e=>setEditorId(e.target.value)}`,
    `<option value="">Elegí una persona</option>{users.filter(user=>user.activo === true && ['admin','edicion'].includes(user.rol)).map(user=><option key={user.id} value={user.id}>{user.nombre} · #{user.id}</option>)}`],
  ['Productions','EditorialAssociation',`{kind === 'piece' ? 'Publicación existente' : 'Casillero vacío'}`,
    `value={choice} required disabled={busy || submitting || !catalogReady} onChange={event=>{setChoice(event.target.value);setAcknowledged(false);}}`,
    `<option value="">{kind === 'piece' ? 'Elegí una publicación' : 'Elegí un casillero'}</option>{unavailable && <option disabled value={choice}>La selección anterior ya no está disponible</option>}{options.map(item=><option key={kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id} value={kind === 'piece' ? item.publicacion_id : item.objetivo_pieza_id}>{item.titulo || (kind === 'piece' ? \`Publicación #\${item.publicacion_id}\` : \`Video \${item.numero}\`)} · tarea #{item.tarea_id}{item.objetivo_pieza_id ? \` · casillero #\${item.objetivo_pieza_id}\` : ''}{item.fecha_programada ? \` · \${item.fecha_programada}\` : ''}</option>)}`],
  ['Productions','ProductionsPage','Visita de destino',
    `value={selected?.id || ''} disabled={busy} onChange={e=>{if(e.target.value)openVisit(e.target.value);}}`,
    `<option value="">Elegí una visita del mes</option>{filtered.map(visit=><option key={visit.id} value={visit.id}>{visit.fecha} · {visit.cliente_nombre} · {visit.titulo}</option>)}`],
  ['Projects','StageSelect','Etapa',
    `value={value || ""} onChange={event => onChange(event.target.value)}`,
    `<option value="">Sin etapa</option>{project.etapas.map(stage => <option key={stage.id} value={stage.id}>{stage.titulo}</option>)}`],
  ['Projects','ProjectFields','Tipo', `value={d.tipo} onChange={event => change("tipo", event.target.value)}`, `<Options values={PROJECT_TYPES}/>`],
  ['Projects','ProjectFields','Estado del proyecto', `value={d.estado} onChange={event => change("estado", event.target.value)}`, `<Options values={PROJECT_STATES}/>`],
  ['Projects','ProjectFields','Cliente',
    `required value={d.cliente_id} disabled={catalog.status !== "ready" || (!creating && project.counts.tareas > 0)} onChange={event => change("cliente_id", event.target.value)}`,
    `<option value="">Elegir cliente activo</option>{!creating && !catalog.clients.some(client => String(client.id) === String(d.cliente_id)) && <option value={project.cliente.id}>{project.cliente.nombre} (actual)</option>}{catalog.clients.map(client => <option key={client.id} value={client.id}>{client.nombre} · ID {client.id}</option>)}`],
  ['Projects','ProjectFields','Responsable',
    `required value={d.responsable_id} disabled={catalog.status !== "ready"} onChange={event => change("responsable_id", event.target.value)}`,
    `<option value="">Elegir persona activa</option>{!creating && !catalog.users.some(user => String(user.id) === String(d.responsable_id)) && <option value={project.responsable.id}>{project.responsable.nombre} · ID {project.responsable.id} (actual)</option>}{catalog.users.map(user => <option key={user.id} value={user.id}>{user.nombre} · {user.usuario || \`ID \${user.id}\`} · ID {user.id}</option>)}`],
  ['Projects','ProjectEditor','Estado', `value={d.estado} onChange={event => change("estado", event.target.value)}`, `<Options values={STAGE_STATES}/>`],
  ['Projects','ProjectEditor','Estado', `value={d.estado} onChange={event => change("estado", event.target.value)}`, `<Options values={MILESTONE_STATES}/>`],
  ['Projects','ProjectEditor','Estado', `value={d.estado} onChange={event => change("estado", event.target.value)}`,
    `{d.estado==='aprobado'&&<option disabled value="aprobado">Aprobación registrada (no editable aquí)</option>}<Options values={DELIVERABLE_EDIT_STATES}/>`],
];
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function parse(source) {
  const tree = ts.createSourceFile('contract.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(tree.parseDiagnostics.length, 0); return tree;
}
const routes = Object.fromEntries(['Projects','Productions'].map(name=>[name,parse(read(`../pages/${name}.jsx`))]));
function find(root, predicate) {
  const result=[]; function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);} visit(root); return result;
}
function signature(node) {
  if (ts.isJsxText(node)) { const text=node.text.replace(/\s+/g,' ').trim();return text?['jsx-text',text]:null; }
  const children=node.getChildren();
  if (!children.length) return [node.kind,typeof node.text==='string'?node.text:node.getText()];
  return [node.kind,...children.map(signature).filter(value=>value!==null)];
}
const attr = (node,name)=>node.openingElement.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.text===name);
function owner(node){while(node&&!ts.isFunctionDeclaration(node))node=node.parent;return node?.name?.text;}
const shared = tree=>find(tree,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='FilterSelect');
function expected(label,attrs,children){return find(parse(`<FilterSelect label=${label.startsWith('{')?label:JSON.stringify(label)} ${attrs}>${children}</FilterSelect>`),ts.isJsxElement)[0];}
function nativeAttributes(node){return node.openingElement.attributes.properties.filter(value=>!ts.isJsxAttribute(value)||!['label','className','aria-describedby'].includes(value.name.text)).map(signature);}
function children(node){return node.children.map(signature).filter(value=>value!==null);}

for(const route of ['Projects','Productions'])test(`${route}: every converted native select preserves owner, label, attributes, handlers and complete options`,()=>{
  const specs=contracts.filter(row=>row[0]===route),mapped=new Set();
  assert.equal(specs.length,route==='Projects'?8:5);
  for(const [,functionName,label,attrs,options] of specs){
    const baseline=expected(label,attrs,options);
    const matches=shared(routes[route]).filter(node=>owner(node)===functionName
      && JSON.stringify(signature(attr(node,'label')))===JSON.stringify(signature(attr(baseline,'label')))
      && JSON.stringify(children(node))===JSON.stringify(children(baseline)));
    assert.equal(matches.length,1,`${route}/${functionName}/${label}: exact options and label`);
    const actual=matches[0];assert.ok(!mapped.has(actual));mapped.add(actual);
    assert.deepEqual(nativeAttributes(actual),nativeAttributes(baseline),`${functionName}: no required/value/disabled/handler drift`);
    const extraDescription=attr(actual,'aria-describedby');
    assert.equal(Boolean(extraDescription),route==='Projects'&&functionName==='ProjectFields'&&label==='Cliente');
    const className=attr(actual,'className');
    if(route==='Productions'&&functionName==='EditorialAssociation')assert.equal(className?.initializer?.text,'prod-wide');
    else assert.equal(className,undefined);
  }
  assert.equal(find(routes[route],node=>(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText()==='select').length,0);
  assert.equal(shared(routes[route]).length,route==='Projects'?10:6);
  for(const node of shared(routes[route]))for(let parent=node.parent;parent;parent=parent.parent)
    assert.ok(!ts.isJsxElement(parent)||parent.openingElement.tagName.getText()!=='label','No nested wrapping labels');
});

test('the preexisting list/toolbar FilterSelect controls retain their exact contracts',()=>{
  const originals=[
    ['Projects','ProjectsSession','Cliente',`aria-label="Filtrar proyectos por cliente" value={filters.invalid ? 'invalid' : filters.clientId ?? ''} onChange={event => chooseClient(event.target.value)}`,
      `{filters.invalid && <option value="invalid" disabled>Filtro inválido</option>}<option value="">Todos los clientes</option>{filters.clientId !== null && !filterClients.items.some(item => item.id === filters.clientId) && <option value={filters.clientId}>Cliente ID {filters.clientId}</option>}{filterClients.items.map(item => <option key={item.id} value={item.id}>{item.nombre} · ID {item.id}</option>)}`],
    ['Projects','ProjectsSession','Estado',`value={filters.estado} disabled={filters.invalid} onChange={event => changeListFilters({ estado: event.target.value, offset: 0 })}`,`<option value="">Todos los estados</option><Options values={PROJECT_STATES}/>`],
    ['Productions','ProductionsPage','Cliente',`value={clientId} onChange={e=>changeContext(e.target.value,tab)}`,
      `<option value="">Todos los clientes</option>{clientId && !clients.some(client=>String(client.id)===clientId) && <option value={clientId}>Cliente #{clientId}</option>}{clients.map(client=><option key={client.id} value={client.id}>{client.nombre}{client.activo === false ? ' (inactivo)' : ''}</option>)}`],
  ];
  for(const [route,functionName,label,attrs,options] of originals){
    const baseline=expected(label,attrs,options);
    const matches=shared(routes[route]).filter(node=>owner(node)===functionName&&JSON.stringify(signature(node))===JSON.stringify(signature(baseline)));
    assert.equal(matches.length,1,`${route}/${label}: original filter unchanged`);
  }
});

test('client lock explanation remains visible outside the label and is conditionally described by its actual ID',()=>{
  const candidates=shared(routes.Projects).filter(node=>owner(node)==='ProjectFields'&&attr(node,'label')?.initializer?.text==='Cliente');
  assert.equal(candidates.length,1);const field=candidates[0],wrapper=field.parent;
  assert.ok(ts.isJsxElement(wrapper));assert.equal(wrapper.openingElement.tagName.getText(),'div');
  assert.equal(attr(wrapper,'className')?.initializer?.text,'pr-field-stack');
  const expr=attr(field,'aria-describedby').initializer.expression;
  const baseline=parse(`const value = !creating && project.counts.tareas > 0 ? 'project-client-lock-help' : undefined;`);
  const value=find(baseline,ts.isVariableDeclaration)[0].initializer;
  assert.deepEqual(signature(expr),signature(value));
  const help=find(wrapper,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='small');
  assert.equal(help.length,1);assert.equal(attr(help[0],'id')?.initializer?.text,'project-client-lock-help');
  assert.equal(help[0].children.filter(ts.isJsxText).map(node=>node.text).join('').trim(),'El cliente no se cambia mientras haya tareas vinculadas.');
  const condition=help[0].parent;
  assert.ok(ts.isBinaryExpression(condition));
  assert.deepEqual(signature(condition.left),signature(expr.condition));
  const rules=[];postcss.parse(read('../pages/Projects.css')).walkRules(rule=>{if(rule.selector==='.pr-field-stack')rules.push(rule);});
  assert.equal(rules.length,1);const css=Object.fromEntries(rules[0].nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));
  assert.deepEqual(css,{display:'grid',gap:'8px','min-width':'0','align-content':'start'});
});

test('actual shared component SSR stays a labeled native select with forwarded native props, not a new widget',()=>{
  const tree=parse(read('./FilterSelect.jsx'));
  const fn=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FilterSelect');assert.ok(fn);
  const js=ts.transpileModule(`const component = (${fn.getText().replace(/^export\s+/,'')});`,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  const FilterSelect=Function('React',`${js};return component;`)(React),onChange=()=>{},ref={current:null};
  const element=FilterSelect({label:'Editor',required:true,disabled:true,name:'editor',value:'91003',ref,onChange,'aria-describedby':'editor-help',children:React.createElement('option',{value:'91003'},'QA Editor')});
  assert.equal(element.type,'label');const native=React.Children.toArray(element.props.children).find(node=>node.type==='select');assert.ok(native);
  assert.equal(native.props.onChange,onChange);assert.equal(native.props.ref,ref);assert.equal(native.props.required,true);assert.equal(native.props.disabled,true);
  assert.equal(native.props.name,'editor');assert.equal(native.props['aria-describedby'],'editor-help');
  const html=renderToStaticMarkup(element);assert.match(html,/<label[^>]*><span>Editor<\/span><select/);assert.doesNotMatch(html,/role="(?:combobox|listbox)"|<button/);
});
