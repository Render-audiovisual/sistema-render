import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalLegacyRoute} from './legacy-routes.js';
import {getNavigationGroups} from '../../components/navigation.js';
test('Feedback is retired for every role and old bookmarks redirect without loading notes',()=>{
 for(const role of ['admin','diseno','edicion','produccion','community','programacion']){
  assert.equal(getNavigationGroups(role).flatMap(g=>g.links).some(l=>l.href==='/feedback'||l.href==='/bloc-notas'),false);
 }
 for(const route of ['/feedback','/feedback?note=7&section=team','/bloc-notas'])assert.equal(canonicalLegacyRoute(route),'/inicio');
 const app=readFileSync(new URL('../../App.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(app,/FeedbackPage|import\("\.\/pages\/Feedback.jsx"\)/);
 const home=readFileSync(new URL('../../pages/QuickHome.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(home,/href:\s*"\/feedback"/);
});
