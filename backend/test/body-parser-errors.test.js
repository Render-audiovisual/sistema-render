import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyParserErrorResponse } from '../src/body-parser-errors.js';

test('known JSON and size parser errors never project submitted bodies, messages or stack details',()=>{
  for(const [type,status] of [['entity.parse.failed',400],['entity.too.large',413]]) {
    const result=bodyParserErrorResponse({type,status,body:'QA86_PRIVATE_BODY_CANARY',message:'QA86_PRIVATE_BODY_CANARY',stack:'QA86_PRIVATE_BODY_CANARY'});
    assert.equal(result.status,status); assert.deepEqual(Object.keys(result.body),['error']);
    assert.ok(!JSON.stringify(result).includes('QA86_PRIVATE_BODY_CANARY'));
  }
});
test('unrecognized errors are not silently treated as parser client errors',()=>{
  for(const error of [null,{}, {status:400}, {type:'entity.parse.failed',status:500}, {type:'other',status:413}]) assert.equal(bodyParserErrorResponse(error),null);
});
test('principal error handler returns known parser errors before raw generic logging',()=>{
  const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const handler=source.slice(source.indexOf('app.use((err, _req, res, _next) => {'));
  assert.ok(handler.indexOf('if (parsing) return res.status(parsing.status).json(parsing.body);') < handler.indexOf('console.error(err)'));
});
