import test from 'node:test';
import assert from 'node:assert/strict';
import {reportParticipantLabel} from './production-registry-report.js';
test('a known participant retains explicit ID while an unavailable name does not repeat it',()=>{
  assert.equal(reportParticipantLabel({id:7,nombre:'Luciano'}),'Luciano · #7');
  for(const nombre of [undefined,null,'','  ','Usuario #7',' Usuario #7 '])
    assert.equal(reportParticipantLabel({id:7,nombre}),'Usuario #7');
});
test('display never resolves an identity from a name or contact metadata',()=>{
  for(const id of [undefined,null,'7',0,-1,1.5,Infinity,2147483648])
    assert.equal(reportParticipantLabel({id,nombre:'Franco',email:'private.invalid'}),'Sin identidad verificable');
  assert.equal(reportParticipantLabel(null),'Sin identidad verificable');
  const person={id:7,nombre:'Usuario #7',sueldo:999};
  assert.equal(reportParticipantLabel(person),'Usuario #7');
  assert.deepEqual(person,{id:7,nombre:'Usuario #7',sueldo:999});
});
