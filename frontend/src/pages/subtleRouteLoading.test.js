import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../design-system.css',import.meta.url),'utf8');
test('route loader is small, neutral and does not move content',()=>{
 const rule=css.match(/\.route-loading>span\{([^}]+)\}/)[1];
 assert.match(rule,/height:18px;width:18px/);
 assert.match(rule,/route-loading-spin 1\.4s/);
 assert.match(rule,/border-top-color:var\(--render-muted\)/);
 assert.doesNotMatch(rule,/blur|scale|translate/);
});
test('reduced motion disables route spinner rather than merely slowing it',()=>{
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.route-loading>span\{animation:none\}\}/);
});
test('headings, controls and content enter progressively including wrapped task board',()=>{
 assert.match(css,/\.ros-title-row[^\n]+render-heading-enter 420ms/);
 assert.match(css,/\.ros-controls[^\n]+65ms backwards/);
 assert.match(css,/\.ros-board[^\n]+130ms backwards/);
 assert.doesNotMatch(css,/animation:render-section-reveal/);
 const frames=css.match(/@keyframes render-content-enter\{from\{([^}]+)\}to\{([^}]+)\}\}/);
 assert.ok(frames);assert.match(frames[1],/opacity:\.12/);assert.match(frames[2],/opacity:1/);
 assert.doesNotMatch(frames[0],/transform|height|width|filter|pointer-events/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{:is\([^\n]+\.ros-board[^\n]+\)\{animation:none\}\}/);
});
