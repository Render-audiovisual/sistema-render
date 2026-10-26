import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';import nodemailer from 'nodemailer';
const require=createRequire(import.meta.url);
test('runtime lockfile retains the reviewed fixes, not a stale vulnerable resolution',()=>{
 const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
 const minimums={compression:[1,8,2],nodemailer:[10,2,1],'body-parser':[2,4,0],'proxy-addr':[2,0,8],qs:[6,16,0]};
 for(const [name,min]of Object.entries(minimums)){
  const v=lock.packages['node_modules/'+name]?.version;assert.match(v,/^\d+\.\d+\.\d+$/);
  const parts=v.split('.').map(Number);assert.ok(parts[0]>min[0]||parts[0]===min[0]&&(parts[1]>min[1]||parts[1]===min[1]&&parts[2]>=min[2]),name);
 }
 assert.equal(require('nodemailer/package.json').version,'10.2.1');
 assert.equal(require('compression/package.json').version,'1.8.2');
});
test('patched proxy subnet cannot treat arbitrary IPv4 clients as trusted proxies',()=>{
 const proxyaddr=require('proxy-addr'),trust=proxyaddr.compile('::ffff:10.0.0.0/8');
 assert.equal(trust('203.0.113.40',0),false);
});
test('upgraded mail library renders one exact synthetic recipient and inline content with no SMTP/provider access',async()=>{
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix',disableFileAccess:true,disableUrlAccess:true});
 const result=await transport.sendMail({from:{name:'RENDER QA',address:'sender@example.invalid'},
  to:[{name:'QA destinatario',address:'recipient@example.invalid'}],subject:'QA release mail',text:'QA inline text',html:'<p>QA inline text</p>',
  attachments:[{filename:'qa.txt',content:'QA inline attachment'}]});
 assert.deepEqual(result.envelope,{from:'sender@example.invalid',to:['recipient@example.invalid']});
 assert.ok(Buffer.isBuffer(result.message));assert.match(result.message.toString(),/Subject: QA release mail/);
 assert.match(result.message.toString(),/QA inline text/);transport.close();
});
