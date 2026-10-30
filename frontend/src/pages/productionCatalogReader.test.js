import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionCatalogReader } from './productionCatalogReader.js';

test('reference lists reuse successful reads for 15s, then renew or explicitly clear', async () => {
  let time = 0, calls = 0;
  const reader = createProductionCatalogReader({ now: () => time });
  const request = async () => [{ id: ++calls }];
  assert.deepEqual(await reader.read(request, '/api/clientes'), [{ id: 1 }]);
  time = 14999;
  assert.deepEqual(await reader.read(request, '/api/clientes'), [{ id: 1 }]);
  assert.equal(calls, 1);
  time = 15000;
  assert.deepEqual(await reader.read(request, '/api/clientes'), [{ id: 2 }]);
  reader.clear();
  assert.deepEqual(await reader.read(request, '/api/clientes'), [{ id: 3 }]);
});
test('errors, invalid lists and aborted reads cannot populate the reference cache', async () => {
  const reader = createProductionCatalogReader();
  await assert.rejects(reader.read(async () => { throw Error('offline'); }, '/api/usuarios'));
  await reader.read(async () => ({}), '/api/usuarios');
  await reader.read(async () => [{ id: 1 }], '/api/usuarios', { signal: { aborted: true } });
  assert.deepEqual(await reader.read(async () => [{ id: 2 }], '/api/usuarios'), [{ id: 2 }]);
});
test('screen-owned readers never share lists between sessions', async () => {
  const a = createProductionCatalogReader(), b = createProductionCatalogReader();
  await a.read(async () => [{ id: 1 }], '/api/usuarios');
  assert.deepEqual(await b.read(async () => [{ id: 2 }], '/api/usuarios'), [{ id: 2 }]);
});
