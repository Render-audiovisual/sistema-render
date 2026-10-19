import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorialPublicationDomainConflict } from '../src/editorial-publication-errors.js';
import { CORE_SCHEMA_COLUMNS } from '../src/startup-schema.js';

test('only named editorial domain SQL errors become bounded conflicts', () => {
  for (const code of ['23503', '23505', '23514']) {
    assert.equal(editorialPublicationDomainConflict({ code, constraint: 'editorial_publicacion_current_event_fk' }), true);
    assert.equal(editorialPublicationDomainConflict({ code, constraint: 'unrelated_financial_constraint' }), false);
  }
  for (const error of [null, {}, { code: 'XX000', constraint: 'editorial_publicacion_injected' },
    { code: '40001', constraint: 'editorial_publicacion_revision' },
    { code: '23514' }, { code: '23514', constraint: '' }]) {
    assert.equal(Boolean(editorialPublicationDomainConflict(error)), false);
  }
});

test('principal editorial confirmation routes are behind current identity and startup requires the new schema', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const auth = source.indexOf('router.use(requireAuthentication)');
  const identity = source.indexOf('router.use(requireCurrentIdentity(pool))');
  const mount = source.indexOf("router.use('/editorial-publicacion', createEditorialPublicationRouter({ express, pool }))");
  assert.ok(auth >= 0 && identity > auth && mount > identity);
  assert.equal(CORE_SCHEMA_COLUMNS.editorial_publicacion_versiones.current_event_id, 'uuid');
  assert.equal(CORE_SCHEMA_COLUMNS.editorial_publicacion_eventos.occurred_at, 'timestamp with time zone');
  assert.equal(CORE_SCHEMA_COLUMNS.historias['fecha_publicación_real'], 'timestamp with time zone');
});
