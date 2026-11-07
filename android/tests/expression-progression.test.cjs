const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),PROGRESS='speakingroom:expression_progress_v1';
const INITIAL=['can_i_get','can_you','can_i_we','do_you_have','where_is','how_much','pay_by_card','have_reservation','cant_find','is_there'].map(id=>'travel_'+id);
const LATER=['is_included','where_meet','what_recommend','say_again_slowly','is_this_right','can_we_change','id_like_to','can_i_leave','do_i_need_to','does_that_mean','how_do_i','how_do_i_get_to','can_i_ask'].map(id=>'travel_'+id);
const plain=value=>JSON.parse(JSON.stringify(value));
const wav=(()=>{const bytes=Buffer.alloc(684);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;})();

// Real app scripts and scoring/selection/sync functions; only native/browser I/O
// and the wall clock are simulated. No production grader or recorder is replaced.
function setup(seed={}){
 const records=new Map(Object.entries(seed)),elements=new Map(),timers=new Map(),captures=[];let now=Date.UTC(2026,10,7),sequence=0,random=8123;
 const math=Object.create(Math);math.random=()=>{random=(random*1664525+1013904223)>>>0;return random/4294967296;};
 const element=()=>({style:{},dataset:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,isConnected:true,addEventListener(){},setAttribute(){},focus(){},remove(){this.isConnected=false;},insertBefore(){},appendChild(){},showModal(){},querySelector:selector=>get(selector),querySelectorAll:()=>[],getTracks:()=>[]});
 const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const clockDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const context={window:{addEventListener(){},srNativePracticeSpeech:true,srNativePracticePlayback:true,srNativePracticeStreaming:true,srNativePracticeMicReady:true,srNativePracticeRealtime:false,srNativePracticeBackgroundPreparation:false},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},navigator:{},localStorage:{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value))},setTimeout:(fn,ms=0)=>{const id=++sequence;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),fetch:async()=>new Response('{}',{status:404}),location:{reload(){}},console,Date:clockDate,Math:math,URL,Blob,AbortController,Response,atob:value=>Buffer.from(value,'base64').toString('binary')};
 context.window.srNativeRequest=(action,data,onCaptured,onReady)=>{
  if(['streamPractice','streamPracticeFast','recordPractice'].includes(action))return new Promise(resolve=>captures.push({action,data,ready(){onReady?.();},complete(text,extra={}){onCaptured?.();resolve({text,audioBase64:wav.toString('base64'),...extra});}}));
  return Promise.resolve({});
 };
 vm.createContext(context);for(const file of ['practice-data.js','practice-ai.js','practice.js','home-support.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 const run=source=>vm.runInContext(source,context),flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
 const advance=async ms=>{const end=now+ms;await flush();for(;;){let next;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();};
 run(`function testProgressAnswer(fid,id,kind,options={}){
  const frame=TRAVEL_BY_ID[fid],it={frame,ex:basicStarterItem(frame),_intro:false,...options.it};
  const slow=kind.endsWith('slow'),ok=kind.startsWith('full'),expressionOnly=kind.startsWith('partial');
  const tapMs=slow?3100:1000,speechStartDelayMs=500,meta={timingVersion:2,tapMs,speechStartDelayMs,tapWithinThreeSeconds:!slow,speechWithinOnePointFiveSeconds:true,speedEligible:true,withinThreeSeconds:!slow,responseMs:tapMs+speechStartDelayMs,...options.meta};
  return recordPractice({it,heard:ok?it.ex.en:expressionOnly?'Can I get a towel?':'This is a towel.',ok,perfect:ok&&!slow,expressionOnly,meta,started:Date.now(),mode:'테스트',attemptGroupId:options.group||id,attemptId:id,retry:!!options.retry});
 }`);
 const answer=(fid,id,kind='full-fast',options={})=>{now++;return run(`testProgressAnswer(${JSON.stringify(fid)},${JSON.stringify(id)},${JSON.stringify(kind)},${JSON.stringify(options)})`);};
 return {run,context,records,elements,captures,get,flush,advance,answer};
}
const ids=h=>Array.from(h.run('learningAvailableFrames().map(frame=>frame.id)'));
const score=(h,fid='travel_can_i_get')=>h.run(`learningExpressionScore(${JSON.stringify(fid)})`);
function repeat(h,fid,count,kind='full-fast',prefix=kind){for(let i=0;i<count;i++)h.answer(fid,prefix+'-'+i,kind);h.run('learningProgressRefresh()');}

test('a new learner starts with exactly ten existing expressions and locked/stage-two frames cannot enter any practice pool',()=>{
 const h=setup();assert.deepEqual(ids(h).sort(),[...INITIAL].sort());assert.equal(score(h),0);
 const picked=Array.from(h.run('travelBuildItems(100).map(item=>item.frame.id)'));assert.ok(picked.every(id=>INITIAL.includes(id)));assert.equal(new Set(picked).size,10);
 const locked=h.run(`TRAVEL_FRAMES.find(frame=>!learningAvailableFrames().some(open=>open.id===frame.id)).id`);assert.deepEqual(Array.from(h.run(`travelPoolOf([${JSON.stringify(locked)}])`)),[]);assert.equal(h.run(`travelBuildItems(10,[TRAVEL_BY_ID[${JSON.stringify(locked)}]]).length`),0);
 assert.equal(h.run('travelBuildItems(100,TRAVEL_ALL_FRAMES).some(item=>TRAVEL_STAGE2_IDS.has(item.frame.id))'),false);assert.equal(h.run('travelPoolOf([...TRAVEL_STAGE2_IDS]).length'),0);
});

test('full and partial fast answers have identical expression progress despite their separate XP rewards',()=>{
 const curves=[];
 for(const kind of ['full-fast','partial-fast']){
  const h=setup(),curve=[];for(let i=0;i<4;i++){h.answer('travel_can_i_get',kind+'-'+i,kind);curve.push(score(h));assert.equal(ids(h).length,i===3?11:10);}
  curves.push(curve);assert.deepEqual(curve,[2,4,6,8]);assert.equal(h.run('practiceReward().total'),kind==='full-fast'?120:60);const progress=plain(h.run('learningProgressRefresh()'));assert.equal(progress.earned.travel_can_i_get,true);assert.equal(Object.keys(progress.earned).length,1);assert.deepEqual(Object.keys(progress.unlocked),['travel_is_included']);
  for(let i=0;i<5;i++)h.run('learningProgressRefresh()');h.answer('travel_can_i_get',kind+'-3',kind);assert.equal(score(h),8);assert.equal(ids(h).length,11,'one source expression earns one permanent unlock');
 }
 assert.deepEqual(curves[0],curves[1]);
});

test('the real native partial flow unlocks from four independent fast first attempts even when combined response exceeds three seconds',async()=>{
 const h=setup();for(let i=0;i<4;i++){
  h.run(`startDrill([{frame:TRAVEL_BY_ID.travel_can_i_get,ex:basicStarterItem(TRAVEL_BY_ID.travel_can_i_get),_intro:false}],'기본표현')`);await h.advance(2800);const pending=h.get('#autoMic').onclick();await h.flush();const capture=h.captures.at(-1);assert.ok(capture);capture.ready();await h.advance(2000);capture.complete('Can I get a towel?',{speechStartOffsetMs:1400,captureDurationMs:2000});await pending;await h.flush();
  assert.equal(h.run('autoDrill.results[0].ok'),false);assert.equal(h.run('autoDrill.results[0].xp'),15);assert.equal(score(h),(i+1)*2);assert.equal(ids(h).length,i===3?11:10);
 }
 assert.equal(h.run(`learningSentenceMastery(basicStarterItem(TRAVEL_BY_ID.travel_can_i_get).en).correct`),0);
});

test('slow expression success tops out at five while a timed wrong expression contributes zero and consumes the latest-five window',()=>{
 for(const kind of ['full-slow','partial-slow']){const h=setup();repeat(h,'travel_can_i_get',12,kind);assert.equal(score(h),5);assert.equal(ids(h).length,10);}
 const h=setup();repeat(h,'travel_can_i_get',4,'partial-fast');assert.equal(score(h),8);h.answer('travel_can_i_get','wrong-1','wrong');assert.equal(score(h),8,'the first wrong fills the fifth slot that was previously zero');h.answer('travel_can_i_get','wrong-2','wrong');assert.equal(score(h),6);assert.equal(ids(h).length,11);
});

test('intro, hints, recall, retries, typing, invalid onset and legacy timing cannot contribute or displace eligible first-voice scores',()=>{
 const h=setup();repeat(h,'travel_can_i_get',3,'partial-fast');assert.equal(score(h),6);
 const excluded=[{it:{_intro:true}},{it:{_hintUsed:true}},{it:{recall:true}},{retry:true},{meta:{typed:true}},{meta:{speedEligible:false}},{meta:{responseMs:null}},{meta:{responseMs:-1}},{meta:{tapMs:null}},{meta:{speechStartDelayMs:null}},{meta:{speechStartDelayMs:-1}},{meta:{timingVersion:1}}];
 for(let i=0;i<excluded.length;i++){h.answer('travel_can_i_get','excluded-'+i,'full-fast',excluded[i]);assert.equal(score(h),6,'excluded case '+i);assert.equal(ids(h).length,10);}
 h.answer('travel_can_i_get','fourth-real','partial-fast');assert.equal(score(h),8);assert.equal(ids(h).length,11);
});

test('only the two independent timing intervals determine fast expression progress, with inclusive boundaries',()=>{
 const cases=[{tapMs:3000,speechStartDelayMs:1500,responseMs:4500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,withinThreeSeconds:true,expected:2},{tapMs:3001,speechStartDelayMs:100,responseMs:3101,tapWithinThreeSeconds:false,speechWithinOnePointFiveSeconds:true,withinThreeSeconds:false,expected:1},{tapMs:100,speechStartDelayMs:1501,responseMs:1601,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:false,withinThreeSeconds:false,expected:1}];
 for(const {expected,...meta}of cases){const h=setup();h.answer('travel_can_i_get','boundary','partial-fast',{meta});assert.equal(score(h),expected);assert.equal(ids(h).length,10);}
});

test('falling below eight restores expression review frequency without relocking or granting the same unlock twice',()=>{
 const h=setup();repeat(h,'travel_can_i_get',4,'partial-fast');const opened=ids(h),rare=h.run(`travelWeightFor('travel_can_i_get',{})`);assert.equal(score(h),8);
 h.answer('travel_can_i_get','miss-1','wrong');h.answer('travel_can_i_get','miss-2','wrong');assert.equal(score(h),6);assert.ok(h.run(`travelWeightFor('travel_can_i_get',{})`)<rare,'lower frame cost returns the expression more often');assert.deepEqual(ids(h),opened);
 repeat(h,'travel_can_i_get',4,'partial-fast','again');assert.equal(score(h),8);assert.deepEqual(ids(h),opened);assert.equal(h.run('Object.keys(learningProgressRefresh().earned).length'),1);
});

test('the actual ten-expression sampler makes an eight-point expression rare and restores its frequency when the score falls',()=>{
 const seed=setup();repeat(seed,'travel_can_i_get',4,'partial-fast');const rare=setup(Object.fromEntries(seed.records));seed.answer('travel_can_i_get','sampling-miss-1','wrong');seed.answer('travel_can_i_get','sampling-miss-2','wrong');const recovering=setup(Object.fromEntries(seed.records));assert.equal(score(rare),8);assert.equal(score(recovering),6);
 const sample=h=>h.run(`(()=>{const pool=${JSON.stringify(INITIAL)}.map(id=>TRAVEL_BY_ID[id]),counts={};for(let i=0;i<2000;i++){const frame=travelPickFrames(1,pool)[0];counts[frame.id]=(counts[frame.id]||0)+1;}return counts;})()`),before=plain(sample(rare)),after=plain(sample(recovering));
 assert.ok(before.travel_can_i_get>0,'mastered expressions still appear occasionally');assert.ok(after.travel_can_i_get>before.travel_can_i_get*3,JSON.stringify({rare:before.travel_can_i_get,recovering:after.travel_can_i_get}));assert.ok(Object.keys(before).every(id=>INITIAL.includes(id)));assert.ok(Object.keys(after).every(id=>INITIAL.includes(id)));assert.equal(ids(rare).length,11);assert.equal(ids(recovering).length,11,'frequency recovery never removes a permanent unlock');
});

test('legacy introduced or previously studied expressions remain open without exposing hidden stage-two content, and new learners start with ten',()=>{
 const old=JSON.stringify({travel_can_i_leave:{introduced:true,seen:12,ok:8},travel_can_i_ask:{introduced:false,seen:1},travel_do_i_need_to:{introduced:false,seen:0},travel_how_long:{introduced:true,seen:20,ok:19}}),h=setup({'speakingroom:travelrepeat':old});assert.ok(ids(h).includes('travel_can_i_leave'));assert.ok(ids(h).includes('travel_can_i_ask'));assert.equal(ids(h).length,12);assert.ok(!ids(h).includes('travel_do_i_need_to'));assert.ok(!ids(h).includes('travel_how_long'));assert.equal(h.records.get('speakingroom:travelrepeat'),old);
 const other=h.run(`learningProfileCreate('새 표현 학습자')`);h.run(`learningProfileSwitch(${JSON.stringify(other)})`);assert.deepEqual(ids(h).sort(),[...INITIAL].sort());const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run('learningProfileId()'),other);assert.equal(ids(restored).length,10);restored.run(`learningProfileSwitch('legacy')`);assert.equal(ids(restored).length,12);assert.ok(ids(restored).includes('travel_can_i_leave'));
});

test('reload and sync union retain distinct earned sources idempotently while keeping progress profile-scoped',()=>{
 const a=setup(),b=setup();repeat(a,'travel_can_i_get',4,'partial-fast','device-a');repeat(b,'travel_can_you',4,'full-fast','device-b');const snapshot=plain(b.run('supportCollect()'));assert.ok(snapshot[PROGRESS]);a.context.snapshot=snapshot;a.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot);learningProgressRefresh()');assert.equal(ids(a).length,12);assert.equal(a.run('Object.keys(learningProgressRefresh().earned).length'),2);assert.deepEqual(Array.from(a.run('Object.keys(learningProgressRefresh().unlocked)')),['travel_is_included','travel_where_meet']);
 const restored=setup(Object.fromEntries(a.records));assert.equal(ids(restored).length,12);assert.equal(score(restored,'travel_can_i_get'),8);assert.equal(score(restored,'travel_can_you'),8);const other=restored.run(`learningProfileCreate('진도 없는 학습자')`);restored.run(`learningProfileSwitch(${JSON.stringify(other)})`);assert.equal(ids(restored).length,10);assert.equal(score(restored),0);restored.context.snapshot=snapshot;assert.equal(restored.run(`supportApplySnapshot(snapshot,'legacy')`),false);assert.equal(ids(restored).length,10);restored.run(`learningProfileSwitch('legacy')`);assert.equal(ids(restored).length,12);
});

test('successive earned expressions open exactly one existing expression in course order until all twenty-three are available',()=>{
 const h=setup();for(let i=0;i<LATER.length;i++){
  const before=ids(h),earned=plain(h.run('learningProgressRefresh().earned')),source=before.find(id=>!earned[id]);assert.ok(source);repeat(h,source,4,'partial-fast','course-'+i);const after=ids(h);assert.equal(after.length,before.length+1);assert.deepEqual(after.filter(id=>!before.includes(id)),[LATER[i]]);
 }
 assert.equal(ids(h).length,23);repeat(h,'travel_can_i_get',8,'full-fast','already-complete');assert.equal(ids(h).length,23);assert.equal(h.run('learningAvailableFrames().some(frame=>TRAVEL_STAGE2_IDS.has(frame.id))'),false);assert.equal(h.run('travelBuildItems(100).some(item=>TRAVEL_STAGE2_IDS.has(item.frame.id))'),false);
});

test('untrusted progression snapshots cannot unlock unknown or stage-two expressions',()=>{
 const h=setup();h.context.snapshot={[PROGRESS]:JSON.stringify({version:1,earned:{travel_how_long:true,unknown:true},unlocked:{travel_how_long:true,unknown:true},legacy:{travel_how_long:true,unknown:true}})};h.run('supportApplySnapshot(snapshot);learningProgressRefresh()');assert.deepEqual(ids(h).sort(),[...INITIAL].sort());assert.equal(h.run('travelBuildItems(100).some(item=>TRAVEL_STAGE2_IDS.has(item.frame.id))'),false);
});
