import test from 'node:test';
import assert from 'node:assert/strict';
import { insertTaskContentBlock } from './task-content-insertion.js';

test('start insertion separates final template field from original content, cursor stays before suffix delimiter', () => {
  const template = 'ENTREGABLE\nResultado esperado:\nFormato y ubicación:';
  assert.deepEqual(insertTaskContentBlock('Contenido original', template, 0, 0), {
    value: template + '\n\nContenido original', cursor: template.length,
  });
});
test('middle insertion separates both nonempty boundaries and preserves outside bytes exactly', () => {
  assert.deepEqual(insertTaskContentBlock('  Antes  Después\t', 'BLOQUE\nCampo:', 9, 9), {
    value: '  Antes  \n\nBLOQUE\nCampo:\n\nDespués\t', cursor: 9 + 2 + 'BLOQUE\nCampo:'.length,
  });
});
test('end insertion only separates prefix, and empty content adds no separators', () => {
  assert.deepEqual(insertTaskContentBlock('Anterior', 'NUEVO', 8, 8), {value:'Anterior\n\nNUEVO',cursor:15});
  assert.deepEqual(insertTaskContentBlock('', 'NUEVO', 0, 0), {value:'NUEVO',cursor:5});
});
test('selection replacement preserves literal template including bullet and exact prefix/suffix', () => {
  const input = 'Antes[selección]Después';
  assert.deepEqual(insertTaskContentBlock(input, '• ', 5, 16), {value:'Antes\n\n• \n\nDespués',cursor:9});
  assert.deepEqual(insertTaskContentBlock(input, '• ', 0, input.length), {value:'• ',cursor:2});
  assert.equal(input, 'Antes[selección]Después');
});
test('an existing newline at either side of each boundary prevents extra separators', () => {
  for (const newline of ['\n', '\r', '\r\n']) {
    const input = `Antes${newline}Después`;
    const at = 5 + newline.length;
    assert.deepEqual(insertTaskContentBlock(input, `BLOQUE${newline}`, at, at), {
      value:`Antes${newline}BLOQUE${newline}Después`,cursor:at + 6 + newline.length,
    });
    assert.deepEqual(insertTaskContentBlock('AntesDespués', `${newline}BLOQUE`, 5, 5), {
      value:`Antes${newline}BLOQUE\n\nDespués`,cursor:5 + newline.length + 6,
    });
    assert.deepEqual(insertTaskContentBlock(`${newline}Después`, 'BLOQUE', 0, 0), {
      value:`BLOQUE${newline}Después`,cursor:6,
    });
  }
});
test('CRLF, mixed newlines, tabs and spaces are not normalized or trimmed', () => {
  const current='\tA\r\n\r\nB \n C\r',template='  X\r\nY  ';
  const from=5,to=7,prefix=current.slice(0,from),suffix=current.slice(to);
  const result=insertTaskContentBlock(current,template,from,to);
  assert.equal(result.value,prefix+template+'\n\n'+suffix);
  assert.equal(result.cursor,prefix.length+template.length);
  assert.equal(result.value.slice(0,prefix.length),prefix);
  assert.equal(result.value.slice(-suffix.length),suffix);
});
test('empty template deletes only selection, without fabricating separators', () => {
  assert.deepEqual(insertTaskContentBlock('AntesDELETEDespués','',5,11),{value:'AntesDespués',cursor:5});
  assert.deepEqual(insertTaskContentBlock('Contenido','',3,3),{value:'Contenido',cursor:3});
  assert.deepEqual(insertTaskContentBlock('','',0,0),{value:'',cursor:0});
});
test('positions clamp to text length; reversed ranges collapse at start; invalid values default to zero', () => {
  assert.deepEqual(insertTaskContentBlock('ABC','X',-5,999),{value:'X',cursor:1});
  assert.deepEqual(insertTaskContentBlock('ABC','X',999,-5),{value:'ABC\n\nX',cursor:6});
  assert.deepEqual(insertTaskContentBlock('ABC','X',2,1),{value:'AB\n\nX\n\nC',cursor:5});
  for(const bad of [undefined,null,NaN,Infinity,-Infinity,1.5,'2',true,{},[]]) {
    assert.deepEqual(insertTaskContentBlock('ABC','X',bad,bad),{value:'X\n\nABC',cursor:1});
    assert.deepEqual(insertTaskContentBlock('ABC','X',2,bad),{value:'AB\n\nX\n\nC',cursor:5});
  }
});
test('UTF-16 offsets and cursor match textarea selection APIs for astral and combining characters', () => {
  const current='A😀Bé\u0301Z',template='📝\n• ';
  assert.deepEqual(insertTaskContentBlock(current,template,1,3),{
    value:'A\n\n'+template+'\n\nBé\u0301Z',cursor:1+2+template.length,
  });
  const end=insertTaskContentBlock(current,template,current.length,current.length);
  assert.equal(end.value,current+'\n\n'+template);assert.equal(end.cursor,end.value.length);
});
test('nonstring content rejects without coercion, repeated calls do not mutate returned results or inputs', () => {
  for(const value of [null,undefined,0,true,{},[]]) {
    assert.throws(()=>insertTaskContentBlock(value,'X',0,0),TypeError);
    assert.throws(()=>insertTaskContentBlock('ABC',value,0,0),TypeError);
  }
  const first=insertTaskContentBlock('ABC','X',0,0),snapshot=structuredClone(first);
  insertTaskContentBlock('ABC','Y',1,2);assert.deepEqual(first,snapshot);
});
