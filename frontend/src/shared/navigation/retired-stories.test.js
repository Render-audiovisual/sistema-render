import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLegacyRoute} from './legacy-routes.js';
import {getNavigationGroups} from '../../components/navigation.js';
test('retired stories are absent from all menus and old bookmarks go safely to personal home',()=>{
 for(const role of ['admin','diseno','produccion','edicion','community','programacion']){
  const links=getNavigationGroups(role).flatMap(group=>group.links);
  assert.ok(links.every(link=>!['/planificacion-historias','/calendario-estructura'].includes(link.href)));
 }
 for(const route of ['/planificacion-historias','/planificacion-historias?vista=estructura&mes=2026-10&cliente=1','/calendario-estructura'])assert.equal(canonicalLegacyRoute(route),'/inicio');
 const app=readFileSync(new URL('../../App.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(app,/<HistoriasPage|import\("\.\/pages\/Historias.jsx"\)/);
});
