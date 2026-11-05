import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonalHome } from './personalHome.js';
const payload=()=>({version:1,user:{id:17,nombre:'Synthetic'},today:'2026-11-04',generated_at:'2026-11-04T12:00:00Z',
 summary:{open:0,overdue:0,today:0,upcoming:0,undated:0,awaiting_review:0},tasks:[],review:{scope:'personal',total:0,items:[]},
 clients:[],visits:[],activity:[],list_totals:{clients:0,visits:0,activity:0},capabilities:{projects:false},
 supervision:{today:'2026-11-04',people:[{id:8,name:'Synthetic',open:1,review:0,done:0}],priorities:[],clients:[{id:2,name:'Synthetic',total:1,done:0}]}});
test('supervision DTO is closed, leader-only and rejects invalid counts',()=>{
 const value=payload();value.supervision.people[0].private_salary=999;
 assert.equal(Object.hasOwn(parsePersonalHome(value,17,true).supervision.people[0],'private_salary'),false);
 assert.throws(()=>parsePersonalHome(value,17,false));
 value.supervision.clients[0].done=2;assert.throws(()=>parsePersonalHome(value,17,true));
});
test('statistics accepts the server feed group and rejects external destinations',()=>{
 const value=payload();value.supervision.clients[0].statsKey='grupo-1';
 assert.equal(parsePersonalHome(value,17,true).supervision.clients[0].statsKey,'grupo-1');
 value.supervision.clients[0].statsKey='https://example.invalid';
 assert.throws(()=>parsePersonalHome(value,17,true));
});
