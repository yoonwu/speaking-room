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

test('mastery reduces whole-frame appearances while keeping selected frames and beginner curriculum boundaries',()=>{
 const h=setup();h.run(`const mastered=TRAVEL_FRAMES[0],fresh=TRAVEL_FRAMES[1];for(const ex of learningEligibleItems(mastered))for(let i=0;i<5;i++)answer(ex.en,'frame-'+ex.en+'-'+i);const counts={known:0,fresh:0};for(let i=0;i<500;i++){const chosen=travelPickFrames(1,[mastered,fresh])[0];counts[chosen.id===mastered.id?'known':'fresh']++;travelMarkShown([chosen.id]);}`);
 assert.ok(h.run('counts.known')>0);assert.ok(h.run('counts.fresh')>h.run('counts.known')*7);
 h.run(`for(let i=0;i<30;i++){const f=travelPickFrames(1,[mastered])[0];if(f.id!==mastered.id)throw Error('unselected expression');const ex=travelPickItem(f,travelAll(),{introduce:true});if(ex.en!==basicStarterItem(f).en)throw Error('intro must retain the short starter');}`);
});

test('a first answer after viewing a hint keeps normal hinted XP without creating a retry farming path',()=>{
 const h=setup();h.run(`const viewed={frame:testFrame,ex:{en:'Can I get water?',ko:'water'},_hintUsed:true,recall:true};const first=answer(viewed.ex.en,'shown-1',{it:viewed,attemptGroupId:'shown',perfect:false});const next=answer(viewed.ex.en,'shown-2',{it:{...viewed},attemptGroupId:'shown',perfect:false});`);
 assert.equal(h.run('first.xp'),15);assert.equal(h.run('next.xp'),0);assert.equal(h.run('practiceReward().total'),15);
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
 const h=setup();h.run(`hSet(featureGuideKey('growth'),true);for(let i=0;i<5;i++)answer('Can I get water?','list-'+i);answer('Can I get coffee?','growing',{perfect:false,meta:{responseMs:4200,speedEligible:false,withinThreeSeconds:false}});openGrowth()`);const html=h.elements.get('#sheetContent').innerHTML;assert.match(html,/id="fullyLearnedSentences"/);assert.match(html,/1<small>개 문장이 바로 나와요/);assert.match(html,/Can I get water\?/);assert.match(html,/숙련도 90 \/ 100 · 연속 5회 3초 정답 · 최근 1\.2초/);assert.match(html,/Can I get coffee\?/);assert.match(html,/숙련도 10 \/ 100 · 연속 0회 3초 정답 · 최근 4\.2초/);
});
