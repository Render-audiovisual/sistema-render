import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Execute the actual page JSX with injected hook state; not mounted React or payment/HTTP QA.
const source=readFileSync(new URL('./Sueldos.jsx',import.meta.url),'utf8');
const file=ts.createSourceFile('Sueldos.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
const owner=name=>file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
const constant=name=>file.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(file)===name));
function nodes(root,predicate){const result=[];function visit(node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;}
function dto(){
 const finance={period:'2026-10',workPeriod:'2026-09',facturacion:125000.50,sueldos:35000.25,gastosFijosARS:5000.10,resultadoARS:85000.15,
 ingresos:[{nombre:'Contrato <script>',importe:125000.50,prorrateado:false,diasActivos:30,diasDelMes:30}],gastos:[{nombre:'Impuesto previsto',categoria:'impuestos',moneda:'ARS',importe:5000.10,diaPago:10}]};
 return{finance,previousFinance:{...finance,period:'2026-09',workPeriod:'2026-08',facturacion:0,sueldos:0,gastosFijosARS:0,resultadoARS:0},exchangeRate:{original:2011.75,rounded:2100,source:'Cotización de respaldo',fallback:true},payroll:[{name:'Equipo QA',total:35000.25}],payrollPending:['Variable QA'],billingHistory:[{period:'2026-10',total:125000.50}]};
}
function render(value,overrides={}){
 let index=0;const states=['2026-10','',value,[],true,'',0,overrides.loading||false,overrides.error||'',false,''];
 const declarations=[constant('ars'),constant('monthLabel'),owner('labelPeriod'),owner('formatVariation'),owner('BillingChart'),owner('SueldosContent')].map(node=>node.getText(file)).join('\n');
 const code=ts.transpileModule(declarations,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
 const session={token:'synthetic',usuario:{id:11,rol:'admin',activo:true}};
 const panels=[];
 const deps={React,useState:()=>[states[index++],()=>{}],useRef:initial=>({current:initial}),useCallback:fn=>fn,useEffect(){},useScopedRequest:()=>({view:{session},capture:()=>({current:()=>true})}),salaryPeriod:()=> '2026-10',currentPeriod:()=> '2026-10',window:{location:{search:'?periodo=2026-10'}},TeamPaymentsPanel:()=>null,FinanceContractsPanel:props=>{panels.push(props);return React.createElement('div',{'data-contract-panel':'retained'},'Contratos financieros');}};
 const Page=new Function(...Object.keys(deps),`${code};return SueldosContent;`)(...Object.values(deps));
 return{html:renderToStaticMarkup(React.createElement(Page,{sesion:session})),panels};
}
test('actual page render visibly separates calculation/expected amounts from real collection or payment evidence',()=>{
 assert.equal(file.parseDiagnostics.length,0);const value=dto(),before=structuredClone(value),{html}=render(value);assert.deepEqual(value,before);
 assert.match(html,/INGRESOS ESPERADOS/);assert.match(html,/Mes vencido · estimado/);assert.match(html,/Resultado proyectado/);assert.match(html,/Sueldos calculados/);assert.match(html,/Gastos fijos previstos/);
 assert.match(html,/role="note"[^>]*>Los importes son una proyección calculada\. No acreditan cobros ni pagos realizados\. Los pagos manuales se registran por separado\./);
 assert.match(html,/Estimación del período; no acredita pagos/);assert.match(html,/no confirma facturas emitidas ni cobros/);assert.match(html,/Monto estimado/);assert.match(html,/Cálculo de sueldo variable pendiente/);
 assert.match(html,/Proyección mes a mes/);assert.match(html,/Evolución mensual de ingresos proyectados/);assert.doesNotMatch(html,/FACTURACIÓN A COBRAR|Contratos facturados|Total pagado|Marcar pagado|Registrar pago/);
 assert.match(html,/Contrato &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('actual totals/detail/chart render cents exactly to two visible decimals and pass same formatter to contracts without mutating payroll formulas',()=>{
 const {html,panels}=render(dto());assert.match(html,/125\.000,50/);assert.doesNotMatch(html,/125\.001/);assert.match(html,/35\.000,25/);assert.match(html,/5\.000,10/);assert.match(html,/85\.000,15/);
 assert.equal(panels.length,1);assert.equal(panels[0].ars.format(125000.50).includes('125.000,50'),true);assert.equal(panels[0].ars.resolvedOptions().minimumFractionDigits,2);assert.equal(panels[0].ars.resolvedOptions().maximumFractionDigits,2);
 assert.match(html,/Cotización de respaldo/);assert.match(html,/is-fallback/);assert.match(html,/2\.011,75/);assert.match(html,/2\.100,00/);
});
test('disclaimer and independent contracts panel remain visible during summary loading/error; no fake payment endpoint or authority change',()=>{
 const {html,panels}=render(null,{loading:true,error:'No se pudo verificar el resumen.'});assert.match(html,/No acreditan cobros ni pagos realizados/);assert.match(html,/Calculando el mes/);assert.match(html,/Reintentar resumen/);assert.equal(panels.length,1);assert.match(html,/data-contract-panel="retained"/);
 assert.match(owner('SueldosPage').getText(file),/view.role !== 'admin'/);assert.match(source,/sesion=\{view.session\} ars=\{ars\}/);assert.match(source,/guard.request\(`\/api\/sueldos\?periodo=/);
 assert.doesNotMatch(source,/\/api\/[^'"`\s]*(?:pagos|payments)|method:\s*['"](?:POST|PATCH|DELETE)['"]/);
 const component=owner('SueldosContent');const requests=nodes(component,node=>ts.isCallExpression(node)&&node.expression.getText(file).endsWith('.request'));
 assert.deepEqual(requests.map(node=>node.arguments[0].getText(file)),["'/api/contratos'",'`/api/sueldos?periodo=${encodeURIComponent(period)}`']);
});
