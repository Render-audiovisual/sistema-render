import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';

// Pre-142 native contracts captured explicitly during review, never fetched
// from git at runtime. CSS/AST/SSR only, not mounted/native select acceptance.
const filters = [
  ['Orden', `aria-label="Orden de tareas" value={sort} disabled={orderState.busy} onChange={event=>setSort(event.target.value)}`,
    `<option value="date">Fecha</option><option value="manual" disabled={Boolean(reviewScope)}>Manual</option>`],
  ['Estado', `aria-label="Filtrar por estado" value={taskStatus} onChange={(event) => changeTaskStatus(event.target.value)}`,
    `{taskStatus !== "all" && !STATUSES.some(item=>item.id===taskStatus) && <option value={taskStatus} disabled>Estado no válido</option>}<option value="all">Todos</option>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}`],
  ['Área', `aria-label="Área" value={area} onChange={(event) => setArea(event.target.value)}`,
    `<option value="all">Todas</option>{AREAS.slice(1).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}`],
  ['Responsable', `aria-label="Responsable" value={responsible} onChange={(event) => setResponsible(event.target.value)}`,
    `<option value="all">Todos</option>{responsibleNotice && <option value={responsible} disabled>Elegí un integrante</option>}{responsibleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}`],
  ['Cliente', `aria-label="Cliente" value={client} onChange={(event) => setClient(event.target.value)}`,
    `<option value="all">Todos</option><option value="none">Sin cliente</option>{clients.map((item) => <option key={item.id} value={String(item.id)}>{item.nombre}</option>)}`],
  ['Sector', `aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}`,
    `<option value="all">Todos</option><option value="none">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}`],
  ['Prioridad', `aria-label="Prioridad" value={priority} onChange={(event) => setPriority(event.target.value)}`,
    `<option value="all">Todas</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>`],
];
const clients = `<option value="">Sin cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.nombre}</option>)}`;
const priorities = `<option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option>`;
const sectors = `<option value="">Sin sector</option>{TASK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}`;
// Every remaining raw select, including detail, creation and card quick-state.
// Guarded approval/finalization options and ID conversions are intentionally
// outside the seven-control extraction and must remain unchanged.
const untouched = [
  [`className="ros-inline-property" aria-label="Estado" value={canonicalTaskState(draft.estado ?? task.estado ?? "pendiente")} disabled={saving} onChange={(event) => saveInlineField("estado", event.target.value, "actualizó el estado de la tarea")}`,
    `{availableTaskStatuses.map((item) => <option key={item.id} value={item.id} disabled={isProductionVisit && item.id === "finalizada" && !productionProgress.complete}>{item.label}</option>)}`],
  [`className="ros-inline-property" aria-label="Cliente" value={draft.cliente_id ?? task.cliente_id ?? ""} disabled={saving} onChange={(event) => saveInlineField("cliente_id", event.target.value ? Number(event.target.value) : "", "actualizó el cliente de la tarea")}`, clients],
  [`className="ros-inline-property" aria-label="Prioridad" value={draft.prioridad ?? task.prioridad ?? "media"} disabled={saving} onChange={(event) => saveInlineField("prioridad", event.target.value, "actualizó la prioridad de la tarea")}`, priorities],
  [`value={publicationResponsible ?? ""} onChange={(event) => setPublicationResponsible(event.target.value ? Number(event.target.value) : null)}`,
    `<option value="">Elegí quién publica</option>{users.filter((user) => Number.isSafeInteger(user.id) && user.id > 0 && ["admin", "community"].includes(user.rol)).map((user) => <option key={user.id} value={user.id}>{user.nombre} · #{user.id}</option>)}`],
  [`value={canonicalTaskState(draft.estado || "pendiente")} onChange={(event) => setDraft({ ...draft, estado: event.target.value })}`,
    `{availableTaskStatuses.filter((item) => item.id !== "aprobada" || task.estado === "aprobada").map((item) => <option key={item.id} value={item.id} disabled={isProductionVisit && item.id === "finalizada" && !productionProgress.complete}>{item.label}</option>)}`],
  [`value={draft.cliente_id || ""} onChange={(event) => setDraft({ ...draft, cliente_id: event.target.value ? Number(event.target.value) : "" })}`, clients],
  [`value={draft.prioridad || "media"} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}`, priorities],
  [`value={draft.tipo_tarea || ""} onChange={(event) => setDraft({ ...draft, tipo_tarea: event.target.value })}`, sectors],
  [`value={draft.cliente_id} onChange={(event) => { manuallyEdited.current.add("client"); setDraft((current) => applySuggestions({ ...current, cliente_id: event.target.value }, { clientId: event.target.value, clientWasSelected: true })); }}`, clients],
  [`value={draft.prioridad} onChange={(event) => setDraft({ ...draft, prioridad: event.target.value })}`, priorities],
  [`value={draft.tipo_tarea} onChange={(event) => { manuallyEdited.current.add("classification"); setDraft({ ...draft, tipo_tarea: event.target.value }); }}`, sectors],
  ['className="ros-mobile-state" disabled={moveBlocked} aria-label={`Cambiar estado de ${task.titulo}`} value={canonicalTaskState(task.estado)} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); onMove(task, event.target.value); }}',
    `{availableStatuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}`],
];
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function parse(source) { const tree=ts.createSourceFile('contract.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);assert.equal(tree.parseDiagnostics.length,0);return tree; }
const tree = parse(read('./WorkspaceReadOnly.jsx'));
function find(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
function signature(node){
  if(ts.isJsxText(node)){const value=node.text.replace(/\s+/g,' ').trim();return value?['jsx-text',value]:null;}
  const children=node.getChildren();return children.length?[node.kind,...children.map(signature).filter(value=>value!==null)]:[node.kind,typeof node.text==='string'?node.text:node.getText()];
}
const attr=(node,name)=>node.openingElement.attributes.properties.find(value=>ts.isJsxAttribute(value)&&value.name.text===name);
const shared=find(tree,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='FilterSelect');
const expected=(tag,attrs,children)=>find(parse(`<${tag} ${attrs}>${children}</${tag}>`),ts.isJsxElement)[0];
const byLabel=label=>{const rows=shared.filter(node=>attr(node,'label')?.initializer?.text===label);assert.equal(rows.length,1,label);return rows[0];};

test('seven unchanged task filters coexist with the separately tested mobile view selector',()=>{
  assert.deepEqual(shared.map(node=>attr(node,'label')?.initializer?.text),['Vista de tareas',...filters.map(([label])=>label)]);
  for(const [label,attrs,children] of filters){
    const actual=byLabel(label),baseline=expected('FilterSelect',`label=${JSON.stringify(label)} ${attrs}`,children);
    assert.deepEqual(signature(actual),signature(baseline),`${label}: AST baseline including all guards/handlers/options`);
    let functionOwner=actual;while(functionOwner&&!ts.isFunctionDeclaration(functionOwner))functionOwner=functionOwner.parent;
    assert.equal(functionOwner?.name?.text,'TasksView');
    for(let parent=actual.parent;parent;parent=parent.parent)assert.ok(!ts.isJsxElement(parent)||parent.openingElement.tagName.getText()!=='label','No nested labels');
  }
  const imports=tree.statements.filter(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text==='../components/FilterSelect.jsx');
  assert.equal(imports.length,1);assert.ok(imports[0].importClause.namedBindings.elements.some(node=>node.name.text==='FilterSelect'&&!node.propertyName));
});

test('all twelve raw detail/create/card selectors outside the seven filters retain their native contracts',()=>{
  const actual=find(tree,node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='select');
  assert.equal(actual.length,12);
  assert.deepEqual(actual.map(signature),untouched.map(([attrs,children])=>signature(expected('select',attrs,children))));
});

function evaluate(source,bindings){const js=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;return Function('React',...Object.keys(bindings),`${js};return result;`)(React,...Object.values(bindings));}
const componentTree=parse(read('../components/FilterSelect.jsx'));
const component=componentTree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='FilterSelect');
const FilterSelect=evaluate(`const result=(${component.getText().replace(/^export\s+/,'')});`,{});
function rendered(label,bindings){return evaluate(`const result=(${byLabel(label).getText()});`,{FilterSelect,...bindings});}
test('actual shared JSX retains invalid historical state/responsible placeholders and original callbacks',()=>{
  const calls=[];
  const state=rendered('Estado',{taskStatus:'historical-invalid',STATUSES:[{id:'pendiente',label:'Pendiente'}],changeTaskStatus:value=>calls.push(['state',value])});
  const stateHtml=renderToStaticMarkup(state);
  assert.match(stateHtml,/<option value="historical-invalid" disabled="" selected="">Estado no válido<\/option>/);
  assert.match(stateHtml,/aria-label="Filtrar por estado"/);
  state.props.onChange({target:{value:'pendiente'}});
  const responsible=rendered('Responsable',{responsible:'invalid:duplicate',responsibleNotice:'Invalid',responsibleOptions:[{value:'id:91003',label:'Luciano · #91003'}],setResponsible:value=>calls.push(['responsible',value])});
  assert.match(renderToStaticMarkup(responsible),/<option value="invalid:duplicate" disabled="" selected="">Elegí un integrante<\/option>/);
  responsible.props.onChange({target:{value:'id:91003'}});
  assert.deepEqual(calls,[['state','pendiente'],['responsible','id:91003']]);
});

test('actual order control remains busy-disabled and disables manual specifically in review scope',()=>{
  const calls=[];
  for(const busy of [false,true])for(const reviewScope of ['', 'personal', 'team']){
    const order=rendered('Orden',{sort:'date',orderState:{busy},reviewScope,setSort:value=>calls.push(value)});
    assert.equal(order.props.disabled,busy);
    const native=FilterSelect(order.props),select=React.Children.toArray(native.props.children).find(node=>node.type==='select');
    assert.equal(select.props.disabled,busy);assert.equal(select.props['aria-label'],'Orden de tareas');
    const options=React.Children.toArray(select.props.children);
    assert.equal(options.find(node=>node.props.value==='manual').props.disabled,Boolean(reviewScope));
  }
  rendered('Orden',{sort:'date',orderState:{busy:false},reviewScope:'',setSort:value=>calls.push(value)}).props.onChange({target:{value:'manual'}});
  assert.deepEqual(calls,['manual']);
});

test('task filter/order CSS delegates shared paint/type/focus/height and label text while retaining container layout',()=>{
  const owned=/^(?:font(?:-.+)?|line-height|color|background(?:-.+)?|border(?:-.+)?|padding(?:-.+)?|outline(?:-.+)?|min-height|height)$/;
  let containers=0;
  for(const name of ['WorkspaceReadOnly','RenderApplePolish']){
    postcss.parse(read(`./${name}.css`)).walkRules(rule=>{
      const declarations=rule.nodes.filter(node=>node.type==='decl');
      for(const selector of postcss.list.comma(rule.selector)){
        const inFilter=/\.ros-(?:filter-bar|order-toolbar)\b/.test(selector);
        const targetsSelect=/(?:^|[\s>+~,(])select(?=$|[\s.#[:>+~,)])/.test(selector);
        if((inFilter&&targetsSelect||selector.includes(':focus-visible')&&targetsSelect)&&declarations.some(node=>owned.test(node.prop)))
          assert.ok(selector.includes(':not(.render-filter-select)'),`${name}: shared select must not match ${selector}`);
        if(inFilter&&/\blabel\b/.test(selector)&&declarations.some(node=>/^(?:font(?:-.+)?|line-height|color)$/.test(node.prop)))
          assert.ok(selector.includes(':not(.render-filter-field)'),`${name}: shared label/span must not match ${selector}`);
        if(selector.endsWith('.ros-filter-bar')&&declarations.some(node=>/^(?:display|grid-template-columns|gap|column-gap)$/.test(node.prop)))containers++;
      }
    });
  }
  assert.ok(containers>0,'Container layout rules remain; extraction is not removal of the filter bar');
});
