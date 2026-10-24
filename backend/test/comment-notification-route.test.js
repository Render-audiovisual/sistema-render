import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const route = source.slice(source.indexOf('router.post("/tareas/:id/comentarios"'), source.indexOf('router.get("/piezas"'));

test('actual comment notification gate excludes replay, activity and absent internal context', () => {
  const condition = route.match(/if \((!result\.replayed[^\n]+)\) \{/)[1];
  const run = Function('result', 'contenido', 'notify', `if (${condition}) notify();`);
  for (const [replayed, notification, contenido, expected] of [
    [false, {}, 'Visible comment', 1], [true, {}, 'Visible comment', 0],
    [false, {}, '[Actividad] change', 0], [false, null, 'Visible comment', 0],
  ]) {
    let calls = 0; run({ replayed, notification }, contenido, () => calls++);
    assert.equal(calls, expected);
  }
});

test('comment route sends internal IDs to shared channel dispatcher and never serializes that context', () => {
  assert.match(route, /const \{ tarea, destinatarioIds, actorId, actor \} = result.notification/);
  assert.match(route, /notificarAsignacionSinInterrumpir\(\{\s*pool, tarea, destinatarioIds, actorId, actor,/);
  assert.match(route, /\? \{ \.\.\.comentario, creation_request_id: result.requestId \} : comentario/);
  assert.doesNotMatch(route, /\.json\(result\)|pool.query\(|actor: autor/);
});
