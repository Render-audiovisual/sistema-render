import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAL_HOME_SQL, readPersonalHome } from '../src/personal-home.js';

test('monthly personal work derives from ID membership, not global admin/name/author attribution', () => {
  const monthly = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf('monthly_work AS'), PERSONAL_HOME_SQL.indexOf('monthly_production AS'));
  assert.match(monthly, /FROM mine m CROSS JOIN day/);
  assert.doesNotMatch(monthly, /\$2|asignado_a|nombre|autor|publicaciones|historias/);
  assert.match(monthly, /COALESCE\(m.fecha_vencimiento,\(m.updated_at AT TIME ZONE 'America\/Argentina\/Cordoba'\)::date\)/);
  assert.match(monthly, /date_trunc\('month',day.today\)\+interval '1 month'/);
  assert.match(monthly, /COALESCE\(tipo_tarea,'sin_sector'\)/);
});

test('monthly aggregate counts work completion once, never pieces/videos or publication evidence', () => {
  const projection = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf("'monthly_progress'"), PERSONAL_HOME_SQL.indexOf("'tasks',COALESCE"));
  assert.match(projection, /'completed',\(SELECT count\(\*\)::int FROM monthly_work WHERE estado IN \('finalizada','publicada'\)\)/);
  assert.match(projection, /ORDER BY s.sector/);
  assert.doesNotMatch(projection, /LIMIT|escalada|importe|material|guiones|publicaciones|jsonb_agg\(to_jsonb/);
  assert.doesNotMatch(PERSONAL_HOME_SQL, /\b(?:UPDATE|INSERT|DELETE)\b/i);
});

test('production inherits monthly current-ID scope and counts tasks, never editorial pieces or visit records', () => {
  const scope = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf('monthly_production AS'), PERSONAL_HOME_SQL.indexOf('reviews AS'));
  assert.match(scope, /SELECT m.id,m.estado,m.cliente_id,m.cliente_nombre\s+FROM monthly_work m WHERE m.tipo_tarea='produccion'/);
  assert.match(scope, /FROM monthly_production GROUP BY cliente_id,cliente_nombre/);
  assert.match(scope, /count\(\*\) FILTER \(WHERE estado IN \('finalizada','publicada'\)\)::int AS completed/);
  assert.doesNotMatch(scope, /\$2|JOIN|asignado_a|colaboradores|autor|produccion_visitas|produccion_videos|historias|publicaciones|revision_aprobada|ILIKE/);
});

test('production totals and actual group count are unbounded; only deterministic client list caps at 20', () => {
  const projection = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf("'production',jsonb_build_object"), PERSONAL_HOME_SQL.indexOf("'tasks',COALESCE"));
  assert.match(projection, /'total',\(SELECT count\(\*\)::int FROM monthly_production\)/);
  assert.match(projection, /'completed',\(SELECT count\(\*\)::int FROM monthly_production WHERE estado IN \('finalizada','publicada'\)\)/);
  assert.match(projection, /'client_count',\(SELECT count\(\*\)::int FROM monthly_production_clients\)/);
  const page = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf('monthly_production_client_page AS'), PERSONAL_HOME_SQL.indexOf('reviews AS'));
  assert.match(page, /FROM monthly_production_clients\s+ORDER BY total DESC,cliente_id ASC NULLS LAST LIMIT 20/);
  assert.match(projection, /ORDER BY p.total DESC,p.cliente_id ASC NULLS LAST/);
  assert.match(projection, /FROM monthly_production_client_page p\),'\[\]'::jsonb/);
  assert.equal((PERSONAL_HOME_SQL.match(/LIMIT 20\b/g) || []).length, 1);
});

test('production uses a closed client DTO and includes the null-client group without private metadata', () => {
  const projection = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf("'production',jsonb_build_object"), PERSONAL_HOME_SQL.indexOf("'tasks',COALESCE"));
  assert.match(projection, /'client',CASE WHEN p.cliente_id IS NULL THEN NULL ELSE jsonb_build_object\('id',p.cliente_id,'nombre',p.cliente_nombre\) END/);
  assert.match(projection, /'total',p.total,'completed',p.completed/);
  const dtoProjection = projection.replace(/estado IN \('finalizada','publicada'\)/g, 'completion_predicate');
  assert.deepEqual([...new Set([...dtoProjection.matchAll(/'([a-z_]+)'\s*,/g)].map(match => match[1]))].sort(),
    ['production', 'total', 'completed', 'client_count', 'clients', 'client', 'id', 'nombre'].sort());
  assert.doesNotMatch(projection, /to_json|row_to_json|\w+\.\*|propiedades_extra|metadata|importe|abono|salario|href|fecha|WHERE p.cliente_id IS NOT NULL/);
});

test('reader preserves additive production DTO in the same current-ID readonly transaction', async () => {
  // Injected SQL result verifies reader integration only, not SQL evaluation.
  const production = { total: 30, completed: 11, client_count: 24,
    clients: [{ client: { id: 3, nombre: 'Cliente' }, total: 5, completed: 2 }, { client: null, total: 1, completed: 0 }] };
  const monthly = { period: '2026-10', total: 40, completed: 20,
    by_sector: [{ sector: 'produccion', total: 30, completed: 11 }, { sector: 'edicion', total: 10, completed: 9 }], production };
  for (const rol of ['produccion', 'admin']) {
    const calls = []; let releases = 0;
    const db = { release() { releases++; }, async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id,nombre')) return { rows: [{ id: 7, nombre: 'Current', rol, activo: true, session_version: 2 }] };
      if (sql === PERSONAL_HOME_SQL) return { rows: [{ home: { monthly_progress: monthly } }] };
      return { rows: [] };
    } };
    const home = await readPersonalHome({ connect: async () => db }, { id: 7, session_version: 2, rol: 'untrusted' });
    assert.deepEqual(home.monthly_progress, monthly);
    assert.deepEqual(calls.find(call => call.sql === PERSONAL_HOME_SQL).values, [7, rol === 'admin']);
    assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(calls.at(-1).sql, 'COMMIT'); assert.equal(releases, 1);
  }
});
