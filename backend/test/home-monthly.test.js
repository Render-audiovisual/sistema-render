import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAL_HOME_SQL } from '../src/personal-home.js';

test('monthly personal work derives from ID membership, not global admin/name/author attribution', () => {
  const monthly = PERSONAL_HOME_SQL.slice(PERSONAL_HOME_SQL.indexOf('monthly_work AS'), PERSONAL_HOME_SQL.indexOf('reviews AS'));
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
