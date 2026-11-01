import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNavigationGroups, isNavigationActive } from "./navigation.js";

// Source contracts and pure model tests only. No React mount, computed layout,
// browser focus simulation or claim that these replace Main's browser QA.
const source = readFileSync(new URL("./Sidebar.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./Sidebar.css", import.meta.url), "utf8");
const compact = value => value.replace(/\s+/g, " ").trim();
const collapsedSelector = '.sidebar[data-collapsed="true"]';

// Small block reader for this scoped stylesheet: preserves media ancestry so
// source assertions cannot pass on a matching rule in the mobile/global scope.
function blocks(text, context = []) {
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("{", cursor);
    if (open < 0) break;
    const header = compact(text.slice(cursor, open));
    let depth = 1, close = open + 1;
    for (; close < text.length && depth; close++) {
      if (text[close] === "{") depth++;
      if (text[close] === "}") depth--;
    }
    assert.equal(depth, 0, "Balanced scoped CSS blocks");
    const body = text.slice(open + 1, close - 1);
    if (header.startsWith("@")) result.push(...blocks(body, [...context, header]));
    else result.push({ selector: header, body, context });
    cursor = close;
  }
  return result;
}
function selectors(value) {
  const result = [];
  let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    if (["(", "["].includes(value[index])) depth++;
    if ([")", "]"].includes(value[index])) depth--;
    if (value[index] === "," && depth === 0) { result.push(compact(value.slice(start, index))); start = index + 1; }
  }
  result.push(compact(value.slice(start)));
  return result;
}
const rules = blocks(css);
const desktop = rule => rule.context.some(value => /@media\s*\(min-width:\s*981px\)/.test(value));
const mobile = rule => rule.context.some(value => /@media\s*\(max-width:\s*980px\)/.test(value));
const declaration = (rule, property) => rule.body.split(";").map(value => value.split(":"))
  .filter(([key]) => key.trim() === property).map(([, ...value]) => compact(value.join(":")));

test("collapse is component-only state and emits string true only for collapsed desktop", () => {
  assert.match(source, /\[collapsed, setCollapsed\] = useState\(false\)/);
  const expression = source.match(/data-collapsed=\{([^}\n]+)\}/)?.[1];
  assert.ok(expression);
  const evaluate = new Function("collapsed", "mobile", `return (${expression});`);
  for (const collapsed of [false, true]) for (const mobile of [false, true]) {
    assert.equal(evaluate(collapsed, mobile), collapsed && !mobile ? "true" : "false");
  }
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b|document\.cookie|\.style\.setProperty\(/);
  assert.doesNotMatch(source, /document\.(?:documentElement|body)\.(?:style|classList|setAttribute)/);
});

test("desktop collapse button retains explicit accessible action and expanded state", () => {
  const button = source.match(/<button\b[^]*?className="sidebar-collapse-toggle"[^]*?<\/button>/)?.[0];
  assert.ok(button);
  assert.match(button, /type="button"/);
  assert.match(button, /aria-label=\{collapsed \? "Expandir barra lateral" : "Contraer barra lateral"\}/);
  assert.match(button, /aria-expanded=\{!collapsed\}/);
  assert.match(button, /aria-controls="sidebar-drawer"/);
  assert.match(button, /setCollapsed\(\(value\) => !value\)/);
  assert.ok(rules.some(rule => mobile(rule) && selectors(rule.selector).includes(".sidebar .sidebar-collapse-toggle") && declaration(rule, "display").includes("none")));
});

test("every menu link keeps a real anchor, current state, accessible name and tooltip when its visible label collapses", () => {
  const start = source.indexOf("const renderLinksSección");
  const links = source.slice(start, source.indexOf("\n  return (", start));
  assert.ok(start >= 0);
  assert.match(links, /href=\{enlace\.href\}/);
  assert.match(links, /aria-label=\{enlace\.label\}/);
  assert.match(links, /title=\{enlace\.label\}/);
  assert.match(links, /aria-current=\{isNavigationActive\(enlace\.href, path, search\) \? "page" : undefined\}/);
  assert.match(links, /<span className="sidebar-link-text">\{enlace\.label\}<\/span>/);
  assert.doesNotMatch(links, /collapsed\s*\?/);
  const hiding = rules.filter(rule => selectors(rule.selector).some(selector => selector.endsWith(" .sidebar-link-text")) && declaration(rule, "display").includes("none"));
  assert.ok(hiding.length > 0);
  for (const rule of hiding) {
    assert.ok(desktop(rule));
    for (const selector of selectors(rule.selector)) assert.ok(selector.startsWith(collapsedSelector));
  }
});

test("72px geometry applies once to main or the workspace inner main, never the workspace wrapper", () => {
  const expected = [`${collapsedSelector} ~ main`, `${collapsedSelector} ~ .render-workspace > .ros-main`].sort();
  const geometry = rules.filter(rule => declaration(rule, "margin-left").length || declaration(rule, "--render-sidebar-width").length);
  assert.ok(geometry.length > 0);
  const actual = geometry.flatMap(rule => selectors(rule.selector));
  assert.deepEqual(actual.sort(), expected);
  for (const rule of geometry) {
    assert.ok(desktop(rule), "Geometry must not affect mobile or uncollapsed state");
    assert.deepEqual(declaration(rule, "--render-sidebar-width"), ["72px"]);
    assert.deepEqual(declaration(rule, "margin-left"), ["72px"]);
    assert.deepEqual(declaration(rule, "width"), ["calc(100% - 72px)"]);
    assert.equal(selectors(rule.selector).some(selector => /~\s*\.render-workspace$/.test(selector)), false, "Never offset the wrapper as well as .ros-main");
  }
  assert.ok(rules.some(rule => desktop(rule) && rule.selector === collapsedSelector && declaration(rule, "width").includes("72px")));
});

test("all collapsed rules stay inside min981 and CSS changes remain scoped to the sidebar and its declared siblings", () => {
  const collapsed = rules.filter(rule => rule.selector.includes(collapsedSelector));
  assert.ok(collapsed.length > 0);
  for (const rule of collapsed) assert.ok(desktop(rule), rule.selector);
  for (const rule of rules) for (const selector of selectors(rule.selector)) {
    assert.match(selector, /^\.sidebar(?:[\s[.:>+~]|$)/, `No root/global selector: ${selector}`);
  }
  assert.doesNotMatch(css, /(?:^|[},])\s*(?::root|html|body)\s*[{,]/);
  assert.ok(rules.some(rule => mobile(rule) && rule.selector === ".sidebar .sidebar-link" && declaration(rule, "min-height").includes("44px")));
  assert.ok(rules.some(rule => rule.selector.includes(":focus-visible") && declaration(rule, "outline").length));
  assert.ok(rules.some(rule => rule.context.some(value => /prefers-reduced-motion:\s*reduce/.test(value)) && declaration(rule, "transition").includes("none")));
});

test("mobile closed drawer remains inert/hidden without inheriting desktop collapsed semantics", () => {
  for (const attribute of ["inert", "aria-hidden"]) {
    const expression = source.match(new RegExp(`${attribute}=\\{([^}\\n]+)\\}`))?.[1];
    assert.ok(expression);
    const evaluate = new Function("mobile", "menuAbierto", `return (${expression});`);
    assert.equal(evaluate(true, false), true);
    assert.equal(evaluate(true, true), undefined);
    assert.equal(evaluate(false, false), undefined);
    assert.equal(evaluate(false, true), undefined);
  }
  assert.match(source, /className="sidebar-menu-toggle"/);
  assert.match(source, /aria-expanded=\{menuAbierto\}/);
  assert.match(source, /tabIndex=\{menuAbierto \? 0 : -1\}/);
});

test("mobile focus-trap/Escape and breakpoint listeners are bounded and clean up", () => {
  assert.match(source, /window\.matchMedia\("\(max-width: 980px\)"\)/);
  assert.match(source, /media\.addEventListener\("change", update\)/);
  assert.match(source, /return \(\) => media\.removeEventListener\("change", update\)/);
  assert.match(source, /setMobile\(media\.matches\); setMenuAbierto\(false\)/);
  assert.match(source, /if \(!mobile \|\| !menuAbierto\) return/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?setMenuAbierto\(false\);[\s\S]*?menuToggle\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /!element\.disabled && element\.tabIndex >= 0 && element\.getClientRects\(\)\.length > 0/);
  assert.match(source, /event\.shiftKey && document\.activeElement === first/);
  assert.match(source, /!event\.shiftKey && document\.activeElement === last/);
  assert.match(source, /window\.addEventListener\("keydown", cerrarConEscape\)/);
  assert.match(source, /return \(\) => window\.removeEventListener\("keydown", cerrarConEscape\)/);
  assert.match(source, /\}, \[mobile, menuAbierto\]\)/);
  assert.match(source, /setMenuAbierto\(false\);\s*\}, \[path\]\)/);
});

test("collapse never filters navigation destinations or expands employee permissions", () => {
  assert.match(source, /getNavigationGroups\(sesion\?\.usuario\?\.rol\)/);
  const shared = ["/inicio", "/calendario", "/workspace/tareas", "/producciones", "/clientes", "/lista", "/feedback", "/reportes-historias", "/perfil"].sort();
  for (const role of ["diseno", "edicion", "produccion", "community", "programacion"]) {
    const links = getNavigationGroups(role).flatMap(group => group.links);
    assert.deepEqual(links.map(link => link.href).sort(), shared);
    assert.equal(links.some(link => ["/instagram", "/sueldos", "/empleados", "/clientes?gestion=1"].includes(link.href)), false);
  }
  const admin = getNavigationGroups("admin").flatMap(group => group.links);
  assert.deepEqual(admin.map(link => link.href).sort(), [...shared, "/instagram", "/sueldos", "/empleados", "/clientes?gestion=1"].sort());
  assert.equal(getNavigationGroups("admin").find(group => group.id === "account").links.find(link => link.href === "/clientes?gestion=1")?.label, "Gestionar clientes");
  assert.equal(isNavigationActive("/feedback", "/bloc-notas"), true);
  assert.equal(isNavigationActive("/planificacion-historias", "/calendario-estructura"), true);
  assert.equal(isNavigationActive("/calendario", "/calendario-estructura"), false);
});
