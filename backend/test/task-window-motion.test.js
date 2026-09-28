import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('window motion opens gently, closes faster and respects reduced motion', () => {
  const source = fs.readFileSync(new URL('../../frontend/src/features/render-os/useTaskWindowMotion.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replaceAll('export function', 'function');
  let reduced = false;
  const records = [];
  const window = {innerHeight:800, matchMedia: () => ({matches:reduced}), getComputedStyle: () => ({backgroundColor:'rgba(20,24,18,.32)'})};
  const animate = new Function('window', source + '; return animateTaskWindow;')(window);
  const element = {getBoundingClientRect: () => ({left:100,top:100,width:700,height:500,bottom:600}), animate: (frames, options) => { records.push({frames,options}); return {}; }};
  assert.equal(animate(element,element).length,2);
  assert.equal(records[0].options.duration,190);
  assert.equal(records[0].frames.at(-1).opacity,1);
  assert.equal(records[0].frames[0].transform,'translate3d(0, 10px, 0)');
  assert.ok(records[0].frames.every(frame => frame.clipPath === undefined));
  records.length=0;
  animate(element,element,true);
  assert.equal(records[0].options.duration,130);
  assert.equal(records[0].frames[0].transform,'translate3d(0, 0, 0)');
  assert.equal(records[0].frames.at(-1).opacity,0);
  reduced=true;
  assert.deepEqual(animate(element,element),[]);
  assert.deepEqual(animate(null,null),[]);
});

test('unsaved-change confirmation still precedes animated close', () => {
  const source=fs.readFileSync(new URL('../../frontend/src/pages/WorkspaceReadOnly.jsx',import.meta.url),'utf8');
  const close=source.slice(source.indexOf('const closeDetail ='),source.indexOf('const addComment ='));
  assert.ok(close.indexOf('window.confirm') < close.indexOf('windowMotion.close()'));
  assert.ok(close.includes('if (windowMotion.closing) return;'));
});
