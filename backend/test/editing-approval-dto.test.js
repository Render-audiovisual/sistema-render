import test from 'node:test';
import assert from 'node:assert/strict';
import { taskOperationalDto } from '../src/operational-dto.js';
import { assertTaskBusinessInput } from '../src/task-integration-fields.js';

const deliveryId = '10000000-0000-4000-8000-000000000001';
test('new delivery approval binding is UUID/null only for every role and never executes getters', () => {
  for (const rol of ['admin','edicion','community','diseno',undefined]) {
    for (const value of [deliveryId, null]) assert.equal(taskOperationalDto({id:1,propiedades_extra:{revision_aprobada_entrega_id:value}},{rol}).propiedades_extra.revision_aprobada_entrega_id,value);
    for (const value of [{finance:'secret'},[],true,4,'not-uuid']) assert.equal(taskOperationalDto({id:1,propiedades_extra:{revision_aprobada_entrega_id:value}},{rol}).propiedades_extra?.revision_aprobada_entrega_id,undefined);
    const props = {}; Object.defineProperty(props,'revision_aprobada_entrega_id',{enumerable:true,get(){throw new Error('must not execute');}});
    assert.equal(taskOperationalDto({id:1,propiedades_extra:props},{rol}).propiedades_extra?.revision_aprobada_entrega_id,undefined);
  }
});
test('generic creation/patch cannot supply delivery approval provenance, even with case changes', () => {
  for (const key of ['revision_aprobada_entrega_id','REVISION_APROBADA_ENTREGA_ID']) {
    assert.throws(()=>assertTaskBusinessInput({propiedades_extra:{[key]:deliveryId}}));
    assert.throws(()=>assertTaskBusinessInput({[key]:deliveryId}));
  }
  assert.doesNotThrow(()=>assertTaskBusinessInput({estado:'aprobada',expected_entrega_id:deliveryId}));
});
