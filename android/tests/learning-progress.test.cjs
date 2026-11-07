const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function setup(seed={}){
 const records=new Map(Object.entries(seed)),elements=new Map();let random=8123;
 const math=Object.create(Math);math.random=()=>{random=(random*1664525+1013904223)>>>0;return random/4294967296;};
 const element=()=>({style:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,addEventListener(){},setAttribute(){},focus(){},remove(){},insertBefore(){},appendChild(){},showModal(){},querySelector:selector=>get(selector),querySelectorAll:()=>[],getTracks:()=>[]});
 const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const context={window:{addEventListener(){}},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},navigator:{},localStorage:{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value))},setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:false,status:404}),location:{reload(){}},console,Date,Math:math,URL,Blob,AbortController,Response};
 vm.createContext(context);for(const file of ['practice-data.js','practice.js','home-support.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
 vm.runInContext(`speakEn=()=>{};const testFrame={id:'learning_test',frame:'Can I get ~?',items:[]};function answer(en,id,options={}){const it=options.it||{frame:testFrame,ex:{en,ko:en},_intro:false};return recordPractice({it,heard:en,ok:true,perfect:true,meta:{responseMs:1200,speedEligible:true,withinThreeSeconds:true},started:Date.now(),mode:'테스트',attemptGroupId:id,attemptId:id,...options});}`,context);
 return {run:source=>vm.runInContext(source,context),records,context,elements};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('one first-wrong question earns zero then at most five XP across immediate retries and copied requeues',()=>{
 const h=setup();h.run(`const original={frame:testFrame,ex:{en:'Can I get water?',ko:'water'},_intro:false,_attemptGroupId:'question-1'};
  const wrong=answer(original.ex.en,'a1',{it:original,attemptGroupId:'question-1',ok:false,perfect:false});
  const retry=answer(original.ex.en,'a2',{it:{...original,recall:true},attemptGroupId:'question-1'});
  const requeue=answer(original.ex.en,'a3',{it:{...original,_requeues:1},attemptGroupId:'question-1'});
  const laterWrong=answer(original.ex.en,'a4',{it:{...original,_requeues:2},attemptGroupId:'question-1',ok:false,perfect:false});
  const again=answer(original.ex.en,'a5',{it:{...original,_requeues:2},attemptGroupId:'question-1'});`);
 assert.equal(h.run('wrong.xp'),0);assert.equal(h.run('retry.xp'),5);assert.equal(h.run('requeue.xp+again.xp+laterWrong.xp'),0);assert.equal(h.run('practiceReward().total'),5);assert.equal(h.run('supportEvents().length'),5);
});

test('verified first fast answers earn thirty XP, normal correct answers earn fifteen, and duplicates do not grow XP or mastery',()=>{
 const h=setup();h.run(`const correct=answer('Can I get water?','correct');const hint=answer('Can I get coffee?','hint',{perfect:false});const duplicate=answer('Can I get water?','correct');`);
 assert.equal(h.run('correct.xp'),30);assert.equal(h.run('hint.xp'),15);assert.equal(h.run('duplicate.duplicate'),true);assert.equal(h.run('practiceReward().total'),45);assert.equal(h.run(`learningSentenceMastery('Can I get water?').seen`),1);
 const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run(`answer('Can I get water?','correct').duplicate`),true);assert.equal(restored.run('practiceReward().total'),45);
});

test('mastery is independent of the retry XP cap, drops on mistakes and remains inside zero to one hundred',()=>{
 const h=setup();h.run(`answer('Can I get water?','w',{attemptGroupId:'group',ok:false,perfect:false});answer('Can I get water?','r1',{attemptGroupId:'group'});answer('Can I get water?','r2',{attemptGroupId:'group'});`);
 assert.equal(h.run('practiceReward().total'),5);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),8);
 h.run(`for(let i=0;i<10;i++)answer('Can I get water?','fresh-'+i);`);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),100);
 const before=h.run(`learningSentenceWeight('Can I get water?')`);h.run(`answer('Can I get water?','review-miss',{ok:false,perfect:false})`);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),80);assert.ok(h.run(`learningSentenceWeight('Can I get water?')`)>before*10);
 h.run(`for(let i=0;i<20;i++)answer('Can I get water?','miss-'+i,{ok:false,perfect:false})`);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),0);
});

test('fully learned above-eighty sentences are rare rather than excluded, overdue reviews return, and new or missed sentences retain priority',()=>{
 const h=setup();h.run(`for(let i=0;i<5;i++)answer('Can I get water?','known-'+i);for(let i=0;i<5;i++)answer('Can I get coffee?','other-'+i);answer('Can I get coffee?','other-wrong',{ok:false,perfect:false});answer('Can I get coffee?','other-hint',{perfect:false});`);
 assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),90);assert.equal(h.run(`learningSentenceMastery('Can I get coffee?').score`),80);
 assert.ok(h.run(`learningSentenceWeight('Can I get coffee?')`)>h.run(`learningSentenceWeight('Can I get water?')`)*10);
 h.run(`const pool={id:'weighted_test',items:[{en:'Can I get water?',ko:'water'},{en:'Can I get coffee?',ko:'coffee'}]},picked={water:0,coffee:0};for(let i=0;i<6000;i++)picked[travelPickItem(pool,{}).ko]++;`);
 assert.ok(h.run('picked.water')>10,'high mastery is still sampled');assert.ok(h.run('picked.coffee')>h.run('picked.water')*8,'mastered sentences must be substantially rarer');
 assert.ok(h.run(`learningSentenceWeight('Can I get a spoon?')`)>h.run(`learningSentenceWeight('Can I get coffee?')`));
 h.run(`for(let i=0;i<3;i++)answer('Can I get a towel?','weak-'+i,{ok:false,perfect:false})`);assert.ok(h.run(`learningSentenceWeight('Can I get a towel?')`)>h.run(`learningSentenceWeight('Can I get a spoon?')`));
 assert.ok(h.run(`learningSentenceWeight('Can I get water?',Date.now()+60*86400000)`)>h.run(`learningSentenceWeight('Can I get water?')`)*20);
});

test('verified expression mastery reduces whole-frame appearances while keeping selected frames and beginner curriculum boundaries',()=>{
 const h=setup();h.run(`const mastered=TRAVEL_FRAMES[0],fresh=TRAVEL_FRAMES[1],other=TRAVEL_BY_ID.travel_do_you_have;const meta={timingVersion:2,tapMs:1000,speechStartDelayMs:500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,responseMs:1500,withinThreeSeconds:true,speedEligible:true};for(let i=0;i<4;i++)answer(basicStarterItem(mastered).en,'frame-'+i,{it:{frame:mastered,ex:basicStarterItem(mastered),_intro:false},meta});const counts={known:0,fresh:0};for(let i=0;i<500;i++){const chosen=travelPickFrames(1,[mastered,fresh,other])[0];counts[chosen.id===mastered.id?'known':'fresh']++;travelMarkShown([chosen.id]);}`);
 assert.ok(h.run('counts.known')>0);assert.ok(h.run('counts.fresh')>h.run('counts.known')*7);
 h.run(`for(let i=0;i<30;i++){const f=travelPickFrames(1,[mastered])[0];if(f.id!==mastered.id)throw Error('unselected expression');const ex=travelPickItem(f,travelAll(),{introduce:true});if(ex.en!==basicStarterItem(f).en)throw Error('intro must retain the short starter');}`);
});

test('a first answer after viewing a hint keeps normal hinted XP and one separate retry-success bonus',()=>{
 const h=setup();h.run(`const viewed={frame:testFrame,ex:{en:'Can I get water?',ko:'water'},_hintUsed:true,recall:true};const first=answer(viewed.ex.en,'shown-1',{it:viewed,attemptGroupId:'shown',perfect:false});const next=answer(viewed.ex.en,'shown-2',{it:{...viewed},attemptGroupId:'shown',perfect:false});`);
 assert.equal(h.run('first.xp'),15);assert.equal(h.run('next.xp'),5);assert.equal(h.run('practiceReward().total'),20);
});

test('legacy records remain intact while learner mastery, XP, settings and sync metadata are isolated through reload',()=>{
 const oldLog=JSON.stringify({old:{t:100,xp:30,fid:'travel_can_i_get'}}),oldTravel=JSON.stringify({travel_can_i_get:{seen:10,ok:8,introduced:true}}),oldProfile=JSON.stringify({xp:99});
 const h=setup({'speakingroom:practice_log_v1':oldLog,'speakingroom:travelrepeat':oldTravel,'speakingroom:prof':oldProfile,'speakingroom:sync_nick':'original-nickname'});
 assert.equal(h.run('practiceReward().total'),129);h.run(`const second=learningProfileCreate('두 번째');learningProfileSwitch(second);answer('Can I get water?','new-person');hSet('speakingroom:pronunciation_mode_v1','meaning');learningLocalSet('speakingroom:sync_nick','second-nickname');`);
 assert.equal(h.run('practiceReward().total'),30);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),18);assert.equal(h.records.get('speakingroom:practice_log_v1'),oldLog);assert.equal(h.records.get('speakingroom:travelrepeat'),oldTravel);assert.equal(h.records.get('speakingroom:prof'),oldProfile);assert.equal(h.records.get('speakingroom:sync_nick'),'original-nickname');
 const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run('practiceReward().total'),30);assert.equal(restored.run(`hGet('speakingroom:pronunciation_mode_v1','accuracy')`),'meaning');assert.equal(restored.run(`learningLocalGet('speakingroom:sync_nick')`),'second-nickname');restored.run(`learningProfileSwitch('legacy')`);
 assert.equal(restored.run('practiceReward().total'),129);assert.equal(restored.run(`learningSentenceMastery('Can I get water?').seen`),0);assert.equal(restored.run(`hGet('speakingroom:pronunciation_mode_v1','accuracy')`),'accuracy');
});

test('profile-captured stale results cannot create progress in another learner',()=>{
 const h=setup();h.run(`const captured=learningProfileId();const another=learningProfileCreate('다른 학습자');learningProfileSwitch(another);const stale=answer('Can I get water?','late',{profileId:captured});`);
 assert.equal(h.run('stale.ignored'),true);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run(`learningSentenceMastery('Can I get water?').seen`),0);
});

test('re-delivering a persisted XP event repairs a missing mastery transaction without a second reward',()=>{
 const h=setup();h.run(`answer('Can I get water?','repairable')`);h.records.delete('speakingroom:sentence_mastery_v1');
 const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run(`learningSentenceMastery('Can I get water?').seen`),0);assert.equal(restored.run(`answer('Can I get water?','repairable').duplicate`),true);
 assert.equal(restored.run('practiceReward().total'),30);assert.equal(restored.run(`learningSentenceMastery('Can I get water?').seen`),1);
 restored.run(`hSet('speakingroom:pronunciation_mode_v1','meaning');hSet('speakingroom:grading_usage_v1',{calls:3});`);
 const payload=plain(restored.run('supportCollect()'));assert.equal(payload['speakingroom:pronunciation_mode_v1'],'"meaning"');assert.equal(payload['speakingroom:grading_usage_v1'],undefined);
});

test('sync merging is idempotent for mastery transactions and caps independently awarded retry XP at five',()=>{
 const h=setup();h.run(`answer('Can I get water?','first',{attemptGroupId:'group',ok:false,perfect:false});answer('Can I get water?','second',{attemptGroupId:'group'});const remoteLog=supportLog();remoteLog['attempt:remote']={...remoteLog['attempt:second'],t:Date.now()+1};const remoteMastery=hGet(SENTENCE_MASTERY,{});remoteMastery.events['attempt:remote']={...remoteMastery.events['attempt:second'],id:'attempt:remote',t:Date.now()+1};const remote={ [PRACTICE_LOG]:JSON.stringify(remoteLog),[SENTENCE_MASTERY]:JSON.stringify(remoteMastery)};supportApplySnapshot(remote);supportApplySnapshot(remote);`);
 assert.equal(h.run('practiceReward().total'),5);assert.equal(h.run('practiceReward().todayXP'),5);assert.equal(h.run('supportRankingSummary().week'),5);assert.equal(h.run(`learningSentenceMastery('Can I get water?').seen`),3);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),8);
 const payload=plain(h.run('supportCollect()'));assert.ok(payload['speakingroom:sentence_mastery_v1']);assert.equal(payload['speakingroom:learning_profiles_v1'],undefined);
});

test('switching learner during a sync response prevents importing or posting another learner records',async()=>{
 const h=setup();let release;const calls=[];h.context.fetch=async(url,options)=>{calls.push({url,options});return new Promise(resolve=>release=resolve);};
 const pending=h.run(`supportSync('synthetic-person')`);h.run(`const other=learningProfileCreate('다른 사람');learningProfileSwitch(other);`);release({ok:true,json:async()=>({d:{'speakingroom:practice_log_v1':JSON.stringify({foreign:{t:Date.now(),xp:100}})}})});
 await assert.rejects(pending,/학습자가 변경/);assert.equal(calls.length,1);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.run('supportEvents().length'),0);
});

test('daily goal rewards remain separate from the five point question budget',()=>{
 const h=setup();h.run(`for(let i=0;i<9;i++)answer('Can I get coffee?','daily-'+i,{mode:'기본표현'});answer('Can I get water?','wrong',{attemptGroupId:'daily-group',mode:'기본표현',ok:false,perfect:false});const result=answer('Can I get water?','retry',{attemptGroupId:'daily-group',mode:'기본표현'});`);
 assert.equal(h.run('result.xp'),5);assert.equal(h.run('practiceReward().total'),9*30+25+5);assert.equal(h.run('supportEvents().filter(e=>e.kind==="dailyBonus").length'),1);
});

test('full mastery needs both above-eighty score and repeated verified fast answers, and late or wrong answers remove it',()=>{
 const h=setup();h.run(`for(let i=0;i<4;i++)answer('Can I get water?','fast-'+i);`);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),72);assert.equal(h.run('learningLearnedSentences().length'),0);
 h.run(`answer('Can I get water?','fifth');`);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),90);assert.equal(h.run(`learningSentenceMastery('Can I get water?').fastStreak`),5);assert.equal(h.run('learningLearnedSentences().length'),1);
 h.run(`const slow=answer('Can I get water?','slow',{perfect:false,meta:{responseMs:4200,speedEligible:false,withinThreeSeconds:false}})`);assert.equal(h.run('slow.xp'),15);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),100);assert.equal(h.run(`learningSentenceMastery('Can I get water?').fastStreak`),0);assert.equal(h.run('learningLearnedSentences().length'),0);
 h.run(`answer('Can I get water?','again-1');answer('Can I get water?','again-2')`);assert.equal(h.run('learningLearnedSentences().length'),0);h.run(`answer('Can I get water?','again-3')`);assert.equal(h.run('learningLearnedSentences().length'),1);h.run(`answer('Can I get water?','miss',{ok:false,perfect:false})`);assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),80);assert.equal(h.run('learningLearnedSentences().length'),0);
});

test('slow high-scoring and legacy-perfect sentences are not buried or retroactively granted fast mastery',()=>{
 const oldEvents={};for(let i=0;i<5;i++)oldEvents['old-'+i]={id:'old-'+i,en:'Old perfect sentence.',t:i+1,ok:true,perfect:true,delta:18};const old=JSON.stringify({version:1,events:oldEvents}),h=setup({'speakingroom:sentence_mastery_v1':old});
 assert.equal(h.run(`learningSentenceMastery('Old perfect sentence.').score`),90);assert.equal(h.run(`learningSentenceMastery('Old perfect sentence.').fastStreak`),0);assert.equal(h.run('learningLearnedSentences().length'),0);assert.equal(h.records.get('speakingroom:sentence_mastery_v1'),old);
 h.run(`for(let i=0;i<12;i++)answer('Slow correct sentence.','slow-'+i,{perfect:false,meta:{responseMs:5000,speedEligible:false,withinThreeSeconds:false}});for(let i=0;i<5;i++)answer('Fast correct sentence.','fast-'+i);`);
 assert.equal(h.run(`learningSentenceMastery('Slow correct sentence.').score`),100);assert.equal(h.run(`learningSentenceMastery('Slow correct sentence.').fullyLearned`),false);assert.ok(h.run(`learningSentenceWeight('Slow correct sentence.')`)>h.run(`learningSentenceWeight('Fast correct sentence.')`)*10);assert.equal(h.run('learningLearnedSentences().length'),1);
});

test('intro, hint, typed, recall, invalid timing and retries cannot farm fast XP or graduation even if callers mark perfect',()=>{
 const h=setup();h.run(`const excluded=[{_intro:true},{_hintUsed:true},{recall:true}];const results=excluded.map((flags,i)=>answer('Excluded '+i,'excluded-'+i,{it:{frame:testFrame,ex:{en:'Excluded '+i},...flags}}));const typed=answer('Typed answer.','typed',{meta:{typed:true,responseMs:800,speedEligible:true,withinThreeSeconds:true}});const late=answer('Late answer.','late',{meta:{responseMs:3000.01,speedEligible:true,withinThreeSeconds:true}});const unknown=answer('Unknown timing.','unknown',{meta:{speedEligible:true,withinThreeSeconds:true}});const ineligible=answer('No onset evidence.','ineligible',{meta:{responseMs:900,speedEligible:false,withinThreeSeconds:true}});const boundary=answer('At the boundary.','boundary',{meta:{responseMs:3000,speedEligible:true,withinThreeSeconds:true}});`);
 for(const name of ['typed','late','unknown','ineligible']){assert.equal(h.run(name+'.xp'),15);assert.equal(h.run(name+'.fast'),false);assert.equal(h.run(name+'.mastery.score'),10);}assert.deepEqual([...h.run('results.map(r=>r.xp)')],[15,15,15]);assert.ok(h.run('results.every(r=>!r.fast&&r.mastery.score===10)'));assert.equal(h.run('boundary.xp'),30);assert.equal(h.run('boundary.fast'),true);assert.equal(h.run('learningLearnedSentences().length'),0);
 h.run(`answer('Retry fast.','wrong',{attemptGroupId:'retry-group',ok:false,perfect:false});const retry=answer('Retry fast.','retry',{attemptGroupId:'retry-group'});`);assert.equal(h.run('retry.xp'),5);assert.equal(h.run('retry.fast'),false);assert.equal(h.run('retry.mastery.score'),4);assert.equal(h.run('retry.mastery.fastStreak'),0);
});

test('fast evidence and fully learned rows survive reload and sync while remaining isolated by learner',()=>{
 const h=setup();h.run(`for(let i=0;i<5;i++)answer('Can I get water?','proof-'+i);const log=supportLog()['attempt:proof-4'],transaction=hGet(SENTENCE_MASTERY,{}).events['attempt:proof-4'];`);
 for(const name of ['log','transaction']){assert.equal(h.run(name+'.responseMs'),1200);assert.equal(h.run(name+'.withinThreeSeconds'),true);assert.equal(h.run(name+'.speedEligible'),true);assert.equal(h.run(name+'.fast'),true);}
 const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run('learningLearnedSentences().length'),1);assert.equal(restored.run('learningLearnedSentences()[0].lastResponseMs'),1200);const snapshot=plain(h.run('supportCollect()'));restored.context.snapshot=snapshot;restored.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot)');assert.equal(restored.run('learningLearnedSentences().length'),1);assert.equal(restored.run(`learningSentenceMastery('Can I get water?').seen`),5);assert.equal(restored.run('practiceReward().total'),150);
 restored.run(`const another=learningProfileCreate('다른 학습자');learningProfileSwitch(another)`);assert.equal(restored.run('learningLearnedSentences().length'),0);restored.run(`learningProfileSwitch('legacy')`);assert.equal(restored.run('learningLearnedSentences().length'),1);
});

test('growth details show the actual fully learned count, sentence, score and recent fast performance',()=>{
 const h=setup();h.run(`hSet(featureGuideKey('growth'),true);for(let i=0;i<5;i++)answer('Can I get water?','list-'+i);answer('Can I get coffee?','growing',{perfect:false,meta:{responseMs:4200,speedEligible:false,withinThreeSeconds:false}});openGrowth()`);const html=h.elements.get('#sheetContent').innerHTML;assert.match(html,/id="fullyLearnedSentences"/);assert.match(html,/1<small>개 문장이 바로 나와요/);assert.match(html,/Can I get water\?/);assert.match(html,/숙련도 90 \/ 100 · 연속 5회 빠른 정답 · 최근 반응 1\.2초/);assert.match(html,/Can I get coffee\?/);assert.match(html,/숙련도 10 \/ 100 · 연속 0회 빠른 정답 · 최근 반응 4\.2초/);
});

test('actual full and expression-only grades earn the four first-answer XP tiers without marking a partial fully correct',()=>{
 const h=setup();h.run(`const it={frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get water?',ko:'물 주세요.'},_intro:false};
  const fullGrade=travelGrade(it,'Can I get water?'),partialGrade=travelGrade(it,'Can I get a towel?');
  const fullFast=answer(it.ex.en,'full-fast',{it,ok:fullGrade.ok});
  const fullSlow=answer(it.ex.en,'full-slow',{it,ok:fullGrade.ok,perfect:false,meta:{responseMs:4000,speedEligible:true,withinThreeSeconds:false}});
  const partialFast=answer(it.ex.en,'partial-fast',{it,heard:'Can I get a towel?',ok:partialGrade.ok,perfect:false,expressionOnly:!partialGrade.ok&&partialGrade.blockHit});
  const partialSlow=answer(it.ex.en,'partial-slow',{it,heard:'Can I get a towel?',ok:partialGrade.ok,perfect:false,expressionOnly:!partialGrade.ok&&partialGrade.blockHit,meta:{responseMs:4000,speedEligible:true,withinThreeSeconds:false}});`);
 assert.equal(h.run('partialGrade.ok'),false);assert.equal(h.run('partialGrade.blockHit'),true);
 assert.deepEqual([...h.run('[fullFast.xp,fullSlow.xp,partialFast.xp,partialSlow.xp]')],[30,15,15,10]);
 assert.equal(h.run('practiceReward().total'),70);
 for(const name of ['partialFast','partialSlow']){assert.equal(h.run(name+'.fast'),false);assert.equal(h.run(name+'.expressionOnly'),true);}
 assert.equal(h.run('partialFast.fastExpression'),true);assert.equal(h.run('partialSlow.fastExpression'),false);
 const fast=plain(h.run(`supportLog()['attempt:partial-fast']`));assert.equal(fast.ok,false);assert.equal(fast.perfect,false);assert.equal(fast.expressionOnly,true);assert.equal(fast.fastExpression,true);assert.equal(fast.responseMs,1200);assert.equal(fast.words,undefined);assert.equal(fast.curriculumTier,undefined);
 assert.equal(h.run(`learningSentenceMastery(it.ex.en).correct`),2);assert.equal(h.run(`learningSentenceMastery(it.ex.en).score`),28);assert.equal(h.run('learningLearnedSentences().length'),0);
});

test('a partial preserves earned sentence mastery but clears fast graduation and does not accumulate learned words',()=>{
 const h=setup();h.run(`for(let i=0;i<5;i++)answer('Can I get water?','known-'+i);const priorWords=supportWordStats();const partial=answer('Can I get water?','partial',{ok:false,perfect:false,expressionOnly:true,heard:'Can I get a towel?'});const row=learningSentenceMastery('Can I get water?'),transaction=hGet(SENTENCE_MASTERY,{}).events['attempt:partial'];`);
 assert.equal(h.run('partial.xp'),15);assert.equal(h.run('transaction.delta'),0);assert.equal(h.run('transaction.expressionOnly'),true);assert.equal(h.run('transaction.fastExpression'),true);
 assert.equal(h.run('row.score'),90);assert.equal(h.run('row.correct'),5);assert.equal(h.run('row.fastCorrect'),5);assert.equal(h.run('row.misses'),1);assert.equal(h.run('row.fastStreak'),0);assert.equal(h.run('row.fullyLearned'),false);assert.equal(h.run('learningLearnedSentences().length'),0);
 assert.deepEqual(plain(h.run('supportWordStats()')),plain(h.run('priorWords')));
});

test('partial credit gains one five-XP correction bonus without farming or reducing its ten or fifteen XP',()=>{
 for(const quick of [false,true]){
  const h=setup();h.run(`const original={frame:testFrame,ex:{en:'Can I get water?'},_attemptGroupId:'partial-group',_intro:false};
   const partial=answer(original.ex.en,'first',{it:original,attemptGroupId:'partial-group',ok:false,perfect:false,expressionOnly:true,meta:{responseMs:${quick?1200:4100},speedEligible:true,withinThreeSeconds:${quick}}});
   const immediate=answer(original.ex.en,'second',{it:{...original,recall:true},attemptGroupId:'partial-group'});
   const requeued=answer(original.ex.en,'third',{it:{...original,_requeues:1},attemptGroupId:'partial-group'});
   const partialAgain=answer(original.ex.en,'fourth',{it:{...original},attemptGroupId:'partial-group',ok:false,perfect:false,expressionOnly:true});`);
  assert.equal(h.run('partial.xp'),quick?15:10);assert.equal(h.run('immediate.xp'),5);assert.equal(h.run('requeued.xp+partialAgain.xp'),0);assert.equal(h.run('practiceReward().total'),quick?20:15);assert.equal(h.run('supportEvents().length'),4);
  const restored=setup(Object.fromEntries(h.records));restored.run(`const later=answer('Can I get water?','later',{attemptGroupId:'partial-group'});`);assert.equal(restored.run('later.xp'),0);assert.equal(restored.run('practiceReward().total'),quick?20:15);
 }
});

test('a first zero-point miss preserves five-XP partial retry credit and shares that slot with later full corrections',()=>{
 const h=setup();h.run(`const wrong=answer('Can I get water?','wrong',{attemptGroupId:'zero-group',ok:false,perfect:false});const partial=answer('Can I get water?','partial',{attemptGroupId:'zero-group',ok:false,perfect:false,expressionOnly:true});const full=answer('Can I get water?','full',{attemptGroupId:'zero-group'});const again=answer('Can I get water?','partial-again',{attemptGroupId:'zero-group',ok:false,perfect:false,expressionOnly:true});`);
 assert.deepEqual([...h.run('[wrong.xp,partial.xp,full.xp,again.xp]')],[0,5,0,0]);assert.equal(h.run('partial.fastExpression'),false);assert.equal(h.run('practiceReward().total'),5);
 assert.equal(h.run(`learningSentenceMastery('Can I get water?').score`),4);assert.equal(h.run(`learningSentenceMastery('Can I get water?').correct`),1);
});

test('partial fast credit requires the same real timing and unaided first-attempt evidence as full fast credit',()=>{
 const h=setup();h.run(`const cases=[{it:{frame:testFrame,ex:{en:'intro'},_intro:true}},{it:{frame:testFrame,ex:{en:'hint'},_hintUsed:true}},{it:{frame:testFrame,ex:{en:'recall'},recall:true}},{meta:{typed:true,responseMs:900,speedEligible:true,withinThreeSeconds:true}},{meta:{responseMs:900,speedEligible:false,withinThreeSeconds:true}},{meta:{speedEligible:true,withinThreeSeconds:true}},{meta:{responseMs:3001,speedEligible:true,withinThreeSeconds:true}},{meta:{responseMs:900,speedEligible:true,withinThreeSeconds:false}}];const results=cases.map((options,i)=>answer('Partial '+i,'excluded-'+i,{ok:false,perfect:false,expressionOnly:true,...options}));const boundary=answer('Boundary partial.','boundary',{ok:false,perfect:false,expressionOnly:true,meta:{responseMs:3000,speedEligible:true,withinThreeSeconds:true}});`);
 assert.ok(h.run('results.every(r=>r.xp===10&&!r.fast&&!r.fastExpression&&r.mastery.correct===0&&r.mastery.score===0)'));assert.equal(h.run('boundary.xp'),15);assert.equal(h.run('boundary.fastExpression'),true);
 const typed=h.run(`supportLog()['attempt:excluded-3']`);assert.equal(typed.typed,true);assert.equal(typed.fastExpression,false);
});

test('partial histories sync idempotently, retain caps and learner isolation, and adapt expression speed without full speaking perfection',()=>{
 const h=setup();h.run(`const fast=answer('Can I get water?','partial',{attemptGroupId:'group',ok:false,perfect:false,expressionOnly:true});const adaptive=alGet();`);
 assert.deepEqual([...h.run('adaptive.st.speak.hist')],[.85]);assert.deepEqual([...h.run('adaptive.st.speed.hist')],[1]);
 const payload=plain(h.run('supportCollect()')),restored=setup();restored.context.snapshot=payload;restored.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot)');assert.equal(restored.run('practiceReward().total'),15);
 const log=plain(restored.run(`supportLog()['attempt:partial']`));assert.equal(log.expressionOnly,true);assert.equal(log.fastExpression,true);assert.equal(log.ok,false);assert.equal(log.rewardCap,20);
 assert.equal(restored.run(`hGet(SENTENCE_MASTERY,{}).events['attempt:partial'].delta`),0);restored.run(`const retry=answer('Can I get water?','retry',{attemptGroupId:'group'});`);assert.equal(restored.run('retry.xp'),5);
 restored.run(`const other=learningProfileCreate('다른 학습자');learningProfileSwitch(other);`);assert.equal(restored.run('practiceReward().total'),0);restored.run(`learningProfileSwitch('legacy');`);assert.equal(restored.run('practiceReward().total'),20);assert.equal(restored.run(`learningSentenceMastery('Can I get water?').seen`),2);
});

test('split timing permits a four-and-a-half second total while independently enforcing tap and speech-start deadlines',()=>{
 const h=setup();h.run(`const meta={timingVersion:2,tapMs:3000,speechStartDelayMs:1500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,responseMs:4500,speedEligible:true,withinThreeSeconds:true};const full=answer('Can I get water?','split-full',{meta});const partial=answer('Can I get water?','split-partial',{ok:false,perfect:false,expressionOnly:true,meta});const lateTap=answer('Can I get water?','late-tap',{meta:{...meta,tapMs:3001,responseMs:4501}});const lateVoice=answer('Can I get water?','late-voice',{meta:{...meta,speechStartDelayMs:1501,responseMs:4501}});const missingFlags=answer('Can I get water?','missing-flags',{meta:{...meta,tapWithinThreeSeconds:false}});const transaction=hGet(SENTENCE_MASTERY,{}).events['attempt:split-full'];`);
 assert.deepEqual([...h.run('[full.xp,partial.xp,lateTap.xp,lateVoice.xp,missingFlags.xp]')],[30,15,15,15,15]);assert.equal(h.run('full.fast'),true);assert.equal(h.run('partial.fastExpression'),true);assert.equal(h.run('transaction.timingVersion'),2);assert.equal(h.run('transaction.tapMs'),3000);assert.equal(h.run('transaction.speechStartDelayMs'),1500);assert.equal(h.run('transaction.responseMs'),4500);assert.equal(h.run('transaction.fast'),true);
 const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run(`learningSentenceMastery('Can I get water?').fastCorrect`),1);assert.equal(restored.run(`supportLog()['attempt:split-full'].tapWithinThreeSeconds`),true);
});

test('progress reconstruction repairs a lost credit transaction after the current score has fallen and duplicate delivery cannot mint another unlock',()=>{
 const h=setup();h.run(`const frame=TRAVEL_BY_ID.travel_can_i_get,it={frame,ex:basicStarterItem(frame),_intro:false},meta={timingVersion:2,tapMs:1000,speechStartDelayMs:500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,responseMs:1500,withinThreeSeconds:true,speedEligible:true};for(let i=0;i<4;i++)answer(it.ex.en,'earned-'+i,{it,ok:false,perfect:false,expressionOnly:true,meta});for(let i=0;i<3;i++)answer(it.ex.en,'miss-'+i,{it,ok:false,perfect:false,meta});`);
 assert.equal(h.run('learningExpressionScore(frame.id)'),4);assert.equal(h.run('learningAvailableFrames().length'),11);h.records.delete('speakingroom:expression_progress_v1');const restored=setup(Object.fromEntries(h.records));assert.equal(restored.run('learningAvailableFrames().length'),11);assert.equal(restored.run('Object.keys(learningProgressRefresh().earned).length'),1);
 restored.run(`const copied=supportLog()['attempt:earned-3'];const frame=TRAVEL_BY_ID[copied.fid];recordPractice({it:{frame,ex:{en:copied.en}},heard:'',ok:false,expressionOnly:true,attemptId:'earned-3',attemptGroupId:copied.attemptGroupId,meta:{}})`);assert.equal(restored.run('learningAvailableFrames().length'),11);assert.equal(restored.run('Object.keys(learningProgressRefresh().earned).length'),1);
});

test('same earned source on devices with different legacy availability merges without duplicate unlock credits',()=>{
 const make=legacy=>{const h=setup({'speakingroom:travelrepeat':JSON.stringify({[legacy]:{introduced:true,seen:1}})});h.run(`const frame=TRAVEL_BY_ID.travel_can_i_get,it={frame,ex:basicStarterItem(frame),_intro:false},meta={timingVersion:2,tapMs:1000,speechStartDelayMs:500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,responseMs:1500,withinThreeSeconds:true,speedEligible:true};for(let i=0;i<4;i++)answer(it.ex.en,'source-'+i,{it,ok:false,perfect:false,expressionOnly:true,meta});`);return h;};
 const a=make('travel_is_included'),b=make('travel_where_meet');const payload=plain(b.run('supportCollect()'));a.context.snapshot=payload;a.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot)');assert.equal(a.run('Object.keys(learningProgressRefresh().earned).length'),1);assert.equal(a.run('Object.keys(learningProgressRefresh().legacy).length'),2);assert.equal(a.run('learningAvailableFrames().length'),13);assert.equal(a.run(`learningProgressRefresh().unlocked.travel_what_recommend`),true);
 const before=a.run('learningAvailableFrames().length');a.run(`travelMarkIntroduced('travel_what_recommend');learningProgressRefresh()`);assert.equal(a.run('learningAvailableFrames().length'),before,'introducing an unlocked expression must not become an extra grandfathered credit');
});

test('growth shows current expression scores and split timing while retaining full-sentence mastery as a separate record',()=>{
 const h=setup();h.run(`hSet(featureGuideKey('growth'),true);const frame=TRAVEL_BY_ID.travel_can_i_get,it={frame,ex:basicStarterItem(frame),_intro:false},meta={timingVersion:2,tapMs:2800,speechStartDelayMs:1400,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,responseMs:4200,withinThreeSeconds:true,speedEligible:true};for(let i=0;i<4;i++)answer(it.ex.en,'expression-'+i,{it,ok:false,perfect:false,expressionOnly:true,meta});openGrowth();`);
 const html=h.elements.get('#sheetContent').innerHTML;assert.match(html,/id="expressionProgress"/);assert.match(html,/표현 익숙함 8\.0 \/ 10/);assert.match(html,/1<small>개 표현이 익숙해졌어요 · 11 \/ 23개 열림/);assert.match(html,/3초 안에 마이크를 누르고/);assert.match(html,/1\.5초 안에 말을 시작/);assert.match(html,/id="fullyLearnedSentences"/);assert.equal(h.run('learningLearnedSentences().length'),0);assert.equal(h.run('supportStats().automatic'),1);
});

test('an initially correct answer can earn one separate five-XP retry bonus while further successes and duplicate delivery earn none',()=>{
 for(const quick of [true,false]){
  const h=setup();h.run(`const it={frame:testFrame,ex:{en:'Can I get water?'},_attemptGroupId:'correct-group',_intro:false};const first=answer(it.ex.en,'correct-first',{it,attemptGroupId:'correct-group',perfect:${quick}});const retryItem={...it,recall:true};const retry=answer(it.ex.en,'correct-retry',{it:retryItem,attemptGroupId:'correct-group'});const retryMessage=retryItem._rewardMessage;const again=answer(it.ex.en,'correct-again',{it,attemptGroupId:'correct-group'});const duplicate=answer(it.ex.en,'correct-retry',{it,attemptGroupId:'correct-group'});`);
  assert.equal(h.run('first.xp'),quick?30:15);assert.equal(h.run('first.baseXP'),quick?30:15);assert.equal(h.run('retry.xp'),5);assert.equal(h.run('retry.baseXP'),0);assert.equal(h.run('retry.retryBonusXP'),5);assert.equal(h.run('again.xp'),0);assert.equal(h.run('duplicate.duplicate'),true);assert.equal(h.run('practiceReward().total'),quick?35:20);assert.equal(h.run('supportEvents().length'),3);
  const log=plain(h.run(`supportLog()['attempt:correct-retry']`));assert.equal(log.rewardVersion,3);assert.equal(log.baseXP,0);assert.equal(log.retryBonusXP,5);assert.equal(log.ok,true);assert.equal(log.perfect,false);
  assert.match(h.run('retryMessage'),/^\+5 XP · 다시 말하기 정답 보너스/);assert.match(h.run(`it._rewardMessage`),/보너스는 이미 받았어요/);
 }
});

test('independent devices can award the same retry bonus locally but sync and reload credit only five XP per question',()=>{
 const first=setup();first.run(`answer('Can I get water?','first',{attemptGroupId:'shared'});`);const seed=Object.fromEntries(first.records),a=setup(seed),b=setup(seed);
 a.run(`const retry=answer('Can I get water?','device-a',{attemptGroupId:'shared'});`);b.run(`const retry=answer('Can I get water?','device-b',{attemptGroupId:'shared'});`);assert.equal(a.run('retry.xp'),5);assert.equal(b.run('retry.xp'),5);
 a.context.snapshot=plain(b.run('supportCollect()'));a.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot)');assert.equal(a.run('practiceReward().total'),35);assert.equal(a.run('practiceReward().todayXP'),35);assert.equal(a.run('supportRankingSummary().week'),35);assert.equal(a.run('supportEvents().length'),3);
 const restored=setup(Object.fromEntries(a.records));assert.equal(restored.run('practiceReward().total'),35);assert.equal(restored.run(`answer('Can I get water?','after-reload',{attemptGroupId:'shared'}).xp`),0);
 restored.run(`const other=learningProfileCreate('다른 학습자');learningProfileSwitch(other);`);assert.equal(restored.run('practiceReward().total'),0);assert.equal(restored.run(`answer('Can I get water?','same-name',{attemptGroupId:'shared'}).xp`),30);restored.run(`learningProfileSwitch('legacy');`);assert.equal(restored.run('practiceReward().total'),35);
});

test('historical v2 first-answer XP remains intact and receives its new retry bonus without old caps erasing it',()=>{
 for(const originalXP of [10,15,30]){
  const first={t:Date.now()-10,order:1,fid:'travel_can_i_get',en:'Can I get water?',ok:originalXP===30,expressionOnly:originalXP!==30,retry:false,rewardVersion:2,attemptGroupId:'old-group',rewardCap:originalXP,firstWrong:false,xp:originalXP},h=setup({'speakingroom:practice_log_v1':JSON.stringify({'attempt:old':first})});
  h.run(`const retry=answer('Can I get water?','new-retry',{attemptGroupId:'old-group'});const again=answer('Can I get water?','new-again',{attemptGroupId:'old-group'});`);assert.equal(h.run('retry.xp'),5);assert.equal(h.run('again.xp'),0);assert.equal(h.run('practiceReward().total'),originalXP+5);assert.deepEqual(plain(h.run(`supportLog()['attempt:old']`)),first);
 }
});

test('a historical v2 partial retry already credited five XP consumes the same slot and does not lose its reward',()=>{
 const first={t:1,order:1,fid:'travel_can_i_get',en:'Can I get water?',ok:false,retry:false,firstWrong:true,attemptGroupId:'old-wrong',rewardVersion:2,rewardCap:5,xp:0},partial={...first,t:2,order:2,retry:true,expressionOnly:true,xp:5},h=setup({'speakingroom:practice_log_v1':JSON.stringify({'attempt:old-wrong':first,'attempt:old-partial':partial})});
 h.run(`const correct=answer('Can I get water?','new-correct',{attemptGroupId:'old-wrong'});`);assert.equal(h.run('correct.xp'),0);assert.equal(h.run('practiceReward().total'),5);assert.equal(h.run(`supportLog()['attempt:old-partial'].xp`),5);
});

test('mixed v2 and v3 retry transactions sync without duplicating the success bonus or reducing first-answer credit',()=>{
 const h=setup();h.run(`answer('Can I get water?','first',{attemptGroupId:'mixed'});answer('Can I get water?','new-retry',{attemptGroupId:'mixed'});const oldFirst={...supportLog()['attempt:first'],rewardVersion:2,rewardCap:30,xp:30};delete oldFirst.baseXP;delete oldFirst.retryBonusXP;const remoteLog={'attempt:old-first':oldFirst};const snapshot={[PRACTICE_LOG]:JSON.stringify(remoteLog)};supportApplySnapshot(snapshot);supportApplySnapshot(snapshot);`);assert.equal(h.run('practiceReward().total'),35);
 const oldWrong={t:1,fid:'travel_can_i_get',en:'Can I get water?',ok:false,retry:false,firstWrong:true,attemptGroupId:'mixed-wrong',rewardVersion:2,rewardCap:5,xp:0},oldRetry={...oldWrong,t:2,ok:true,retry:true,xp:5},other=setup();other.run(`answer('Can I get water?','wrong',{attemptGroupId:'mixed-wrong',ok:false,perfect:false});answer('Can I get water?','new-retry',{attemptGroupId:'mixed-wrong'});`);other.context.snapshot={'speakingroom:practice_log_v1':JSON.stringify({'attempt:old-wrong':oldWrong,'attempt:old-retry':oldRetry})};other.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot)');assert.equal(other.run('practiceReward().total'),5);
});

test('retry XP never raises expression mastery, creates an unlock, or accumulates learned-word successes',()=>{
 const h=setup();h.run(`const frame=TRAVEL_BY_ID.travel_can_i_get,it={frame,ex:basicStarterItem(frame),_intro:false,_attemptGroupId:'expression-group'},meta={timingVersion:2,tapMs:1000,speechStartDelayMs:500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,responseMs:1500,withinThreeSeconds:true,speedEligible:true};answer(it.ex.en,'first',{it,attemptGroupId:'expression-group',meta});const wordsBefore=supportWordStats();for(let i=0;i<10;i++)answer(it.ex.en,'retry-'+i,{it,attemptGroupId:'expression-group',meta});`);
 assert.equal(h.run('practiceReward().total'),35);assert.equal(h.run('learningExpressionScore(frame.id)'),2);assert.equal(h.run('learningAvailableFrames().length'),10);assert.equal(h.run('Object.keys(learningProgressRefresh().earned).length'),0);assert.deepEqual(plain(h.run('supportWordStats()')),plain(h.run('wordsBefore')));
});

test('partial retries retain the prior zero-first reward without farming after a credited partial first answer or cross-device sync',()=>{
 const partialFirst=setup();partialFirst.run(`const first=answer('Can I get water?','first',{attemptGroupId:'partial-first',ok:false,perfect:false,expressionOnly:true});const partialRetry=answer('Can I get water?','partial-retry',{attemptGroupId:'partial-first',ok:false,perfect:false,expressionOnly:true});const fullRetry=answer('Can I get water?','full-retry',{attemptGroupId:'partial-first'});`);
 assert.deepEqual([...partialFirst.run('[first.xp,partialRetry.xp,fullRetry.xp]')],[15,0,5]);assert.equal(partialFirst.run('practiceReward().total'),20);
 const firstWrong=setup();firstWrong.run(`answer('Can I get water?','wrong',{attemptGroupId:'shared-wrong',ok:false,perfect:false});`);const seed=Object.fromEntries(firstWrong.records),a=setup(seed),b=setup(seed);
 a.run(`const partial=answer('Can I get water?','partial-device',{attemptGroupId:'shared-wrong',ok:false,perfect:false,expressionOnly:true});`);b.run(`const full=answer('Can I get water?','full-device',{attemptGroupId:'shared-wrong'});`);assert.equal(a.run('partial.xp'),5);assert.equal(b.run('full.xp'),5);assert.equal(a.run(`supportLog()['attempt:partial-device'].retryBonusXP`),5);
 a.context.snapshot=plain(b.run('supportCollect()'));a.run('supportApplySnapshot(snapshot);supportApplySnapshot(snapshot)');assert.equal(a.run('practiceReward().total'),5);assert.equal(a.run(`answer('Can I get water?','full-later',{attemptGroupId:'shared-wrong'}).xp`),0);assert.equal(a.run('practiceReward().total'),5);
});
