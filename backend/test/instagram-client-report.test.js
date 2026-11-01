import test from 'node:test';
import assert from 'node:assert/strict';
import { readInstagramClientReport, readInstagramClientPieces, readInstagramPanel, buildPanel } from '../src/instagram-panel.js';

const period = '2020-10', auth = { id: 1, session_version: 1 };
const published = '2020-10-20T15:00:00.000Z', checked = '2020-11-01T04:00:00.000Z';
const media = (id, clientId = 1, extra = {}) => ({ ig_media_id: id, ig_user_id: clientId === 1 ? '111' : '222',
  cliente_id: clientId, periodo: period, tipo: 'reel', publicado_at: new Date(published),
  permalink: `https://www.instagram.com/reel/Public${id}/`, caption: `profile ${id}`,
  medido_at: new Date(checked), alcance: 100, vistas: 200, interacciones: 10,
  publicacion_id: 900, vinculo: 'manual', responsables_objetivo: ['PRIVATE STAFF'],
  abono_mensual: 'PRIVATE FINANCE', pieza_idea: 'PRIVATE IDEA', ...extra });
const proof = (extra = {}) => ({ version: 1, source: 'meta_graph_feed', clientId: 1, igUserId: '111',
  username: 'account_a', period, windowStart: '2020-08-03T15:00:00.000Z', checkedAt: checked,
  posts: [{ id: '11', kind: 'reel', publishedAt: published }], ...extra });

function harness({ rows = [media('11'), media('12'), media('21', 2)], snapshot = proof(), manual = [], role = 'admin', sameName = false } = {}) {
  const calls = []; let connections = 0, releases = 0, active = false;
  const clients = [{ id: 1, nombre: 'Client A', clave: 'cliente-1', logo: 'https://example.test/a.png' },
    { id: 2, nombre: sameName ? 'Client A' : 'Client B', clave: 'cliente-2', logo: 'https://example.test/b.png' }];
  const accounts = [{ ig_user_id: '111', username: 'account_a', cliente_id: 1, activa: true },
    { ig_user_id: '222', username: 'account_b', cliente_id: 2, activa: true }];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('BEGIN')) { assert.equal(active, false); active = true; return { rows: [] }; }
    assert.equal(active, true, 'all reads stay on the authorized transaction');
    if (sql === 'COMMIT' || sql === 'ROLLBACK') { active = false; return { rows: [] }; }
    if (sql.includes('FROM usuarios WHERE id=')) return { rows: [{ ...auth, rol: role, activo: true }] };
    if (sql.startsWith('SELECT c.id, c.nombre')) return { rows: clients };
    if (sql.startsWith('SELECT ig_user_id, username')) return { rows: accounts };
    if (sql.startsWith('SELECT m.ig_media_id')) return { rows }; // deliberately includes B and wrong months
    if (sql.startsWith('SELECT clave, reels')) return { rows: [{ clave: 'cliente-1', reels: 9, carruseles: 9 }] };
    if (sql.startsWith('SELECT a.ig_user_id,a.cliente_id,s.detalles')) return { rows: snapshot ? [{ ig_user_id: '111', cliente_id: 1, detalles: snapshot }] : [] };
    if (sql.startsWith('SELECT DISTINCT ON')) return { rows: manual.map(detalles => ({ detalles })) };
    if (sql.startsWith('SELECT c.id,c.nombre,c.grupo_feed_id')) return { rows: clients.map(c => ({ ...c, cuota_reels: 1, cuota_carruseles: 1 })) };
    if (sql.startsWith('SELECT p.id, p.cliente_id')) return { rows: [{ id: 999, cliente_id: 2, idea: 'PRIVATE CANDIDATE' }] };
    return { rows: [] };
  };
  return { calls, pool: { async connect() { connections++; return { query, release() { releases++; } }; } },
    connections: () => connections, releases: () => releases };
}

function assertClosed(value) {
  const forbidden = new Set(['posts', 'id', 'clientId', 'igUserId', 'cliente_id', 'ig_media_id', 'publicacion_id',
    'vinculo', 'responsables', 'responsables_objetivo', 'candidatas', 'equipo', 'pieza', 'abono_mensual', 'salario']);
  for (const [key, child] of Object.entries(value ?? {})) {
    assert.equal(forbidden.has(key), false, `private key ${key}`);
    if (child && typeof child === 'object') assertClosed(child);
  }
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
}

test('client report shares one authorized RR, isolates A from B and strips all private fields', async () => {
  const h = harness();
  const report = await readInstagramClientReport(h.pool, auth, 'cliente-1', { periodo: period });
  assert.equal(h.connections(), 1); assert.equal(h.releases(), 1);
  assert.equal(h.calls.filter(c => c.sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY').length, 1);
  assert.equal(h.calls.filter(c => c.sql === 'COMMIT').length, 1);
  assert.equal(h.calls.filter(c => c.sql.includes('FROM usuarios WHERE id=')).length, 1);
  assert.equal(report.cliente, 'Client A');
  assert.equal(report.clave, 'cliente-1');
  assert.deepEqual(report.cuentas, ['account_a']);
  assert.equal(report.piezas.length, 1); assert.equal(report.destacadas.length, 1);
  assert.equal(report.piezas[0].permalink, 'https://www.instagram.com/reel/Public11/');
  assert.deepEqual(report.format_counts, { status: 'historical', reels: 1, carruseles: 0, checkedAt: checked });
  assert.equal(report.dataFecha, checked);
  assert.deepEqual(report.cupo, { reels: 1, carruseles: 1 }, 'fresh effective quota, not stored 9/9');
  assert.equal(report.fulfillment.porcentaje, 50); assert.equal(report.fulfillment.completo, false);
  assert.equal(report.coverage.complete, true); assert.equal(report.coverage.source, 'profile_observations');
  assert.equal(report.actual.piezas, 2, 'secondary metrics remain stored observations');
  assert.equal(report.logo, 'https://example.test/a.png');
  assertClosed(report);
  assert.doesNotMatch(JSON.stringify(report), /account_b|Client B|Public21/);
  assert.equal(h.calls.some(c => /^(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/.test(c.sql)), false);
});

test('report clave is bound to the requested context even when client names are identical', async () => {
  for (const key of ['cliente-1', 'cliente-2']) {
    const report = await readInstagramClientReport(harness({ sameName: true }).pool, auth, key, { periodo: period });
    assert.equal(report.cliente, 'Client A');
    assert.equal(report.clave, key);
    assert.deepEqual(report.cuentas, [key === 'cliente-1' ? 'account_a' : 'account_b']);
    assertClosed(report);
  }
});

test('proof filters deleted items, enforces month/kind/date and cannot use B or another period proof', async () => {
  const rows = [media('11'), media('12'), media('21', 2), media('13', 1, { periodo: '2020-09' }),
    media('21', 1, { ig_user_id: '222' }),
    media('11', 1, { tipo: 'carrusel' }), media('11', 1, { publicado_at: new Date('2020-10-21T15:00:00Z') })];
  const report = await readInstagramClientReport(harness({ rows }).pool, auth, 'cliente-1', { periodo: period });
  assert.equal(report.piezas.length, 1);
  for (const snapshot of [proof({ clientId: 2 }), proof({ igUserId: '222' }), proof({ period: '2020-09', posts: [] }),
    proof({ checkedAt: 'bad' }), proof({ windowStart: '2020-10-02T00:00:00.000Z' })]) {
    const result = await readInstagramClientReport(harness({ snapshot }).pool, auth, 'cliente-1', { periodo: period });
    assert.equal(result.format_counts.status, 'unavailable');
    assert.equal(result.format_counts.reels, null);
    assert.equal(result.piezas.length, 2, 'invalid proof does not assert either deletion or zero');
    assert.equal(result.coverage.complete, false);
  }
});

test('missing coverage keeps profile observations explicit; complete empty snapshot certifies zero', async () => {
  const unknown = await readInstagramClientReport(harness({ snapshot: null }).pool, auth, 'cliente-1', { periodo: period });
  assert.equal(unknown.piezas.length, 2);
  assert.equal(unknown.format_counts.reels, null); assert.equal(unknown.format_counts.carruseles, null);
  assert.equal(unknown.coverage.complete, false); assert.equal(unknown.coverage.source, 'profile_observations');
  const zero = await readInstagramClientReport(harness({ snapshot: proof({ posts: [] }) }).pool, auth, 'cliente-1', { periodo: period });
  assert.equal(zero.piezas.length, 0); assert.equal(zero.format_counts.reels, 0);
  assert.equal(zero.actual.piezas, 2); assert.equal(zero.coverage.complete, true);
});

test('an October 29 proof cannot hide an October 30 observed post or certify its count', async () => {
  const snapshot = proof({ checkedAt: '2020-10-29T15:00:00.000Z', posts: [] });
  const rows = [media('30', 1, { publicado_at: new Date('2020-10-30T15:00:00.000Z') })];
  const result = await readInstagramClientReport(harness({ snapshot, rows }).pool, auth, 'cliente-1', { periodo: period });
  assert.equal(result.actual.piezas, 1);
  assert.equal(result.piezas.length, 1);
  assert.equal(result.piezas[0].permalink, 'https://www.instagram.com/reel/Public30/');
  assert.equal(result.format_counts.status, 'unavailable');
  assert.equal(result.format_counts.reason, 'month_incomplete');
  assert.equal(result.format_counts.reels, null);
  assert.equal(result.format_counts.carruseles, null);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.fulfillment.completo, false);
  assertClosed(result);
});

test('owner record gives Render totals but never chooses which profile videos belong to Render', async () => {
  const rows = ['11', '12', '13', '14'].map(id => media(id));
  const manual = [{ version: 1, clientId: 1, period, handle: 'account_a', checkedAt: checked,
    boundaryVerified: true, totalPosts: 4,
    posts: rows.map(r => ({ url: r.permalink, kind: 'reel', publishedAt: published })),
    boundary: ['Old1', 'Old2', 'Old3'].map(code => ({ url: `https://www.instagram.com/p/${code}/`, publishedAt: '2020-09-30T12:00:00Z' })),
    agencyAttribution: { source: 'owner_confirmation', confirmedAt: checked, reels: 3, carruseles: 0, carouselUrls: [] } }];
  const result = await readInstagramClientReport(harness({ rows, manual, snapshot: null }).pool, auth, 'cliente-1', { periodo: period });
  assert.equal(result.format_counts.status, 'owner_record'); assert.equal(result.format_counts.reels, 3);
  assert.equal(result.piezas.length, 4); assert.equal(result.coverage.source, 'profile_observations');
  assert.equal(result.coverage.render_count_known, true); assert.equal(result.coverage.complete, false);
  assert.equal(result.fulfillment.completo, false); assert.equal(result.fulfillment.porcentaje, null);
  assertClosed(result);
});

test('every exported read wrapper retains admin authorization and rejects before client reads', async () => {
  for (const read of [h => readInstagramClientReport(h.pool, auth, 'cliente-1', { periodo: period }),
    h => readInstagramClientPieces(h.pool, auth, 'cliente-1', { periodo: period }),
    h => readInstagramPanel(h.pool, auth, { periodo: period })]) {
    const h = harness({ role: 'diseno' });
    await assert.rejects(read(h), { status: 403 });
    assert.equal(h.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(h.calls.some(c => c.sql.includes('FROM clientes c')), false);
  }
  const h = harness();
  await assert.rejects(readInstagramClientReport(h.pool, auth, 'cliente-1', { periodo: period, cliente: 2 }), { status: 400 });
  assert.equal(h.connections(), 0);
  await assert.rejects(readInstagramClientReport(h.pool, auth, 'cliente-99', { periodo: period }), { status: 404 });
});

test('standalone detail uses the same feed membership rules and logo is optional without fallback', async () => {
  const h = harness();
  const detail = await readInstagramClientPieces(h.pool, auth, 'cliente-1', { periodo: period });
  assert.equal(detail.piezas.length, 1); assert.equal(detail.piezas[0].ig_media_id, '11');
  const make = clients => buildPanel({ period, clients, accounts: [], media: [], followers: [], pieces: [],
    objectives: [{ clave: 'grupo-1', reels: 1, carruseles: 1 }] }).clientes[0];
  assert.equal(make([{ id: 1, nombre: 'A', clave: 'grupo-1' }, { id: 2, nombre: 'B', clave: 'grupo-1', logo: 'second.png' }]).logo, 'second.png');
  assert.equal(make([{ id: 1, nombre: 'A', clave: 'grupo-1' }]).logo, undefined);
});
