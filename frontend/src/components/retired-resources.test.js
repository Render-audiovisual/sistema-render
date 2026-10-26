import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getNavigationGroups} from './navigation.js';
import {canonicalLegacyRoute} from '../shared/navigation/legacy-routes.js';

test('retired resource sections have no sidebar entry for any role', () => {
  for (const role of ['admin','diseno','community','produccion','edicion','programacion',null]) {
    const links=getNavigationGroups(role).flatMap(group=>group.links);
    assert.equal(links.some(link=>['/drive','/moodboards'].includes(link.href)),false);
  }
});
test('old resource bookmarks resolve safely and preserve only valid task context', () => {
  for (const path of ['/drive','/moodboards']) {
    assert.equal(canonicalLegacyRoute(path),'/inicio');
    assert.equal(canonicalLegacyRoute(`${path}?cliente=7&task=19#detail`),'/workspace/tareas?task=19');
    assert.equal(canonicalLegacyRoute(`${path}?task=1&task=2`),'/inicio');
    assert.equal(canonicalLegacyRoute(`${path}?task=javascript:alert(1)`),'/inicio');
    assert.equal(canonicalLegacyRoute(`${path}/unknown`),null);
  }
});
test('canonical application no longer mounts retired pages or exposes moodboard shortcuts', () => {
  const app=readFileSync(new URL('../App.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(app,/import\("\.\/pages\/(?:Drive|MoodboardPreview)\.jsx"\)/);
  assert.doesNotMatch(app,/<(?:DrivePage|MoodboardPreviewPage)\b/);
  for(const path of ['../pages/QuickHome.jsx','../pages/WorkspaceReadOnly.jsx','./ClienteModals.jsx']) {
    assert.doesNotMatch(readFileSync(new URL(path,import.meta.url),'utf8'),/\/moodboards/);
  }
});
test('attachment recovery does not lead to the retired page or pretend to reconnect', () => {
  for(const path of ['../features/drive/DriveUploader.jsx','./PublicationComposer.jsx']) {
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/href="\/drive"/);
    assert.match(source,/href="https:\/\/drive\.google\.com\/" target="_blank" rel="noopener noreferrer"/);
    assert.match(source,/Buscar por nombre no confirma|buscar por nombre no confirma/);
  }
  const source=readFileSync(new URL('./PublicationComposer.jsx',import.meta.url),'utf8');
  assert.match(source,/La conexión necesita atención de administración/);
  assert.doesNotMatch(source,/Volver a conectar Drive/);
});
