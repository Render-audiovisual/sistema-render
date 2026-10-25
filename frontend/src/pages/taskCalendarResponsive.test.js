import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

const css=postcss.parse(readFileSync(new URL('./WorkspaceReadOnly.css',import.meta.url),'utf8'));
const prefix='.render-workspace ';
// Scoped source cascade only, not a browser layout/contrast/swipe proof.
function value(selector,property,width){
  let found;
  css.walkRules(rule=>{
    if(!postcss.list.comma(rule.selector).map(s=>s.trim()).includes(prefix+selector))return;
    for(let parent=rule.parent;parent&&parent!==css;parent=parent.parent){
      if(parent.type!=='atrule'||parent.name!=='media')continue;
      const max=/max-width:\s*(\d+)px/.exec(parent.params),min=/min-width:\s*(\d+)px/.exec(parent.params);
      if((max&&width>Number(max[1]))||(min&&width<Number(min[1])))return;
      assert.match(parent.params,/^(?:\(max-width:\s*\d+px\)|\(min-width:\s*\d+px\))$/,'Keep this fixture limited to simple calendar viewport queries');
    }
    rule.nodes.filter(node=>node.type==='decl'&&node.prop===property).forEach(node=>{found=node.value;});
  });
  return found;
}

test('mobile calendar overrides intermediate 900px minimum and keeps seven bounded columns',()=>{
  for(const width of [320,390,700]){
    for(const selector of ['.ros-calendar>header','.ros-calendar-week','.ros-calendar-grid'])assert.equal(value(selector,'min-width',width),'0');
    for(const selector of ['.ros-calendar-week','.ros-calendar-grid'])assert.equal(value(selector,'grid-template-columns',width),'repeat(7,minmax(0,1fr))');
    assert.equal(value('.ros-calendar-day','min-width',width),'0');
    assert.equal(value('.ros-calendar-day-number','width',width),'100%');
    assert.equal(value('.ros-calendar-day-number','min-width',width),'0');
    assert.ok(Number.parseInt(value('.ros-calendar-day-number','min-height',width),10)>=44);
  }
});

test('only mobile swaps inline task cards for numeric count; desktop cards and intermediate scroll contract remain',()=>{
  for(const width of [320,390,700]){
    assert.equal(value('.ros-calendar-day-tasks','display',width),'none');
    assert.equal(value('.ros-calendar-day-count','display',width),'block');
  }
  for(const width of [701,900,1280]){
    assert.equal(value('.ros-calendar-day-tasks','display',width),'grid');
    assert.equal(value('.ros-calendar-day-count','display',width),'none');
    assert.equal(value('.ros-calendar-day-number','width',width),'28px');
  }
  for(const width of [701,900])assert.equal(value('.ros-calendar-grid','min-width',width),'900px');
  assert.equal(value('.ros-calendar-grid','min-width',1280),undefined);
});
