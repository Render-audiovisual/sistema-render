import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('board motion only animates state changes and honors reduced motion', () => {
  const source = fs.readFileSync(new URL('../../frontend/src/features/render-os/useTaskBoardMotion.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export function', 'function');
  const ref = { current: new Map() };
  let cleanup, x = 10, animations = 0, cancellations = 0, reduced = false;
  const media = { get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} };
  const card = { dataset: { taskId: '1' }, getBoundingClientRect: () => ({left:x, top:100, bottom:200}), animate(frames, options) {
    assert.equal(options.duration, 640);
    assert.equal(options.easing, 'cubic-bezier(.4, 0, .2, 1)');
    assert.equal(frames.length, 4);
    assert.notEqual(frames[1].clipPath, frames[0].clipPath, 'card narrows during transfer');
    assert.equal(frames.at(-1).clipPath, frames[0].clipPath, 'card unfolds at destination');
    assert.equal(frames.at(-1).transform, 'translate(0, 0) scale(1)');
    animations++; return { cancel() { cancellations++; } };
  }};
  const hook = new Function('useLayoutEffect', 'useRef', 'window', source + '; return useTaskBoardMotion;')(
    fn => { cleanup?.(); cleanup = fn(); }, () => ref,
    {scrollX:0, scrollY:0, innerWidth:1200, innerHeight:800, matchMedia:() => media, getComputedStyle:() => ({boxShadow:'none'})},
  );
  const board = {current: {querySelectorAll: () => [card]}};
  hook(board, [{id:1, estado:'pendiente'}], 'board');
  assert.equal(animations, 0, 'no page-load animation');
  x = 320;
  hook(board, [{id:1, estado:'en_proceso'}], 'board');
  assert.equal(animations, 1);
  hook(board, [{id:1, estado:'en_proceso'}], 'board');
  assert.equal(animations, 1, 'same status does not animate');
  assert.equal(cancellations, 1, 'interrupted animations are cleaned up');
  reduced = true; x = 640;
  hook(board, [{id:1, estado:'en_revision'}], 'board');
  assert.equal(animations, 1, 'reduce motion disables movement');
  x = 320;
  hook(board, [{id:1, estado:'pendiente'}], 'board', true);
  assert.equal(animations, 1, 'preview also honors the operating system motion preference');
  board.current = null;
  hook(board, [{id:1, estado:'en_revision'}], 'list');
  assert.equal(ref.current.size, 0, 'changing view clears positions');
});

test('board motion avoids layout work outside the board', () => {
  const source = fs.readFileSync(new URL('../../frontend/src/features/render-os/useTaskBoardMotion.js', import.meta.url), 'utf8');
  assert.match(source, /if \(view !== "board" \|\| !board\)/);
  assert.equal((source.match(/getBoundingClientRect\(\)/g) || []).length, 1);
});
