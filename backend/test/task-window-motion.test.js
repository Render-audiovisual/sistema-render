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
  assert.equal(records[0].options.duration,120);
  assert.equal(records[0].frames.at(-1).opacity,1);
  assert.equal(records[0].frames[0].transform,'translate3d(0, 4px, 0)');
  assert.deepEqual(records[1].frames,[{opacity:0},{opacity:1}]);
  assert.ok(records[1].frames.every(frame => !('backgroundColor' in frame)));
  assert.ok(records[0].frames.every(frame => frame.clipPath === undefined));
  records.length=0;
  animate(element,element,true);
  assert.equal(records[0].options.duration,80);
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
  assert.ok(close.includes('if (windowMotion.closing || deliveryBusy) return;'));
  assert.ok(close.includes('editing || contentDirty || deliveryDirty'));
});

test('un cierre animado suspendido termina por plazo y no duplica el cierre', () => {
  const source = fs.readFileSync(new URL('../../frontend/src/features/render-os/useTaskWindowMotion.js',import.meta.url),'utf8')
    .replace(/^import .*;\n/,'').replaceAll('export function','function');
  const effects = [], timers = [], calls = [];
  const media = {matches:false,addEventListener() {},removeEventListener() {}};
  const window = {matchMedia:()=>media,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout() {}};
  const hook = new Function('window','useLayoutEffect','useRef','useState',`${source}; return useTaskWindowMotion;`)
    (window,fn=>effects.push(fn),value=>({current:value}),value=>[value,()=>{}]);
  const motion = hook(1,()=>calls.push('closed'));
  const element = {animate:()=>({finished:new Promise(()=>{}),cancel() {}})};
  motion.panelRef.current = element; motion.backdropRef.current = element;
  const cleanup = effects[0]();
  motion.close(); motion.close();
  assert.equal(timers.length,1); assert.equal(timers[0].delay,160);
  timers[0].fn(); timers[0].fn(); assert.deepEqual(calls,['closed']);
  cleanup();
});
