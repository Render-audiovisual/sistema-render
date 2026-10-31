import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('actual monthly visit reader starts independent videos and photos without a serial wait',async()=>{
  const source=readFileSync(new URL('../src/production-registry.js',import.meta.url),'utf8');
  const implementation=source.slice(source.indexOf('async function readVisits('),source.indexOf('async function activeClient('));
  const read=Function('VISITS','VIDEOS','PHOTOS','visitDto',`${implementation};return readVisits;`)('visits','videos','photos',(row,videos,photos)=>({...row,videos,photos}));
  const calls=[];let finishVideos,finishPhotos;
  const db={query(sql){calls.push(sql);if(sql.startsWith('visits'))return Promise.resolve({rows:[{id:'visit'}]});return new Promise(resolve=>{if(sql.startsWith('videos'))finishVideos=resolve;else finishPhotos=resolve;});}};
  const pending=read(db,'WHERE true',[]);await Promise.resolve();
  assert.equal(calls.length,3);assert.equal(typeof finishVideos,'function');assert.equal(typeof finishPhotos,'function');
  finishPhotos({rows:[{id:'photo'}]});finishVideos({rows:[{id:'video'}]});
  assert.deepEqual(await pending,[{id:'visit',videos:[{id:'video'}],photos:[{id:'photo'}]}]);
});
