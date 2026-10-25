import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
const design = readFileSync(new URL('../design-system.css', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const root = design.slice(design.indexOf(':root {'), design.indexOf('\n}\n'));
const tokens = new Map([...root.matchAll(/(--render-[\w-]+):\s*([^;]+);/g)].map(([,key,value]) => [key,value]));
const luminance = hex => {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value,16)/255)
    .map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
};
const contrast = (a,b) => { const pair=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(pair[0]+.05)/(pair[1]+.05); };
test('shared button primitive centers its label while retaining the shared touch target',()=>{
  const declarations=[];
  postcss.parse(legacy).walkRules(rule=>{if(rule.selector==='.btn'&&rule.parent.type==='root')
    declarations.push(...rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]));});
  const effective=new Map(declarations);
  assert.equal(effective.get('display'),'inline-flex');assert.equal(effective.get('align-items'),'center');
  assert.equal(effective.get('justify-content'),'center');
  let controlHeight;
  postcss.parse(design).walkRules(rule=>{if(rule.parent.type==='root'&&rule.selector.split(',').map(value=>value.trim()).includes('.btn'))
    rule.walkDecls('min-height',node=>{controlHeight=node.value;});});
  assert.equal(controlHeight,'44px');
});
test('one shared foundation owns neutral light surfaces and system font without downloaded fonts', () => {
  assert.equal(tokens.get('--render-canvas'), '#f5f5f7');
  assert.equal(tokens.get('--render-surface'), '#ffffff');
  assert.match(tokens.get('--render-font'), /-apple-system.*BlinkMacSystemFont.*SF Pro Text.*Segoe UI/);
  assert.doesNotMatch(html, /fonts.googleapis|fonts.gstatic|Poppins/);
  assert.doesNotMatch(legacy, /Poppins|fonts.googleapis/);
  assert.doesNotMatch(design, /#b5fc00|#c4ff30|rgba\(181, 252/);
});
test('primary, secondary and muted text/focus have measured contrast against intended surfaces', () => {
  for (const [fg,bg] of [['--render-accent-ink','--render-accent'],['--render-accent-ink','--render-accent-hover'],
    ['--render-ink','--render-canvas'],['--render-ink-soft','--render-surface'],['--render-muted','--render-surface'],
    ['--render-sidebar-muted','--render-sidebar'],['--render-accent','--render-accent-soft']]) {
    assert.ok(contrast(tokens.get(fg),tokens.get(bg)) >= 4.5, `${fg} on ${bg}`);
  }
});
test('legacy aliases resolve to shared tokens rather than a competing palette', () => {
  for (const [old,current] of [['--bg','--render-surface'],['--surface','--render-surface'],['--text','--render-ink'],['--muted','--render-muted'],['--accent','--render-accent'],['--border','--render-line']])
    assert.ok(legacy.includes(`${old}: var(${current});`));
  assert.equal(tokens.get('--render-control-height'), '44px');
  assert.match(design, /prefers-reduced-motion/);
  assert.doesNotMatch(root, /zoom:|transform:|!important/);
  assert.match(legacy, /\.brand-initial \{\s+background:var\(--render-accent\);\s+border-color:var\(--render-accent-border\)/);
});
