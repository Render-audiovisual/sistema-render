import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {installUnsavedNavigation, registerNavigationGuard} from '../shared/navigation/unsaved.js';

const source = readFileSync(new URL('./MoodboardPreview.jsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('MoodboardPreview.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function nodes(predicate) {
  const found = [];
  function walk(node) {if (predicate(node)) found.push(node); ts.forEachChild(node, walk);}
  walk(file); return found;
}
function initializer(name) {
  const found = nodes(node => ts.isVariableDeclaration(node) && node.name.getText(file) === name);
  assert.equal(found.length, 1, `One actual ${name} callback`); return found[0].initializer;
}
function evaluate(node, dependencies) {
  const js = ts.transpileModule(`const callback=(${node.getText(file)});`, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React},
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js};return callback;`)(...Object.values(dependencies));
}
function callback(name, dependencies) {return evaluate(initializer(name), dependencies);}
function prop(node, name) {
  return node.attributes.properties.find(attribute => attribute.name?.getText(file) === name)?.initializer?.expression;
}
function opening(kind) {
  if (kind === 'panel') {
    const card = nodes(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'Card')[0];
    return prop(card, 'open');
  }
  const text = kind === 'composer' ? 'Nueva referencia' : 'Editar categorías';
  const button = nodes(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button'
    && node.children.some(child => ts.isJsxText(child) && child.text.includes(text)))[0];
  assert.ok(button, `Actual ${text} button`); return prop(button.openingElement, 'onClick');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function fixture() {
  const waiting = deferred(), effects = [], ref = current => ({current});
  const originalCatalog = Object.freeze([{id: 1, nombre: 'Original', clientes: [], total_referencias: 1}]);
  const result = [{id: 1, nombre: 'Updated', clientes: [], total_referencias: 1}, {id: 2, nombre: 'New', clientes: []}];
  let live = true, runs = 0;
  const state = {composer: false, categoryEditor: false, selected: null, boards: originalCatalog};
  const d = {
    operationOwners: ref(new Set()), recoveryOwners: ref(new Set()), operationObservation: ref(Symbol('initial')),
    mounted: ref(true), initializingRef: ref(false), initialization: ref(null),
    boardObservation: ref({id: 1, generation: 1}), boardLoader: ref({cancel() {effects.push(['cancel']);}}),
    loadGeneration: ref(0), listController: ref(null), listGeneration: ref(0), catalog: ref(originalCatalog),
    locationRef: ref({selection: {boardId: 1}, error: ''}),
    sesion: {}, getSesion() {}, AbortController,
    window: {fetch() {assert.fail('No actual transport');}, location: {href: 'https://fixture.invalid/moodboards?board=1'},
      history: {state: null, replaceState() {effects.push(['history']);}}},
    createMoodboardInitialization: () => ({current: () => live && d.mounted.current, run() {runs++; return waiting.promise;}}),
    boardCatalog: value => value, resolveMoodboardBoard: () => 1,
    moodboardBoardUrl: () => '/moodboards?board=1', originCurrent: () => live && d.mounted.current,
    board: originalCatalog[0], loading: false, taskContextBlocked: false, item: {id: 7, titulo: 'Reference'},
  };
  for (const name of ['Refs', 'Categories', 'Tasks', 'ContextTask', 'Selected', 'Composer', 'CategoryEditor',
    'Status', 'Category', 'Query', 'BoardId', 'BoardEpoch', 'Loading', 'Location', 'Error', 'Initializing', 'Boards', 'OperationBusy']) {
    d[`set${name}`] = value => {
      effects.push([name, value]);
      const key = name[0].toLowerCase() + name.slice(1);
      state[key] = typeof value === 'function' ? value(state[key]) : value;
    };
  }
  d.activateBoard = callback('activateBoard', d);
  d.applyLocation = callback('applyLocation', d);
  const prepare = callback('prepareBoards', d), onBusy = callback('onOperationBusy', d);
  return {d, state, effects, waiting, result, originalCatalog, prepare, onBusy,
    get runs() {return runs;}, retire() {live = false;},
    open(kind) {evaluate(opening(kind), d)();},
    publicationEffects() {return effects.filter(([name]) => ['Boards', 'Refs', 'Categories', 'Tasks', 'ContextTask',
      'Selected', 'Composer', 'CategoryEditor', 'BoardId', 'BoardEpoch', 'history', 'cancel'].includes(name));},
  };
}

test('clean unchanged initialization publishes once through actual applyLocation/activateBoard; synchronous duplicate is ignored', async () => {
  const f = fixture(), pending = f.prepare();
  await f.prepare(); assert.equal(f.runs, 1);
  f.waiting.resolve(f.result); await pending;
  assert.strictEqual(f.d.catalog.current, f.result); assert.strictEqual(f.state.boards, f.result);
  assert.equal(f.d.boardObservation.current.generation, 2);
  assert.equal(f.effects.filter(([name]) => name === 'Boards').length, 1);
  assert.equal(f.d.initializingRef.current, false);
});

for (const kind of ['composer', 'category', 'panel']) {
  test(`delayed initialization cannot reset an actually opened pristine ${kind}`, async () => {
    const f = fixture(), origin = f.d.boardObservation.current, pending = f.prepare();
    f.open(kind);
    const opened = {...f.state}; f.effects.length = 0;
    f.waiting.resolve(f.result); await pending;
    assert.deepEqual(f.publicationEffects(), [], 'No catalog publication, remount, overlay close or navigation');
    assert.strictEqual(f.d.catalog.current, f.originalCatalog);
    assert.strictEqual(f.d.boardObservation.current, origin);
    assert.equal(f.state.composer, opened.composer);
    assert.equal(f.state.categoryEditor, opened.categoryEditor);
    assert.strictEqual(f.state.selected, opened.selected);
    assert.equal(f.d.initializingRef.current, false);
  });
  for (const phase of ['dirty', 'busy', 'settled-recovery', 'dirty-then-clean']) {
    test(`delayed initialization preserves ${kind} when actual onOperationBusy reports ${phase}`, async () => {
      const f = fixture(), origin = f.d.boardObservation.current, pending = f.prepare();
      f.open(kind); const owner = Symbol(kind), observation = f.d.operationObservation.current;
      if (phase === 'busy') f.onBusy(owner, true);
      else if (phase === 'settled-recovery') {f.onBusy(owner, true); f.onBusy(owner, false, true);}
      else {f.onBusy(owner, false, true); if (phase === 'dirty-then-clean') f.onBusy(owner, false, false);}
      assert.notStrictEqual(f.d.operationObservation.current, observation);
      const opened = {...f.state}; f.effects.length = 0;
      f.waiting.resolve(f.result); await pending;
      assert.deepEqual(f.publicationEffects(), []);
      assert.strictEqual(f.d.catalog.current, f.originalCatalog);
      assert.strictEqual(f.d.boardObservation.current, origin);
      assert.equal(f.state.composer, opened.composer); assert.equal(f.state.categoryEditor, opened.categoryEditor);
      assert.strictEqual(f.state.selected, opened.selected);
      assert.equal(f.d.operationOwners.current.has(owner), phase === 'busy');
      assert.equal(f.d.recoveryOwners.current.has(owner), ['dirty', 'settled-recovery'].includes(phase));
    });
  }
}

test('already dirty or recovering editor prevents initialization before any operation runs', async () => {
  const f = fixture(); f.onBusy(Symbol('existing-draft'), false, true); f.effects.length = 0;
  const pending = f.prepare();
  try {
    assert.equal(f.runs, 0, 'No initialization request may start over an existing draft/recovery');
    assert.deepEqual(f.publicationEffects(), []);
  } finally {f.waiting.resolve(f.result); await pending;}
});

test('late initialization failure does not replace error/context after a new editor observation', async () => {
  const f = fixture(), pending = f.prepare();
  f.open('composer'); f.onBusy(Symbol('draft'), false, true); f.effects.length = 0;
  f.waiting.reject(new Error('OLD INITIALIZATION ERROR')); await pending;
  assert.equal(f.effects.some(([name]) => name === 'Error'), false);
  assert.deepEqual(f.publicationEffects(), []);
});

test('retired initialization cannot publish catalog or clear editor state', async () => {
  const f = fixture(), pending = f.prepare(); f.retire(); f.effects.length = 0;
  f.waiting.resolve(f.result); await pending;
  assert.deepEqual(f.effects, []); assert.strictEqual(f.d.catalog.current, f.originalCatalog);
});

function composerCloseFixture(f, accept) {
  const target = new EventTarget(), win = f.d.window;
  for (const method of ['addEventListener', 'removeEventListener', 'dispatchEvent']) win[method] = target[method].bind(target);
  win.CustomEvent = class extends Event {
    constructor(type, options) {super(type, options); this.detail = options.detail;}
  };
  let prompts = 0;
  win.confirm = () => {prompts++; return accept;};
  const status = callback('moodboardNavigationStatus', {...f.d, api() {assert.fail('No transport on close');},
    createCapturedRequest: () => ({current: () => true})});
  const installation = installUnsavedNavigation(win);
  const unregister = registerNavigationGuard(win, status, {readObservation: () => f.d.operationObservation.current});
  const composer = nodes(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Composer')[0];
  let leave;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'leave') leave = node.initializer;
    ts.forEachChild(node, walk);
  }
  walk(composer); assert.ok(leave);
  const jsx = nodes(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'Composer')[0];
  const close = evaluate(prop(jsx, 'close'), f.d);
  const owner = Symbol('actual-composer-draft'); f.onBusy(owner, false, true);
  const closeCallback = evaluate(leave, {operation: {busy: false}, getModel: () => ({snapshot: {phase: 'idle'}}),
    captureCurrent: () => ({current: () => true}), CustomEvent: win.CustomEvent, window: win, close,
    setError() {assert.fail('Idle draft uses discard consent, not recovery error');}});
  return {close: closeCallback, status, get prompts() {return prompts;},
    cleanupOwner() {f.onBusy(owner, false, false);},
    dispose() {unregister(); installation.dispose();}};
}

test('actual Composer close cancellation preserves its dirty owner and pending initialization cannot discard it', async () => {
  const f = fixture(), pending = f.prepare(); f.open('composer');
  const consent = composerCloseFixture(f, false);
  try {
    consent.close(); assert.equal(consent.prompts, 1);
    assert.equal(f.state.composer, true); assert.deepEqual(consent.status(), {dirty: true, busy: false});
    f.effects.length = 0; f.waiting.resolve(f.result); await pending;
    assert.deepEqual(f.publicationEffects(), []);
    assert.equal(f.state.composer, true); assert.deepEqual(consent.status(), {dirty: true, busy: false});
    assert.strictEqual(f.d.catalog.current, f.originalCatalog);
  } finally {f.waiting.resolve(f.result); await pending; consent.dispose();}
});

test('actual approved Composer close and owner cleanup cannot revive eligibility of the older initialization', async () => {
  const f = fixture(), pending = f.prepare(); f.open('composer');
  const consent = composerCloseFixture(f, true);
  try {
    consent.close(); assert.equal(consent.prompts, 1); assert.equal(f.state.composer, false);
    consent.cleanupOwner(); assert.deepEqual(consent.status(), {dirty: false, busy: false});
    f.effects.length = 0; f.waiting.resolve(f.result); await pending;
    assert.deepEqual(f.publicationEffects(), []); assert.equal(f.state.composer, false);
    assert.strictEqual(f.d.catalog.current, f.originalCatalog);
  } finally {f.waiting.resolve(f.result); await pending; consent.dispose();}
});

test('actual board activation A to B to A cannot adopt the original delayed initialization', async () => {
  const f = fixture(), original = f.d.boardObservation.current, pending = f.prepare();
  f.d.activateBoard(2); f.d.activateBoard(1);
  const current = f.d.boardObservation.current;
  assert.equal(current.id, original.id); assert.notStrictEqual(current, original);
  assert.equal(current.generation, original.generation + 2);
  f.effects.length = 0; f.waiting.resolve(f.result); await pending;
  assert.deepEqual(f.publicationEffects(), []);
  assert.strictEqual(f.d.boardObservation.current, current);
  assert.strictEqual(f.d.catalog.current, f.originalCatalog);
});

function composerPickFixture(f, {throwOnRead = false} = {}) {
  const composer = nodes(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Composer')[0];
  const local = name => {
    let found;
    function walk(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = node.initializer;
      ts.forEachChild(node, walk);
    }
    walk(composer); assert.ok(found, `Actual Composer ${name}`); return found;
  };
  const readers = [], errors = [], payloads = [], readingStates = [], image = {value: ''};
  let current = true;
  const initial = {kind: 'image', image: '', url: '', title: '', category: 1, note: '', tags: ''};
  const d = {locked: false, operation: {busy: false}, getModel: () => ({snapshot: {phase: 'idle'}}),
    captureCurrent: () => ({current: () => current}), reader: {current: null}, imageReading: {current: false},
    draftOwner: {current: Symbol('pending-image')}, draft: {current: {...initial}}, baseline: {current: JSON.stringify(initial)},
    onBusy: f.onBusy, setError: value => errors.push(value), setReadingImage: value => readingStates.push(value),
    run: action => action({create: value => payloads.push(value)}), completed() {},
    FileReader: class {
      constructor() {readers.push(this); this.result = null;}
      abort() {this.aborted = true;}
      readAsDataURL(file) {
        assert.equal(file.type, 'image/jpeg'); this.file = file;
        if (throwOnRead) throw new Error('Synthetic read failure');
      }
    },
  };
  for (const name of ['Kind', 'Image', 'Url', 'Title', 'Category', 'Note', 'Tags']) {
    d[`set${name}`] = value => {if (name === 'Image') image.value = value;};
  }
  d.syncDraft = evaluate(local('syncDraft'), d);
  d.change = evaluate(local('change'), d);
  const pick = evaluate(local('pick'), d);
  const submit = evaluate(local('submit'), d);
  return {d, readers, errors, payloads, readingStates, image, retire() {current = false;},
    submit() {submit({preventDefault() {}});},
    pick() {pick({target: {files: [{name: 'qa-memory.jpg', type: 'image/jpeg', size: 12}]}});}};
}

test('actual Composer submit cannot send an older image while its replacement is still being read', () => {
  const own = composerPickFixture(fixture());
  own.d.change('image', 'data:image/jpeg;base64,b2xk');
  own.d.change('note', 'Keep the current note');
  own.pick(); own.submit();
  assert.deepEqual(own.payloads, [], 'No create operation may begin with stale image bytes');
  own.readers[0].result = 'data:image/jpeg;base64,bmV3'; own.readers[0].onload();
  own.submit();
  assert.equal(own.payloads.length, 1);
  assert.equal(own.payloads[0].image_data, 'data:image/jpeg;base64,bmV3');
  assert.equal(own.payloads[0].note, 'Keep the current note');
  assert.deepEqual(own.readingStates, [true, false]);
});

test('pending file blocks repeated and keyboard-style submit callbacks before any image is ready', () => {
  const own = composerPickFixture(fixture());
  own.pick(); own.submit(); own.submit();
  assert.deepEqual(own.payloads, []);
  assert.equal(own.errors.length, 2);
  assert.equal(own.d.imageReading.current, true);
});

test('superseded FileReader cannot publish bytes or unlock the current selection', () => {
  const own = composerPickFixture(fixture());
  own.pick(); const first = own.readers[0]; own.pick();
  assert.equal(first.aborted, true);
  first.result = 'data:image/jpeg;base64,b2xk'; first.onload(); first.onerror();
  assert.equal(own.image.value, '');
  assert.equal(own.d.imageReading.current, true);
  assert.deepEqual(own.readingStates, [true, true]);
  own.submit(); assert.deepEqual(own.payloads, []);
  const second = own.readers[1]; second.result = 'data:image/jpeg;base64,bmV3'; second.onload();
  assert.equal(own.d.imageReading.current, false);
  assert.deepEqual(own.readingStates, [true, true, false]);
  own.submit(); assert.equal(own.payloads[0].image_data, second.result);
});

test('failed replacement keeps the visible prior image but never submits automatically', () => {
  for (const throwOnRead of [false, true]) {
    const own = composerPickFixture(fixture(), {throwOnRead});
    own.d.change('image', 'data:image/jpeg;base64,b2xk');
    own.pick(); if (!throwOnRead) own.readers[0].onerror();
    assert.equal(own.image.value, 'data:image/jpeg;base64,b2xk');
    assert.equal(own.d.imageReading.current, false);
    assert.deepEqual(own.readingStates, [true, false]);
    assert.deepEqual(own.payloads, []);
    assert.equal(own.errors.at(-1), 'No se pudo leer la imagen.');
    own.submit(); // A separate, explicit decision about the still-visible A.
    assert.equal(own.payloads[0].image_data, own.image.value);
  }
});

test('retired board/session does not publish file data or update reading state from late callbacks', () => {
  const own = composerPickFixture(fixture());
  own.pick(); own.retire(); const reader = own.readers[0];
  reader.result = 'data:image/jpeg;base64,b2xk'; reader.onload(); reader.onerror();
  assert.equal(own.image.value, ''); assert.deepEqual(own.readingStates, [true]);
  assert.deepEqual(own.errors, []);
});

test('actual save control is disabled and labelled while reading, without locking every form field', () => {
  const composer = nodes(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Composer')[0];
  const button = nodes(node => ts.isJsxElement(node) && node.pos >= composer.pos && node.end <= composer.end
    && node.openingElement.tagName.getText(file) === 'button'
    && node.openingElement.attributes.properties.some(a => a.name?.getText(file) === 'className' && a.initializer?.text === 'primary'))[0];
  assert.ok(button);
  const label = button.children.find(ts.isJsxExpression)?.expression;
  for (const [busy, readingImage, disabled, text] of [
    [false, false, false, 'Guardar referencia'], [false, true, true, 'Leyendo imagen…'],
    [true, false, true, 'Guardando…'], [true, true, true, 'Guardando…'],
  ]) {
    assert.equal(evaluate(prop(button.openingElement, 'disabled'), {busy, readingImage}), disabled);
    assert.equal(evaluate(label, {busy, readingImage}), text);
  }
});

for (const order of ['initialize-then-pick', 'pick-then-initialize']) {
  test(`accepted JPG is already dirty while actual FileReader is pending: ${order}`, async () => {
    const f = fixture();
    // Open BEFORE initialization: opening's observation fence alone cannot
    // make this test pass. The pending accepted file must own unsaved state.
    f.open('composer');
    const own = composerPickFixture(f);
    let pending;
    if (order === 'initialize-then-pick') pending = f.prepare();
    own.pick();
    assert.equal(own.readers.length, 1); assert.equal(own.image.value, '');
    assert.equal(f.d.recoveryOwners.current.has(own.d.draftOwner.current), true);
    if (order === 'pick-then-initialize') {pending = f.prepare(); assert.equal(f.runs, 0);}
    else assert.equal(f.runs, 1);
    f.effects.length = 0;
    f.waiting.resolve(f.result); await pending;
    assert.deepEqual(f.publicationEffects(), []); assert.equal(f.state.composer, true);
    assert.strictEqual(f.d.catalog.current, f.originalCatalog);
    own.readers[0].result = 'data:image/jpeg;base64,cWE='; own.readers[0].onload();
    assert.equal(own.image.value, 'data:image/jpeg;base64,cWE=');
    assert.equal(own.d.draft.current.image, own.image.value);
    assert.equal(f.d.recoveryOwners.current.has(own.d.draftOwner.current), true);
    assert.deepEqual(own.errors, []);
  });
}

test('actual FileReader error and synchronous throw restore value-based dirty ownership, preserving other draft fields', () => {
  for (const throwOnRead of [false, true]) for (const dirtyTitle of [false, true]) {
    const f = fixture(), own = composerPickFixture(f, {throwOnRead});
    if (dirtyTitle) own.d.change('title', 'Keep this title');
    own.pick();
    if (!throwOnRead) own.readers[0].onerror();
    assert.equal(own.errors.length, 1);
    assert.equal(own.d.draft.current.title, dirtyTitle ? 'Keep this title' : '');
    assert.equal(own.image.value, '');
    assert.equal(own.d.imageReading.current, false);
    assert.deepEqual(own.readingStates, [true, false]);
    assert.equal(f.d.recoveryOwners.current.has(own.d.draftOwner.current), dirtyTitle);
  }
});

test('pending image remains dirty after actual field edit then baseline revert, until guarded read resolves', async () => {
  for (const outcome of ['load', 'error']) {
    const f = fixture(); f.open('composer');
    const own = composerPickFixture(f), pending = f.prepare();
    own.pick(); assert.equal(own.d.imageReading.current, true);
    own.d.change('title', 'Temporary title'); own.d.change('title', '');
    assert.equal(JSON.stringify(own.d.draft.current), own.d.baseline.current);
    assert.equal(own.d.imageReading.current, true);
    assert.equal(f.d.recoveryOwners.current.has(own.d.draftOwner.current), true,
      'Returning fields to baseline cannot discard the accepted image still being read');
    f.effects.length = 0; f.waiting.resolve(f.result); await pending;
    assert.deepEqual(f.publicationEffects(), []); assert.equal(f.state.composer, true);
    assert.strictEqual(f.d.catalog.current, f.originalCatalog);
    if (outcome === 'load') {
      own.readers[0].result = 'data:image/jpeg;base64,cWE='; own.readers[0].onload();
      assert.equal(own.image.value, 'data:image/jpeg;base64,cWE=');
    } else own.readers[0].onerror();
    assert.equal(own.d.imageReading.current, false);
    assert.equal(f.d.recoveryOwners.current.has(own.d.draftOwner.current), outcome === 'load');
    assert.equal(own.d.draft.current.title, '');
  }
});
