const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function learner(){
 const data=new Map();
 let now=Date.UTC(2026,10,20),seed=8123,seq=0;
 const math=Object.create(Math);
 math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const node={style:{},dataset:{},appendChild(){},addEventListener(){},querySelector:()=>node,querySelectorAll:()=>[]};
 const ctx={
  window:{addEventListener(){}},document:{querySelector:()=>node,querySelectorAll:()=>[],createElement:()=>node,body:node},navigator:{},
  localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))},
  Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
  Math:math,setTimeout:()=>1,clearTimeout(){},console
 };
 vm.createContext(ctx);
 for(const file of ['practice-data.js','practice.js','home-support.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),ctx,{filename:file});
 const run=source=>vm.runInContext(source,ctx);
 const answer=(fid,en,ok=true)=>{
  Object.assign(ctx,{fid,en,ok,id:'v'+(++seq)});now++;
  run("(()=>{const frame=TRAVEL_BY_ID[fid],ex=basicCoreItems(frame).find(ex=>ex.en===en);travelMarkIntroduced(fid);recordPractice({it:{frame,ex,_intro:false},heard:ok?en:'wrong',ok,perfect:ok,meta:{responseMs:1200,withinThreeSeconds:true,speedEligible:true},attemptId:id,attemptGroupId:id,mode:'기본표현'});travelRecord(fid,ok);})()");
 };
 const sample=(fid,count=30)=>{
  ctx.fid=fid;ctx.drawCount=count;
  return Array.from(run('Array.from({length:drawCount},()=>travelBuildItems(1,[TRAVEL_BY_ID[fid]])[0].ex.en)'));
 };
 return {answer,sample,advance:ms=>{now+=ms;}};
}

test('review slots space recently successful sentences when an older review exists, but preserve mistakes and due reviews',()=>{
 const h=learner(),fid='travel_can_i_get',older='Can I get a receipt?',recent='Can I get some water?';
 h.answer(fid,older);h.advance(2*86400000);h.answer(fid,recent);
 assert.deepEqual(new Set(h.sample(fid)),new Set([older]));
 h.answer(fid,recent,false);
 assert.ok(h.sample(fid).includes(recent),'a just-missed structure remains eligible');
 h.answer(fid,recent);h.advance(2*86400000);
 assert.deepEqual(new Set(h.sample(fid)),new Set([older,recent]),'after elapsed time both reviews are eligible');
});

test('a different eligible content word is chosen even when the previous word came from practice of another frame',()=>{
 const h=learner(),fid='travel_do_you_have',water='Do you have water?',charger='Do you have a charger?';
 h.answer(fid,water);h.answer(fid,charger);h.advance(2*86400000);
 h.answer('travel_can_i_get','Can I get some water?');
 assert.deepEqual(new Set(h.sample(fid)),new Set([charger]));
 h.answer(fid,water,false);
 assert.ok(h.sample(fid).includes(water),'a missed structure can still be practiced with the same word');
});

test('a daily learner sees an actually due review before a recently mastered fourteen-day item',()=>{
 const h=learner(),fid='travel_can_i_get',older='Can I get a receipt?',recent='Can I get some water?';
 for(let i=0;i<3;i++)h.answer(fid,older);
 h.advance(15*86400000);
 for(let i=0;i<5;i++)h.answer(fid,recent);
 h.advance(2*86400000);
 assert.deepEqual(new Set(h.sample(fid)),new Set([older]));
 h.advance(13*86400000);
 assert.deepEqual(new Set(h.sample(fid,90)),new Set([older,recent]));
});
