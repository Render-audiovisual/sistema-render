import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
function harness(tasks, allowNavigation = true) {
  const selected = [], incorporated = [], errors = [], requests = [];
  const tasksLatestRef = {current:tasks}, openRequestRef = {current:null};
  const window = {location:{href:'http://localhost/workspace/tareas?view=board&cliente=2'},history:{
    state:null, pushState(state,_title,url) {this.state=state;window.location.href=String(url);},
    replaceState(state,_title,url) {this.state=state;window.location.href=String(url);},back() {},
  }};
  const apiTaskById = (id,options) => new Promise((resolve,reject) => requests.push({id,options,resolve,reject}));
  const callbacks = source.slice(source.indexOf('  const openTask = useCallback'),source.indexOf('  useEffect(() => {\n    const onPop'));
  const {openTask,closeTask} = new Function('useCallback','tasksLatestRef','openRequestRef','setSelectedId',
    'apiTaskById','incorporateRelatedTasks','onError','window','requestAppNavigation',`${callbacks};return {openTask,closeTask};`)
  (fn=>fn,tasksLatestRef,openRequestRef,id=>selected.push(id),apiTaskById,items=>incorporated.push(items),message=>errors.push(message),window,()=>allowNavigation);
  return {openTask,closeTask,tasksLatestRef,requests,selected,incorporated,errors,window};
}

test('una tarea cargada abre antes de la red y conserva filtros en el enlace', async () => {
  const task = {id:1,titulo:'Reel 1'};
  const h = harness([task]);
  const pending = h.openTask(1);
  assert.deepEqual(h.selected,[1]);
  assert.equal(new URL(h.window.location.href).searchParams.get('cliente'),'2');
  h.requests[0].resolve({...task,titulo:'Actualizado'});
  await pending;
  assert.equal(h.incorporated[0][0].titulo,'Actualizado');
});

test('cerrar cancela la consulta y una respuesta tardía no reabre la tarea', async () => {
  const h = harness([{id:1}]);
  const pending = h.openTask(1);
  h.closeTask();
  assert.deepEqual(h.selected,[1,null]);
  assert.equal(h.requests[0].options.signal.aborted,true);
  h.requests[0].resolve({id:1});
  await pending;
  assert.deepEqual(h.incorporated,[]); assert.deepEqual(h.errors,[]);
});

test('cambiar rápidamente de tarea ignora la respuesta anterior', async () => {
  const h = harness([{id:1},{id:2}]);
  const first = h.openTask(1), second = h.openTask(2);
  assert.equal(h.requests[0].options.signal.aborted,true);
  h.requests[1].resolve({id:2,titulo:'Segunda'}); await second;
  h.requests[0].resolve({id:1,titulo:'Primera tardía'}); await first;
  assert.deepEqual(h.selected,[1,2]);
  assert.deepEqual(h.incorporated,[[{id:2,titulo:'Segunda'}]]);
});

test('actualizar en segundo plano no pisa una edición optimista', async () => {
  const h = harness([{id:1,titulo:'Original'}]);
  const pending = h.openTask(1);
  h.tasksLatestRef.current = [{id:1,titulo:'Editado localmente'}];
  h.requests[0].resolve({id:1,titulo:'Original'}); await pending;
  assert.deepEqual(h.incorporated,[]);
});

test('sin caché espera datos reales y un fallo no abre un detalle inexistente', async () => {
  const h = harness([]);
  const pending = h.openTask(1); assert.deepEqual(h.selected,[]);
  h.requests[0].reject(new Error('No disponible')); await pending;
  assert.deepEqual(h.selected,[]); assert.deepEqual(h.errors,['No disponible']);
});

test('cancelar cambio de tarea conserva selección y URL sin abrir ni solicitar otra tarea', async () => {
  const h = harness([{id:1}], false), href = h.window.location.href;
  await h.openTask(1);
  assert.deepEqual(h.selected, []); assert.deepEqual(h.requests, []);
  assert.equal(h.window.location.href, href);
});

test('el detalle conserva borradores, cancela consultas y no reenfoca con cada actualización', () => {
  assert.match(source,/const previousFocus = document.activeElement/);
  assert.match(source,/controller.signal.aborted\) setComments/);
  assert.match(source,/return \(\) => controller.abort\(\)/);
  assert.match(source,/setDraft\(current => editing \|\|/);
  assert.match(source,/if \(previousFocus\?\.isConnected\) previousFocus.focus\(\{ preventScroll: true \}\)/);
  assert.match(source,/TaskDetail key=\{selected.id\}/);
});
