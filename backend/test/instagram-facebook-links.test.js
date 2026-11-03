import test from 'node:test';import assert from 'node:assert/strict';
import {validFacebookLink,readVerifiedFacebookLinks,completeVerifiedFacebookViews} from '../src/instagram-facebook-links.js';
const now=new Date('2026-11-03T23:30:00Z');
const link={version:1,active:true,verifiedBy:'visual_content',verifiedAt:'2026-11-03T23:00:00.000Z',
  igMediaId:'123',igUserId:'456',clientId:7,pageId:'789',facebookVideoId:'888',
  instagramPermalink:'https://www.instagram.com/reel/QA/',facebookPermalink:'https://www.facebook.com/reel/888/'};
const account={ig_user_id:'456',cliente_id:7,page_id:'789'};
const db=rows=>({query:async(sql,args)=>{assert.match(sql,/actor_id='render-worker'/);assert.equal(args[0],'facebook_verified_media_link_v1');return{rows:rows.map(detalles=>({detalles}))};}});
test('link is strictly account/page bound and duplicate Facebook video assignments reject both',async()=>{
 assert.equal(validFacebookLink(link,now),true);
 for(const patch of [{active:false},{verifiedBy:'caption'},{verifiedAt:'2027-01-01'},{pageId:'../me'},{facebookPermalink:'https://evil.test/888/'}])
  assert.equal(validFacebookLink({...link,...patch},now),false);
 assert.equal((await readVerifiedFacebookLinks(db([link]),account,now)).size,1);
 assert.equal((await readVerifiedFacebookLinks(db([link]),{...account,page_id:'999'},now)).size,0);
 assert.equal((await readVerifiedFacebookLinks(db([link,{...link,igMediaId:'999'}]),account,now)).size,0);
 assert.equal((await readVerifiedFacebookLinks(db([{...link,active:false},link]),account,now)).size,0);
});
test('confirmed fallback uses total plays once, retains authoritative native total and real zero',async()=>{
 const item={igMediaId:'123',tipo:'reel',permalink:link.instagramPermalink};let reads=0;
 const graph={facebookVideoViews:async(page,video)=>{reads++;assert.equal(page,'789');assert.equal(video,'888');return 1233;}};
 const raw={vistas:3567,vistas_instagram:3567,vistas_facebook:null,vistas_total:null};
 const result=await completeVerifiedFacebookViews(graph,item,raw,link);
 assert.equal(result.vistas_total,4800);assert.equal(result.vistas_facebook,1233);assert.equal(raw.vistas_total,null);
 assert.equal((await completeVerifiedFacebookViews(graph,item,{...raw,vistas_total:9000},link)).vistas_total,9000);
 await completeVerifiedFacebookViews(graph,item,{...raw,vistas_facebook:0},link);assert.equal(reads,2);
 assert.equal((await completeVerifiedFacebookViews({facebookVideoViews:async()=>0},item,raw,link)).vistas_total,3567);
 assert.equal(await completeVerifiedFacebookViews(graph,{...item,permalink:'https://www.instagram.com/reel/Other/'},raw,link),raw);
 assert.equal((await completeVerifiedFacebookViews({facebookVideoViews:async()=>null},item,raw,link)),raw);
});
