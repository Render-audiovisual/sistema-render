import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// DDL/source assertions only. Actual trigger execution, populated upgrade
// invariance and concurrent piece-first locking belong to guarded fixture QA.
const source = readFileSync(new URL('../migrations/064_editorial_publication_confirmation.sql', import.meta.url), 'utf8');
const sql = source.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
function table(name) {
  const found = sql.match(new RegExp(`CREATE TABLE ${name} \\(([\\s\\S]*?)\\);`));
  assert.ok(found, name); return found[1];
}
function body(name) {
  const found = sql.match(new RegExp(`CREATE FUNCTION ${name}\\([^]*?AS \\$\\$([^]*?)END \\$\\$;`));
  assert.ok(found, name); return found[1];
}

test('064 creates exactly two empty tables and trigger definitions, never rewrites historical pieces or adds columns', () => {
  assert.deepEqual([...sql.matchAll(/CREATE TABLE (\w+)/g)].map(match => match[1]),
    ['editorial_publicacion_versiones', 'editorial_publicacion_eventos']);
  const installation = sql.replace(/CREATE FUNCTION[\s\S]*?END \$\$;/g, '');
  assert.doesNotMatch(installation, /\b(?:INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP|ADD COLUMN)\b/i);
  assert.deepEqual([...installation.matchAll(/ALTER TABLE (\w+)/g)].map(match => match[1]), ['editorial_publicacion_versiones']);
  assert.doesNotMatch(sql, /gen_random_uuid|uuid_generate|CREATE EXTENSION|UPDATE (?:historias|publicaciones|tareas) SET/i);
});

test('both identity tuples require exactly one positive piece FK matching declared domain and ID', () => {
  for (const name of ['editorial_publicacion_versiones', 'editorial_publicacion_eventos']) {
    const definition = table(name);
    assert.match(definition, /dominio TEXT NOT NULL/);
    assert.match(definition, /pieza_id INTEGER NOT NULL/);
    assert.match(definition, /pieza_id > 0 AND \(\(dominio='historia' AND historia_id IS NOT NULL AND historia_id=pieza_id AND publicacion_id IS NULL\) OR \(dominio='publicacion' AND publicacion_id IS NOT NULL AND publicacion_id=pieza_id AND historia_id IS NULL\)\)/);
  }
});

test('versions start at one only on future updates; only unconfirmed piece versions cascade', () => {
  const versions = table('editorial_publicacion_versiones');
  assert.match(versions, /revision BIGINT NOT NULL CONSTRAINT editorial_publicacion_version_revision CHECK \(revision >= 1\)/);
  assert.match(versions, /PRIMARY KEY \(dominio,pieza_id\)/);
  assert.match(versions, /current_event_id UUID,/);
  assert.match(versions, /REFERENCES historias\(id\) ON DELETE CASCADE/);
  assert.match(versions, /REFERENCES publicaciones\(id\) ON DELETE CASCADE/);
  const events = table('editorial_publicacion_eventos');
  assert.match(events, /REFERENCES historias\(id\) ON DELETE RESTRICT/);
  assert.match(events, /REFERENCES publicaciones\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(events, /ON DELETE CASCADE/);
});

test('events store observed client and stable actor with restrictive history, without arbitrary content', () => {
  const events = table('editorial_publicacion_eventos');
  assert.match(events, /cliente_id INTEGER NOT NULL CONSTRAINT editorial_publicacion_evento_cliente_fk REFERENCES clientes\(id\) ON DELETE RESTRICT/);
  assert.match(events, /actor_id INTEGER NOT NULL CONSTRAINT editorial_publicacion_evento_actor_fk REFERENCES usuarios\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(events, /JSON|nombre|titulo|copy|metadata|payload|token|snapshot/i);
  assert.match(sql, /CREATE INDEX editorial_publicacion_evento_cliente_idx ON editorial_publicacion_eventos\(cliente_id\)/);
});

test('event action, manual source, expected version, hash and occurrence nullability are closed', () => {
  const events = table('editorial_publicacion_eventos');
  assert.match(events, /id UUID CONSTRAINT editorial_publicacion_evento_pk PRIMARY KEY/);
  assert.match(events, /action TEXT NOT NULL .*CHECK \(action IN \('confirmar','retirar'\)\)/);
  assert.match(events, /source TEXT NOT NULL .*CHECK \(source='manual'\)/);
  assert.match(events, /request_id UUID NOT NULL/);
  assert.ok(events.includes("length(intent_hash)=64 AND intent_hash ~ '^[0-9a-f]{64}$'"));
  assert.match(events, /expected_revision BIGINT NOT NULL .*CHECK \(expected_revision >= 0\)/);
  assert.match(events, /recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\(\)/);
  assert.match(events, /\(action='confirmar' AND occurred_at IS NOT NULL\) OR \(action='retirar' AND occurred_at IS NULL\)/);
  assert.match(events, /UNIQUE \(actor_id,request_id\)/);
});

test('current and previous references are restrictive composite same-piece FKs; self-lineage is rejected', () => {
  const events = table('editorial_publicacion_eventos');
  assert.match(events, /UNIQUE \(id,dominio,pieza_id\)/);
  assert.match(events, /FOREIGN KEY \(previous_event_id,dominio,pieza_id\) REFERENCES editorial_publicacion_eventos\(id,dominio,pieza_id\) ON UPDATE RESTRICT ON DELETE RESTRICT/);
  assert.match(events, /previous_event_id IS NULL OR previous_event_id<>id/);
  assert.match(sql, /FOREIGN KEY \(current_event_id,dominio,pieza_id\) REFERENCES editorial_publicacion_eventos\(id,dominio,pieza_id\) ON UPDATE RESTRICT ON DELETE RESTRICT/);
});

test('event UPDATE and DELETE always raise a named immutable constraint without mutating history', () => {
  const fn = body('editorial_publicacion_immutable_event');
  assert.match(fn, /ERRCODE='23514', CONSTRAINT='editorial_publicacion_evento_immutable'/);
  assert.doesNotMatch(fn, /IF |UPDATE |DELETE |INSERT |RETURN OLD|RETURN NEW/);
  assert.match(sql, /CREATE TRIGGER editorial_publicacion_evento_immutable BEFORE UPDATE OR DELETE ON editorial_publicacion_eventos FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_immutable_event\(\)/);
});

test('future piece updates increment version once using upsert and never manufacture events or actual publication', () => {
  const fn = body('editorial_publicacion_piece_version');
  assert.equal((fn.match(/INSERT INTO editorial_publicacion_versiones/g) || []).length, 1);
  assert.match(fn, /piece_domain,NEW.id,CASE WHEN piece_domain='historia' THEN NEW.id ELSE NULL END, CASE WHEN piece_domain='publicacion' THEN NEW.id ELSE NULL END,1,NULL/);
  assert.match(fn, /ON CONFLICT \(dominio,pieza_id\) DO UPDATE SET revision=editorial_publicacion_versiones.revision\+1/);
  assert.match(fn, /current_event_id=CASE WHEN invalidate THEN NULL ELSE editorial_publicacion_versiones.current_event_id END/);
  assert.doesNotMatch(fn, /INSERT INTO editorial_publicacion_eventos|UPDATE (?:historias|publicaciones|tareas)|NEW\.revision|metadata->>'revision'/);
  for (const [trigger, relation] of [['historia', 'historias'], ['publicacion', 'publicaciones']])
    assert.ok(sql.includes(`CREATE TRIGGER editorial_publicacion_${trigger}_version AFTER UPDATE ON ${relation} FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_piece_version()`));
});

test('client/type/state/actual-time/archive changes invalidate, while copy and scheduled-date updates preserve reference', () => {
  const fn = body('editorial_publicacion_piece_version');
  for (const field of ['cliente_id', 'estado', 'fecha_publicación_real'])
    assert.ok(fn.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`));
  assert.match(fn, /IF TG_TABLE_NAME='publicaciones' THEN type_changed := NEW.tipo IS DISTINCT FROM OLD.tipo/);
  assert.ok(fn.includes("NEW.metadata->'archivado_tablero' IS DISTINCT FROM OLD.metadata->'archivado_tablero'"));
  assert.doesNotMatch(fn, /NEW.copy|NEW.idea|NEW.fecha_programada|NEW.titulo/);
});

test('current attachment requires confirmation, current client/state/time and just-advanced revision, not withdrawal or stale evidence', () => {
  const fn = body('editorial_publicacion_guard_current');
  assert.match(fn, /event_row.action<>'confirmar' OR event_row.source<>'manual'/);
  assert.match(fn, /event_row.dominio IS DISTINCT FROM NEW.dominio OR event_row.pieza_id IS DISTINCT FROM NEW.pieza_id/);
  assert.match(fn, /event_row.cliente_id IS DISTINCT FROM piece_row.cliente_id/);
  assert.match(fn, /piece_row.estado IS DISTINCT FROM 'publicada' OR piece_row.actual_at IS DISTINCT FROM event_row.occurred_at/);
  assert.match(fn, /piece_row.archived='true' OR NEW.revision<>event_row.expected_revision\+1/);
  for (const relation of ['historias', 'publicaciones']) assert.ok(fn.includes(`FROM ${relation} WHERE id=NEW.pieza_id`));
  assert.ok(fn.indexOf('NEW.current_event_id IS NOT DISTINCT FROM OLD.current_event_id THEN RETURN NEW') < fn.indexOf('SELECT * INTO event_row'),
    'unrelated updates preserve existing evidence without incorrectly requiring its old revision to equal the new revision');
  assert.match(fn, /IF NEW.current_event_id IS NULL THEN RETURN NEW/);
});

test('version identity is fixed and guards never acquire reverse piece/task/goal/advisory locks', () => {
  const fn = body('editorial_publicacion_guard_current');
  assert.match(fn, /ROW\(NEW.dominio,NEW.pieza_id,NEW.historia_id,NEW.publicacion_id\) IS DISTINCT FROM ROW\(OLD.dominio,OLD.pieza_id,OLD.historia_id,OLD.publicacion_id\)/);
  assert.match(fn, /CONSTRAINT='editorial_publicacion_version_identity'/);
  assert.doesNotMatch(sql, /FOR UPDATE|FOR SHARE|pg_advisory|FROM tareas|FROM cliente_objetivo/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON editorial_publicacion_versiones FOR EACH ROW EXECUTE FUNCTION editorial_publicacion_guard_current\(\)/);
});

test('all named constraints and trigger failures use bounded editorial_publicacion prefix', () => {
  const names = [...sql.matchAll(/CONSTRAINT(?:\s*=)?\s*'?(\w+)/g)].map(match => match[1]);
  assert.ok(names.length > 20);
  assert.ok(names.every(name => name.startsWith('editorial_publicacion_') && name.length <= 63));
  assert.deepEqual([...sql.matchAll(/ERRCODE='23514', CONSTRAINT='([^']+)'/g)].map(match => match[1]), [
    'editorial_publicacion_evento_immutable', 'editorial_publicacion_version_identity',
    'editorial_publicacion_current_event', 'editorial_publicacion_current_matches_piece']);
});
