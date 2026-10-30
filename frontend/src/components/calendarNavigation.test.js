import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canUseSharedCalendarRole,getNavigationGroups} from './navigation.js';

test('every supported person has one common calendar link without finance/admin access expansion',()=>{
  for(const role of ['admin','diseno','edicion','produccion','community','programacion']) {
    assert.equal(canUseSharedCalendarRole(role),true);
    const groups=getNavigationGroups(role),links=groups.flatMap(group=>group.links);
    assert.deepEqual(links.filter(link=>link.href==='/calendario').map(link=>link.label),['Calendario']);
    if(role!=='admin') for(const href of ['/sueldos','/empleados','/clientes?gestion=1']) assert.equal(links.some(link=>link.href===href),false);
  }
  for(const role of [undefined,null,'unknown','lider','Admin','franco']) {
    assert.equal(canUseSharedCalendarRole(role),false);
    assert.equal(getNavigationGroups(role).flatMap(group=>group.links).some(link=>link.href==='/calendario'),false);
  }
});
test('principal route uses the connected calendar page, not the old publication-only alias',()=>{
  const source=readFileSync(new URL('../App.jsx',import.meta.url),'utf8');
  assert.match(source,/canUseSharedCalendarRole\(sesion.usuario.rol\) \? \["\/calendario", "\/calendario-estructura"\]/);
  assert.match(source,/const CalendarPage = lazyNamed\(\(\) => import\("\.\/pages\/Calendar.jsx"\), "CalendarPage"\)/);
  const route=source.slice(source.indexOf('if (path === "/calendario")'),source.indexOf('if (path === "/reportes-historias")'));
  assert.match(route,/CalendarPage sesion=\{sesion\} onNavigate=\{navigate\}/);
  assert.doesNotMatch(route,/PublicacionesPage/);
  assert.match(source,/if \(path === "\/planificacion-publicaciones"\)/);
});
