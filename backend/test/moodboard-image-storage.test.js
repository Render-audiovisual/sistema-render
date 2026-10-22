import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createMoodboardImageStorage} from '../src/moodboard-image-storage.js';
const uuid='00000000-0000-4000-8000-000000000122';
async function owned(t){const root=await fs.mkdtemp('/private/tmp/render2-image122-');t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('image preparation is atomic and deterministic by account/UUID, exact retry never rewrites bytes',async t=>{
  const root=await owned(t),storage=createMoodboardImageStorage(root),image={buffer:Buffer.from('synthetic image bytes'),extension:'png'};
  const first=await storage.prepare({actorId:7,requestId:uuid,image});assert.equal(first.created,true);assert.match(first.filename,/^[a-f0-9]{64}\.png$/);
  const stat=await fs.stat(path.join(root,first.filename));
  const retry=await storage.prepare({actorId:7,requestId:uuid.toUpperCase(),image});assert.deepEqual(retry,{filename:first.filename,created:false});
  assert.equal((await fs.stat(path.join(root,first.filename))).ino,stat.ino);assert.deepEqual(await fs.readdir(root),[first.filename]);
  const peer=await storage.prepare({actorId:8,requestId:uuid,image});assert.notEqual(peer.filename,first.filename);
  await storage.remove(first.filename);await storage.remove(first.filename);assert.deepEqual(await fs.readdir(root),[peer.filename]);
});

test('conflicting bytes and symlink targets are never overwritten or followed',async t=>{
  const root=await owned(t),storage=createMoodboardImageStorage(root),image={buffer:Buffer.from('original'),extension:'jpg'};
  const first=await storage.prepare({actorId:7,requestId:uuid,image}),target=path.join(root,first.filename);
  await assert.rejects(storage.prepare({actorId:7,requestId:uuid,image:{...image,buffer:Buffer.from('different')}}),e=>e.status===409);
  assert.equal(await fs.readFile(target,'utf8'),'original');
  await fs.unlink(target);const other=path.join(root,'untouched');await fs.writeFile(other,'original');await fs.symlink(other,target);
  await assert.rejects(storage.prepare({actorId:7,requestId:uuid,image}),e=>e.status===409);assert.equal(await fs.readFile(other,'utf8'),'original');
  assert.equal((await fs.lstat(target)).isSymbolicLink(),true);assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.stage-')),false);
});

test('invalid targets/intent fail before creating files and cannot remove outside the owned directory',async t=>{
  const root=await owned(t),storage=createMoodboardImageStorage(root),image={buffer:Buffer.from('image'),extension:'png'};
  for(const patch of [{actorId:0},{actorId:'7'},{requestId:'other'},{image:{...image,extension:'svg'}},{image:{...image,buffer:Buffer.alloc(0)}}])await assert.rejects(storage.prepare({actorId:7,requestId:uuid,image,...patch}),TypeError);
  for(const value of ['../file.png','/file.png','.stage-file','abc.png\n'])await assert.rejects(storage.remove(value),TypeError);
  assert.deepEqual(await fs.readdir(root),[]);for(const value of ['/','relative',null])assert.throws(()=>createMoodboardImageStorage(value),TypeError);
});

test('concurrent exact file attempts publish one complete target without staging leftovers',async t=>{
  const root=await owned(t),storage=createMoodboardImageStorage(root),bytes=Buffer.alloc(131072,122);
  const input={actorId:7,requestId:uuid,image:{buffer:bytes,extension:'png'}};
  const first=storage.prepare(input),second=storage.prepare(input);bytes.fill(0);
  const results=await Promise.all([first,second]);
  assert.equal(new Set(results.map(value=>value.filename)).size,1);assert.equal(results.filter(value=>value.created).length,1);
  const data=await fs.readFile(path.join(root,results[0].filename));assert.equal(data.length,131072);assert.equal(data.every(value=>value===122),true);
  assert.deepEqual(await fs.readdir(root),[results[0].filename]);
});
