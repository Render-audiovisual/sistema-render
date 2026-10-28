import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';

// Static CSS/AST and actual JSX server-render regressions ONLY. Injected hook
// state is not mounted React, computed cascade, browser contrast or native QA.
const source = readFileSync(new URL('./Sueldos.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const design = readFileSync(new URL('../design-system.css', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('Sueldos.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const css = postcss.parse(styles);
const owner = name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const constant = name => file.statements.find(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => item.name.getText(file) === name));
const text = node => node.getText(file);
function nodes(root, predicate) {
  const result = []; function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }
  visit(root); return result;
}
const attr = (element, name) => element.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
const literalClass = element => {
  const value = attr(element, 'className')?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : '';
};
const body = owner('SueldosContent');
const metric = nodes(body, node => ts.isJsxElement(node)
  && literalClass(node.openingElement).split(/\s+/).includes('finance-metrics'))[0];
const blockStart = styles.indexOf('/* Finanzas: tablero ejecutivo de solo lectura */');
const blockEnd = styles.indexOf('@media (max-width:760px)', blockStart);
const financeBlock = styles.slice(blockStart, blockEnd);
const rules = selector => {
  const found = []; css.walkRules(rule => { if (rule.selectors.includes(selector)) found.push(rule); }); return found;
};
const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
const baseRule = selector => {
  // A grouped structural rule may set44px sizing for several buttons; it is
  // not a second competing palette rule for the standalone selector.
  const found = rules(selector).filter(rule => rule.parent.type === 'root' && rule.selector.trim() === selector);
  assert.equal(found.length, 1, `One original base rule for ${selector}; do not append a competing theme`);
  assert.ok(found[0].source.start.offset > blockStart && found[0].source.start.offset < blockEnd);
  return declarations(found[0]);
};
const sharedValue = value => /^var\(--(?:render-[a-z-]+|text|muted|border|surface|bg|accent|success|danger)\)$/.test(value || '');

test('finance light styling replaces the original block in place; no late theme layer, dark hero or neon gradients', () => {
  assert.ok(blockStart >= 0 && blockEnd > blockStart, 'Original finance block boundaries remain explicit');
  assert.equal(styles.split('/* Finanzas: tablero ejecutivo de solo lectura */').length - 1, 1);
  assert.doesNotMatch(financeBlock, /(?:radial|linear)-gradient\(|#(?:b5fc00|93cf00|c7ff3d|171a13|252a1d|202418)\b|rgba\(\s*181\s*,\s*252\s*,\s*0\b/i);
  assert.doesNotMatch(financeBlock, /!important|data-theme|prefers-color-scheme/);
  css.walkRules(rule => {
    if (/\.finance-(?:billing-hero|chart-column|client-table|metrics|metric-|contract)/.test(rule.selector)) {
      assert.ok(rule.source.start.offset > blockStart && rule.source.end.offset < blockEnd,
        `Owned finance styling stays in its original block, not an appended override: ${rule.selector}`);
    }
  });
  for (const selector of ['.finance-billing-hero', '.finance-chart-column.is-current i', '.finance-client-table footer', '.finance-contract-primary']) {
    const rule = baseRule(selector);
    assert.ok(sharedValue(rule.background || rule['background-color']), `${selector} uses a shared surface/action token`);
  }
  for (const selector of ['.finance-billing-hero', '.finance-client-table footer', '.finance-contract-primary'])
    assert.ok(sharedValue(baseRule(selector).color), `${selector} uses shared ink`);
  const hero = baseRule('.finance-billing-hero');
  assert.match(hero.background || hero['background-color'], /--(?:render-surface(?:-soft|-muted)?|surface|bg)\)/);
  assert.match(hero.color, /--(?:render-ink(?:-soft)?|text)\)/);
  // Existing shared foundation loads after the legacy sheet; this does not
  // claim that merely checking import order proves the browser cascade.
  assert.ok(entry.indexOf('"./styles.css"') < entry.indexOf('"./design-system.css"'));
  assert.match(design, /--render-surface:\s*#ffffff\s*;/);
});

test('actual metric JSX owns semantic classes, not inline palette/type presentation; status distinctions remain explicit', () => {
  assert.equal(file.parseDiagnostics.length, 0); assert.ok(metric);
  const articles = metric.children.filter(node => ts.isJsxElement(node) && text(node.openingElement.tagName) === 'article');
  assert.equal(articles.length, 4);
  for (const article of articles) {
    const value = nodes(article, node => ts.isJsxElement(node) && text(node.openingElement.tagName) === 'strong'
      && Boolean(attr(node.openingElement, 'className')))[0];
    assert.ok(value && text(attr(value.openingElement, 'className')).includes('finance-metric-value'), 'Every metric value gets its semantic style class');
    const presentations = nodes(article, node => ts.isJsxAttribute(node) && node.name.text === 'style');
    assert.deepEqual(presentations, [], 'Metric type, surfaces and status colors belong to the owned CSS block');
  }
  assert.match(text(metric), /is-negative/); assert.match(text(metric), /is-positive/);
  assert.match(financeBlock, /\.is-negative[^{}]*\{[^}]*var\(--(?:render-danger|danger)\)/);
  assert.match(financeBlock, /\.is-positive[^{}]*\{[^}]*var\(--(?:render-success|success)\)/);
});

test('finance source retains responsive wrapping,44px controls and visible token-based focus/primary hover', () => {
  assert.match(financeBlock, /@media\s*\(max-width:\s*700px\)/);
  assert.match(financeBlock, /@media\s*\(max-width:\s*420px\)/);
  assert.match(financeBlock, /grid-template-columns:\s*1fr/);
  assert.match(financeBlock, /min-width:\s*0/);
  assert.match(financeBlock, /overflow-wrap:\s*anywhere/);
  for (const selector of ['.finance-contract-primary', '.finance-contract-secondary', '.finance-contract-status']) {
    const matches = rules(selector).filter(rule => rule.parent.type === 'root');
    assert.ok(matches.some(rule => /^(?:44px|var\(--render-control-height\))$/.test(declarations(rule)['min-height'] || '')), selector);
  }
  const focus = []; css.walkRules(rule => {
    if (rule.selector.includes('finance-') && rule.selector.includes(':focus-visible')) focus.push(declarations(rule));
  });
  assert.ok(focus.some(rule => /var\(--render-(?:accent|focus)/.test(`${rule.outline || ''} ${rule['box-shadow'] || ''}`)), 'Visible shared focus, not outline:none alone');
  assert.ok(rules('.finance-contract-primary:hover:not(:disabled)').some(rule =>
    /var\(--render-accent-hover\)/.test(declarations(rule).background || declarations(rule)['background-color'] || '')));
});

test('1280px metric overflow regression: two columns through1400, one through700, full amounts wrap without ellipsis', () => {
  const metricAt = width => rules('.finance-metrics').filter(rule => rule.parent.type === 'atrule'
    && rule.parent.name === 'media' && new RegExp(`^\\(\\s*max-width\\s*:\\s*${width}px\\s*\\)$`).test(rule.parent.params));
  assert.ok(metricAt(1400).some(rule => /^repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)$/.test(declarations(rule)['grid-template-columns'] || '')),
    '1280px uses the explicit <=1400 two-column rule instead of four narrow cards');
  assert.ok(metricAt(700).some(rule => declarations(rule)['grid-template-columns'] === '1fr'));
  const value = { ...baseRule('.finance-metrics strong'), ...baseRule('.finance-metrics .finance-metric-value') };
  assert.equal(value['min-width'], '0'); assert.equal(value['overflow-wrap'], 'anywhere');
  css.walkRules(rule => {
    if (/\.finance-metrics(?:\s+strong|\s+\.finance-metric-value)/.test(rule.selector)) {
      const declaration = declarations(rule);
      assert.notEqual(declaration['text-overflow'], 'ellipsis');
      assert.notEqual(declaration['white-space'], 'nowrap');
      assert.notEqual(declaration.overflow, 'hidden');
    }
  });
  const data = fixtureData(); data.finance.facturacion = 1250000000.50;
  const before = structuredClone(data), { html } = render(data);
  assert.ok(html.includes('1.250.000.000,50'), 'Actual JSX preserves every digit and cent; no shortened amount');
  assert.deepEqual(data, before);
  // Browser scrollWidth/clientWidth at1280 remains an independent native check.
});

function fixtureData(result = 85000.15) {
  const finance = { period: '2026-10', workPeriod: '2026-09', facturacion: 125000.50, sueldos: 35000.25,
    gastosFijosARS: 5000.10, resultadoARS: result,
    ingresos: [{ nombre: 'Contrato <script>QA112</script>', importe: 125000.50, prorrateado: false, diasActivos: 30, diasDelMes: 30 }],
    gastos: [{ nombre: 'Impuesto previsto', categoria: 'impuestos', moneda: 'ARS', importe: 5000.10, diaPago: 10 }] };
  return { finance, previousFinance: { ...finance, period: '2026-09', workPeriod: '2026-08', facturacion: 120000,
    sueldos: 30000, gastosFijosARS: 4000, resultadoARS: 86000 }, exchangeRate: { original: 2011.75, rounded: 2100,
    source: 'Cotización de respaldo', fallback: true }, payroll: [{ name: 'Equipo QA112', total: 35000.25 }],
  payrollPending: ['Variable QA112'], billingHistory: [{ period: '2026-10', total: 125000.50 }] };
}
function render(data, overrides = {}) {
  // Discover state bindings from the actual AST instead of keeping a brittle
  // parallel positional list when unrelated page state is added.
  const stateNames = nodes(body, node => ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
    && ts.isCallExpression(node.initializer) && text(node.initializer.expression) === 'useState')
    .map(node => text(node.name.elements[0].name));
  const state = { period: '2026-10', periodError: '', data, contracts: [], contractsReady: true, contractsError: '',
    refreshVersion: 0, loading: false, error: '', contractActive: false, deferredNotice: '', paymentActive: false, ...overrides };
  let cursor = 0; const panels = [];
  const declarations = [constant('ars'), constant('monthLabel'), owner('labelPeriod'), owner('formatVariation'), owner('BillingChart'), body]
    .map(text).join('\n');
  const code = ts.transpileModule(declarations, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const session = Object.freeze({ token: 'synthetic-static-render-only', usuario: { id: 11, rol: 'admin', activo: true } });
  const deps = { React, useState: initial => {
    const name = stateNames[cursor++]; assert.ok(name && Object.hasOwn(state, name), `Unmapped actual state: ${name}`);
    return [state[name], () => {}];
  }, useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect() {},
  useScopedRequest: () => ({ view: { session }, capture: () => ({ current: () => true }) }),
  salaryPeriod: () => '2026-10', currentPeriod: () => '2026-10', window: { location: { search: '?periodo=2026-10' } },
  TeamPaymentsPanel: props => { panels.push({ type: 'payments', props }); return React.createElement('section', { 'data-payment-boundary': true }); },
  FinanceContractsPanel: props => { panels.push({ type: 'contracts', props }); return React.createElement('section', { 'data-contract-boundary': true }); } };
  const Page = new Function(...Object.keys(deps), `${code};return SueldosContent;`)(...Object.values(deps));
  return { html: renderToStaticMarkup(React.createElement(Page, { sesion: session })), panels };
}

test('actual page JSX renders unchanged cents and semantic metric classes, with truthful projection and fallback evidence', () => {
  for (const amount of [85000.15, -85000.15]) {
    const data = fixtureData(amount), before = structuredClone(data), { html } = render(data);
    assert.deepEqual(data, before);
    for (const value of ['125.000,50', '35.000,25', '5.000,10', '85.000,15']) assert.ok(html.includes(value), value);
    assert.match(html, /class="[^"]*finance-/);
    assert.ok(html.includes(`class="finance-metric-value ${amount >= 0 ? 'is-positive' : 'is-negative'}"`));
    assert.match(html, /Proyección por contratos/); assert.match(html, /No acreditan cobros ni pagos realizados/);
    assert.match(html, /No acredita pagos/); assert.match(html, /no confirma facturas emitidas/);
    assert.match(html, /Cotización de respaldo/); assert.match(html, /is-fallback/); assert.match(html, /2\.100,00/);
    assert.match(html, /Cálculo de sueldo variable pendiente/); assert.match(html, /Variable QA112/);
    assert.match(html, /Contrato &lt;script&gt;QA112&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  }
});

test('real summary error/loading does not fabricate values or unmount independent editors; pending controls remain disabled', () => {
  const { html, panels } = render(null, { loading: true, error: 'No se pudo verificar el resumen.', contractActive: true });
  assert.match(html, /Calculando el mes/); assert.match(html, /No se pudo verificar el resumen/);
  assert.match(html, /No acreditan cobros ni pagos realizados/);
  assert.doesNotMatch(html, /125\.000,50|85\.000,15|finance-billing-hero/);
  assert.match(html, /<input[^>]*type="month"[^>]*disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Reintentar resumen/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Recargar contratos/);
  assert.deepEqual(panels.map(panel => panel.type).sort(), ['contracts', 'payments']);
  assert.equal(panels.find(panel => panel.type === 'payments').props.disabled, true);
  const paymentPending = render(fixtureData(), { contractActive: true, paymentActive: true });
  assert.equal(paymentPending.panels.find(panel => panel.type === 'contracts').props.disabled, true);
  assert.equal(paymentPending.panels.find(panel => panel.type === 'payments').props.disabled, false);
});
