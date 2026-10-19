import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNavigationGroups, isNavigationActive } from "./navigation.js";

const employeeRoles = ["diseno", "edicion", "produccion", "community", "programacion"];
const shared = new Map([
  ["/inicio", ["Inicio"]],
  ["/workspace/tareas", ["Tareas"]],
  ["/proyectos", ["Proyectos"]],
  ["/producciones", ["Producciones"]],
  ["/clientes", ["Clientes", "Clientes y objetivos"]],
  ["/lista", ["Lista", "Mi lista"]],
  ["/moodboards", ["Moodboard", "Moodboards"]],
  ["/drive", ["Drive", "Archivos y Drive"]],
  ["/feedback", ["Feedback"]],
  ["/planificacion-historias", ["Historias"]],
  ["/planificacion-publicaciones", ["Publicaciones"]],
  ["/reportes-historias", ["Reportes"]],
  ["/perfil", ["Perfil"]],
]);
const adminOnly = new Map([
  ["/calendario", "Calendario"],
  ["/sueldos", "Finanzas"],
  ["/empleados", "Usuarios"],
]);
const linksFor = role => getNavigationGroups(role).flatMap(group => group.links);
const sortedHrefs = links => links.map(link => link.href).sort();

for (const role of ["admin", ...employeeRoles]) {
  test(`${role}: labelled groups contain all shared destinations exactly once and no invented routes`, () => {
    const groups = getNavigationGroups(role);
    assert.ok(Array.isArray(groups) && groups.length > 0);
    assert.equal(new Set(groups.map(group => group.id)).size, groups.length);
    for (const group of groups) {
      assert.equal(typeof group.id, "string"); assert.ok(group.id.trim());
      assert.equal(typeof group.label, "string"); assert.ok(group.label.trim());
      assert.ok(Array.isArray(group.links) && group.links.length > 0);
      for (const link of group.links) {
        assert.equal(typeof link.label, "string"); assert.ok(link.label.trim());
        assert.equal(typeof link.icon, "string"); assert.ok(link.icon.trim());
      }
    }
    const links = groups.flatMap(group => group.links);
    assert.equal(new Set(links.map(link => link.href)).size, links.length);
    const expected = [...shared.keys(), ...(role === "admin" ? adminOnly.keys() : [])].sort();
    assert.deepEqual(sortedHrefs(links), expected);
    for (const [href, labels] of shared) assert.ok(labels.includes(links.find(link => link.href === href)?.label), `Recognizable label for ${href}`);
    assert.deepEqual(getNavigationGroups(role), groups, "Navigation is deterministic");
  });
}

test("all supported employees share the same operational destinations, with no calendar/finance/account-management grant", () => {
  const reference = sortedHrefs(linksFor(employeeRoles[0]));
  for (const role of employeeRoles) {
    const links = linksFor(role);
    assert.deepEqual(sortedHrefs(links), reference);
    for (const href of adminOnly.keys()) assert.equal(links.some(link => link.href === href), false);
  }
});

test("only exact admin role includes Calendario, Finanzas and Usuarios", () => {
  const links = linksFor("admin");
  for (const [href, label] of adminOnly) {
    const labels = href === "/empleados" ? [label, "Usuarios y equipo"] : [label];
    assert.ok(labels.includes(links.find(link => link.href === href)?.label));
  }
  for (const role of [undefined, null, "", "unknown", "lider", "Franco", "Agustín", "Admin"]) {
    const denied = linksFor(role);
    for (const href of adminOnly.keys()) assert.equal(denied.some(link => link.href === href), false, `No admin grant for ${String(role)}`);
  }
});

test("active destination matching is exact, never prefix-based or active for every route", () => {
  const routes = [...shared.keys(), ...adminOnly.keys()];
  for (const href of routes) {
    for (const pathname of routes) assert.equal(isNavigationActive(href, pathname), href === pathname, `${href} vs ${pathname}`);
    assert.equal(isNavigationActive(href, `${href}-extra`), false);
    assert.equal(isNavigationActive(href, `${href}/unrelated`), false);
  }
  assert.equal(isNavigationActive("/clientes", "/cliente"), false);
  assert.equal(isNavigationActive("/inicio", "/"), false);
});

test("legacy notes and story-calendar paths activate only their canonical destination", () => {
  assert.equal(isNavigationActive("/feedback", "/bloc-notas"), true);
  assert.equal(isNavigationActive("/planificacion-historias", "/calendario-estructura"), true);
  for (const href of [...shared.keys(), ...adminOnly.keys()]) {
    if (href !== "/feedback") assert.equal(isNavigationActive(href, "/bloc-notas"), false);
    if (href !== "/planificacion-historias") assert.equal(isNavigationActive(href, "/calendario-estructura"), false);
  }
  assert.equal(isNavigationActive("/feedback", "/bloc-notas-extra"), false);
  assert.equal(isNavigationActive("/planificacion-historias", "/calendario-estructura-extra"), false);
});

test("Sidebar consumes the shared model and labels groups and the current real anchor accessibly", () => {
  const source = readFileSync(new URL("./Sidebar.jsx", import.meta.url), "utf8");
  assert.match(source, /getNavigationGroups/);
  assert.match(source, /isNavigationActive/);
  assert.match(source, /aria-current=\{[^\n]*["']page["']/);
  assert.match(source, /aria-(?:label|labelledby)=\{[^\n]*(?:group|grupo|seccion|section)[^\n]*\}/i);
  assert.match(source, /href=\{/);
  assert.match(source, /aria-label="Navegación principal"/);
  assert.match(source, /aria-expanded=\{/);
  assert.match(source, /aria-controls="sidebar-drawer"/);
  assert.match(source, /event\.metaKey/);
  assert.match(source, /event\.ctrlKey/);
  assert.match(source, /event\.button !== 0/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /onNavigate\(href\)/);
  assert.match(source, /removeEventListener\("keydown"/);
});

test("navigation adds no operational browser storage, fake business state or replacement destinations", () => {
  const model = readFileSync(new URL("./navigation.js", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("./Sidebar.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(model + sidebar, /\b(?:localStorage|sessionStorage)\b/);
  assert.doesNotMatch(model, /\b(?:fetch|apiRequest)\s*\(/);
  assert.doesNotMatch(model, /Math\.random\(|Date\.now\(/);
  assert.equal(linksFor("admin").some(link => ["/bloc-notas", "/calendario-estructura"].includes(link.href)), false, "Legacy aliases are active-state compatibility, not duplicate menu destinations");
});
