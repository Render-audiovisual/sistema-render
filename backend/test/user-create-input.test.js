import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserCreateInput } from '../src/user-create-input.js';

const valid = { usuario: ' qa84_new ', nombre: ' Integrante de prueba ', rol: 'Diseño', password: 'Synthetic-only-2026!', email_notificaciones: ' QA84@example.invalid ' };
test('new-user contract preserves passwords exactly and normalizes labels, role and notice email', () => {
  assert.deepEqual(normalizeUserCreateInput(valid), { usuario:'qa84_new',nombre:'Integrante de prueba',rol:'diseno',password:valid.password,email_notificaciones:'qa84@example.invalid' });
  assert.equal(normalizeUserCreateInput({...valid, email_notificaciones:''}).email_notificaciones,null);
  assert.equal(normalizeUserCreateInput({...valid, rol:'Fotografía'}).rol,'fotografia');
});
test('new-user input rejects malformed fields, unknown grants and control characters', () => {
  for (const body of [null,[],{}, {...valid,activo:true}, {...valid,id:5}, {...valid,usuario:{}}, {...valid,nombre:[]},
    {...valid,rol:{}}, {...valid,email_notificaciones:{}}, {...valid,email_notificaciones:'not-an-email'}, {...valid,nombre:'a\nb'},
    {...valid,usuario:'x'.repeat(129)}, {...valid,nombre:'x'.repeat(201)}]) {
    assert.throws(()=>normalizeUserCreateInput(body),{status:400});
  }
});
test('new passwords enforce length and bcrypt UTF-8 bound without truncation or changing legacy login', () => {
  for (const password of ['name1','x'.repeat(11),'🔒'.repeat(11),'x'.repeat(73),'é'.repeat(37),' '.repeat(12),{},'valid-synthetic\0password']) {
    assert.throws(()=>normalizeUserCreateInput({...valid,password}),{status:400});
  }
  for (const password of ['x'.repeat(12),'x'.repeat(72),'é'.repeat(36),'🔒'.repeat(12),'🔒'.repeat(18),'  synthetic test  ']) {
    assert.equal(normalizeUserCreateInput({...valid,password}).password,password);
  }
});
