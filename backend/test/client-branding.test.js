import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClientLogo,saveClientLogo} from '../src/client-branding.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
test('branding accepts bounded raster logos and explicit removal, not URLs or executable SVG',()=>{
 assert.equal(validateClientLogo(png),png);assert.equal(validateClientLogo(null),null);
 for(const value of [undefined,{},'', 'https://example.com/logo.png','data:image/svg+xml;base64,PHN2Zz4=',png.replace('image/png','image/jpeg'),'data:image/png;base64,'+'A'.repeat(280000)])assert.throws(()=>validateClientLogo(value),{status:400});
});
test('branding inserts a parameterized audit event on the caller transaction with stable client ID',async()=>{
 const calls=[];await saveClientLogo({query:async(...args)=>calls.push(args)},{id:17,nombre:'Agustín'},8,png);
 assert.match(calls[0][0],/INSERT INTO integracion_auditoria/);assert.doesNotMatch(calls[0][0],/BEGIN|COMMIT/);
 assert.equal(calls[0][1][0],'17');assert.deepEqual(JSON.parse(calls[0][1][2]),{clientId:8,logo:png});
});
