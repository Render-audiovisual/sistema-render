import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLoginDestination, loginHrefForDestination, readLoginDestination, resolveLoginDestination } from './login-destination.js';
import { getNavigationGroups, canUseSharedCalendarRole } from '../../components/navigation.js';

const user = (rol = 'edicion', changes = {}) => Object.freeze({ id: 7, usuario: 'synthetic', nombre: 'Synthetic person', rol, activo: true, ...changes });
const roles = ['admin', 'diseno', 'edicion', 'produccion', 'community', 'programacion'];

test('closed canonical paths include actual shared navigation and explicit supported aliases, not arbitrary same-origin paths', () => {
  const paths = new Set(roles.flatMap(role => getNavigationGroups(role).flatMap(group => group.links.map(link => link.href))));
  for (const route of ['/bloc-notas', '/calendario-estructura', '/sueldos', '/empleados']) paths.add(route);
  for (const route of paths) assert.equal(normalizeLoginDestination(route), route, route);
  for (const route of ['/unknown', '/api', '/api/usuarios', '/assets/logo.png', '/src/App.jsx', '/login', '/login?next=%2Finicio',
    '/design-preview', '/design-preview/comments-proposal', '/sandbox-api', '/inicio/child', '/Inicio', '/inicio/', '/ínicio', '/іnicio']) {
    assert.equal(normalizeLoginDestination(route), null, route);
  }
});

test('opaque query, fragment, task view and production day survive byte-for-byte on canonical paths', () => {
  for (const route of [
    '/workspace/tareas?task=42&view=list&estado=en_revision#detalle',
    '/producciones?day=2026-10-23&cliente=17&view=week#visita-42',
    '/inicio?production_period=2026-09&offset=20#produccion',
    '/clientes?periodo=2026-08&gestion=1#cliente-17',
    '/drive?q=%C3%A1%F0%9F%98%80&folder=a%2Fb%26next%3D%2Fsueldos#carpeta',
    '/feedback?q=a+b&literal=%252Flogin#caf%C3%A9',
    '/perfil#café',
  ]) {
    assert.equal(normalizeLoginDestination(route), route);
    const href = loginHrefForDestination(route);
    assert.equal(readLoginDestination(new URL(href, 'https://fixture.invalid').search), route);
  }
});

test('non-string, external, credentials, controls, raw spaces and backslashes never become destinations', () => {
  for (const value of [undefined, null, 0, true, {}, [], new String('/inicio'), '', ' /inicio', '/inicio ',
    'https://evil.invalid/inicio', 'http://fixture.invalid/inicio', 'https://user:pass@fixture.invalid/inicio',
    '//evil.invalid/inicio', '///inicio', 'javascript:alert(1)', 'data:text/html,/inicio',
    '/\\evil.invalid/inicio', '\\inicio', '/inicio?x=\\evil', '/inicio#\\evil',
    '/inicio\n', '/inicio\r\n', '/inicio\t', '/inicio\u0000', '/inicio\u007f', '/inicio\u0085',
    '/inicio?raw=two words', '/inicio#two words', '/inicio\u00a0', '/inicio\u2028']) {
    assert.equal(normalizeLoginDestination(value), null, 'Reject invalid destination without coercion');
  }
});

test('encoded paths and dot normalization are forbidden, while encoded query payload remains inert data', () => {
  for (const route of ['/%69nicio', '/%2569nicio', '/inicio%2f', '/%2Finicio', '/%252Finicio',
    '/inicio%3Fview=list', '/inicio%23hash', '/%2e%2e/inicio', '/foo/../inicio', '/./inicio',
    '/inicio/..', '/inicio/.', '/%5Cevil.invalid', '/%255Cevil.invalid', '/inicio;%2f..']) {
    assert.equal(normalizeLoginDestination(route), null, route);
  }
  for (const route of ['/inicio?q=%2F%2Fevil.invalid', '/inicio?q=%252F%252Fevil.invalid',
    '/inicio?q=https%3A%2F%2Fuser%3Apass%40evil.invalid', '/inicio?q=%0A%5C%2E%2E%2Flogin',
    '/inicio?next=%2Flogin%3Fnext%3D%252Fsueldos']) {
    assert.equal(normalizeLoginDestination(route), route);
    assert.equal(readLoginDestination(`?next=${encodeURIComponent(route)}`), route);
  }
});

test('raw length boundary is enforced without truncating query or fragment', () => {
  const prefix = '/inicio?q=', route = prefix + 'x'.repeat(4096 - prefix.length);
  assert.equal(route.length, 4096); assert.equal(normalizeLoginDestination(route), route);
  assert.equal(normalizeLoginDestination(`${route}x`), null);
  assert.equal(normalizeLoginDestination(`/unknown?q=${'x'.repeat(4096)}`), null);
});

test('login href encodes exactly one outer next value; query/hash injections stay inside that value', () => {
  const route = '/workspace/tareas?task=42&next=%2Fsueldos&view=list#panel&next=/empleados';
  const href = loginHrefForDestination(route), parsed = new URL(href, 'https://fixture.invalid');
  assert.equal(parsed.pathname, '/login'); assert.equal(parsed.hash, '');
  assert.deepEqual([...parsed.searchParams.keys()], ['next']);
  assert.equal(parsed.searchParams.get('next'), route); assert.equal(readLoginDestination(parsed.search), route);
  for (const value of [null, '/login', '//evil.invalid', '/api/usuarios']) assert.equal(loginHrefForDestination(value), '/login');
});

test('readLoginDestination rejects duplicate next even if identical and never decodes nested/encoded paths twice', () => {
  for (const search of ['', '?', '?other=/inicio', '?next=', '?next=/inicio&next=/inicio', '?next=/inicio&next=/sueldos',
    '?next=/inicio&%6eext=/perfil', '?next=%2Flogin%3Fnext%3D%252Finicio',
    '?next=%252Finicio', '?next=%2F%2569nicio', '?next=%2F%2Fevil.invalid', '?next=https%3A%2F%2Fevil.invalid',
    '?next=%2Finicio%0A', '?next=%2Finicio%5Cevil', '?next[]=%2Finicio']) {
    assert.equal(readLoginDestination(search), null, search);
  }
  assert.equal(readLoginDestination('?unrelated=1&next=%2Fperfil'), '/perfil');
  assert.equal(readLoginDestination('?next=%2Finicio%3Fq%3Da%252Bb'), '/inicio?q=a%2Bb');
});

test('legacy dashboards use current identity home or the single safe task context, never person scoping', () => {
  for (const alias of ['/agustin', '/franco', '/augusto', '/luciano', '/oriana', '/lider', '/german']) {
    assert.equal(normalizeLoginDestination(alias), '/inicio');
    assert.equal(normalizeLoginDestination(`${alias}?task=42&persona=someone&admin=1#old`), '/workspace/tareas?task=42');
    assert.equal(resolveLoginDestination(`${alias}?task=42`, user('edicion')), '/workspace/tareas?task=42');
    assert.equal(normalizeLoginDestination(`${alias}?task=0`), '/inicio');
    assert.equal(normalizeLoginDestination(`${alias}?task=42&task=43`), '/inicio');
  }
  for (const alias of ['/piezas', '/wilson-conversaciones']) {
    assert.equal(normalizeLoginDestination(alias), '/workspace/tareas');
    assert.equal(normalizeLoginDestination(`${alias}?task=42&responsable=Franco`), '/workspace/tareas?task=42');
  }
  assert.equal(normalizeLoginDestination('/equipo?usuario=Franco'), '/reportes-historias');
});

test('resolve defaults to personal home for unusable destinations or missing/inactive/unidentified user', () => {
  for (const value of [null, undefined, '/unknown', '//evil.invalid', '/login']) assert.equal(resolveLoginDestination(value, user()), '/inicio');
  for (const actor of [undefined, null, {}, user('admin', { id: 0 }), user('admin', { id: '7' }),
    user('admin', { id: 1.5 }), user('admin', { id: Number.MAX_SAFE_INTEGER + 1 }), user('admin', { activo: false }),
    user(null), user(''), user([])]) {
    assert.equal(resolveLoginDestination('/perfil', actor), '/inicio');
  }
  assert.equal(resolveLoginDestination('/perfil', user('edicion', { activo: undefined })), '/perfil');
});

test('roles, not IDs or personal names, gate finance, users and management destinations', () => {
  for (const rol of roles) {
    const actor = user(rol, { id: 91001, usuario: 'lider', nombre: 'Franco' });
    for (const route of ['/sueldos?periodo=2026-10#private', '/empleados?user=7'])
      assert.equal(resolveLoginDestination(route, actor), rol === 'admin' ? route : '/inicio');
    const management = '/clientes?gestion=1&periodo=2026-08#cliente-17';
    assert.equal(resolveLoginDestination(management, actor), rol === 'admin' ? management : '/clientes');
    assert.equal(resolveLoginDestination('/clientes?periodo=2026-08', actor), '/clientes?periodo=2026-08');
  }
  assert.equal(resolveLoginDestination('/sueldos', user('Admin')), '/inicio');
  assert.equal(resolveLoginDestination('/empleados', user('lider')), '/inicio');
});

test('calendar gates follow actual shared-calendar role policy while ordinary operational context is retained', () => {
  for (const rol of [...roles, 'unknown_role', 'Admin']) {
    for (const route of ['/calendario?day=2026-10-23#day', '/calendario-estructura?month=2026-10']) {
      assert.equal(resolveLoginDestination(route, user(rol)), canUseSharedCalendarRole(rol) ? route : '/inicio');
    }
  }
  for (const rol of roles) {
    assert.equal(resolveLoginDestination('/workspace/tareas?task=42&view=list#detail', user(rol)), '/workspace/tareas?task=42&view=list#detail');
    assert.equal(resolveLoginDestination('/producciones?day=2026-10-23#visit', user(rol)), '/producciones?day=2026-10-23#visit');
  }
});

test('every actual sidebar href normalizes and resolves unchanged for the role that can see it', () => {
  for (const rol of roles) {
    for (const section of getNavigationGroups(rol)) for (const { href } of section.links) {
      assert.equal(normalizeLoginDestination(href), href, `${rol}: canonical sidebar href`);
      assert.equal(resolveLoginDestination(href, user(rol)), href, `${rol}: sidebar return must remain usable`);
      assert.equal(readLoginDestination(new URL(loginHrefForDestination(href), 'https://fixture.invalid').search), href);
    }
  }
});

test('root has no return target and unknown roles cannot gain even ordinary destinations by a known ID or name', () => {
  assert.equal(normalizeLoginDestination('/'), null);
  assert.equal(loginHrefForDestination('/'), '/login'); assert.equal(readLoginDestination('?next=%2F'), null);
  assert.equal(resolveLoginDestination('/', user('admin')), '/inicio');
  for (const rol of ['unknown_role', 'Admin', 'lider', 'admin ', 'constructor']) {
    for (const route of ['/perfil', '/workspace/tareas?task=42', '/drive', '/sueldos', '/empleados'])
      assert.equal(resolveLoginDestination(route, user(rol, { id: 91001, nombre: 'Líder' })), '/inicio');
  }
});

test('raw controls decoded from outer next are rejected while percent-encoded query controls remain data', () => {
  for (const control of ['\n', '\r', '\t', '\u0000', '\u001f', '\u007f']) {
    const route = `/inicio?q=${control}`;
    assert.equal(normalizeLoginDestination(route), null);
    assert.equal(readLoginDestination(`?next=${encodeURIComponent(route)}`), null);
  }
  const route = '/inicio?q=%0A';
  assert.equal(normalizeLoginDestination(route), route);
  assert.equal(readLoginDestination(`?next=${encodeURIComponent(route)}`), route);
});

test('management query cannot evade employee downgrade by key encoding or parameter order', () => {
  for (const route of ['/clientes?gestion=0&gestion=1', '/clientes?%67estion=1&periodo=2026-10', '/clientes?gestion=1&gestion=0']) {
    assert.equal(resolveLoginDestination(route, user('edicion')), '/clientes');
    assert.equal(resolveLoginDestination(route, user('admin')), route);
  }
});
