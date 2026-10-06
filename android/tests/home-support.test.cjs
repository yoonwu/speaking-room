const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const root=path.resolve(__dirname,'../..');
function setup(seed={}){
 const records=new Map(Object.entries(seed)),elements=new Map();
 function element(){return {style:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,addEventListener(){},setAttribute(){},focus(){},remove(){},insertBefore(){},appendChild(){},querySelector:()=>element(),querySelectorAll:()=>[],getTracks:()=>[]};}
 const get=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s);};
 const context={window:{addEventListener(){}},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},navigator:{},localStorage:{getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)},setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:false,status:404}),location:{reload(){}},console,Date,Math,URL,Blob};
 vm.createContext(context);for(const file of ['practice-data.js','practice.js','home-support.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);vm.runInContext('speakEn=()=>{}',context);return {run:s=>vm.runInContext(s,context),context,records,elements};
}
test('restored home derives progress from actual records and keeps four practice modes',()=>{const {run,elements}=setup({'speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{seen:10,ok:8,streak:3}})});assert.equal(run('supportStats().accuracy'),80);assert.equal(run('supportStats().automatic'),1);assert.match(elements.get('#growthZone').innerHTML,/80%/);assert.match(elements.get('#coreToday').innerHTML,/0 \/ 10회/);assert.equal(run('typeof startVocab'),'undefined');});
test('practice drives daily goals, adaptive levels and preserves legacy XP',()=>{const {run,records}=setup({'speakingroom:prof':JSON.stringify({xp:99})});run(`startDrill(travelBuildItems(5,[TRAVEL_FRAMES[0]]),'기본표현');autoDrillFinish(autoDrill.items[0].ex.en,{typed:true});`);assert.equal(run('supportToday().travel'),1);assert.equal(run('supportEvents().length'),1);assert.equal(run('supportStats().voice.length'),0);run(`for(let i=0;i<3;i++)autoLvlRecord('speak','perfect')`);assert.ok(run('alGet().speak')>1);assert.equal(JSON.parse(records.get('speakingroom:prof')).xp,99);});
test('snapshot merge preserves local learning and ignores auth and unrelated storage',()=>{const {run,records}=setup({'secret-token':'keep','speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{seen:10,ok:8,miss:2,lastT:200,streak:3}})});run(`supportApplySnapshot({'secret-token':'overwrite','speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{seen:3,ok:1,miss:2,lastT:100,streak:0}})});`);assert.equal(run('travelStat("travel_can_i_get").ok'),8);assert.equal(run('travelStat("travel_can_i_get").streak'),3);assert.equal(records.get('secret-token'),'keep');assert.equal(run('supportCollect()["secret-token"]'),undefined);});
test('sync retains historical server records but does not upload local secrets or conversations',async()=>{const {run,context}=setup({'secret-token':'private','speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{seen:2,ok:2}})});const calls=[];context.fetch=async(url,opts={})=>{calls.push({url,opts});return {ok:true,json:async()=>({d:{'speakingroom:old-vocab':'{"count":10}'},t:1})};};await run('supportSync("synthetic-test")');const body=JSON.parse(calls[1].opts.body);assert.equal(body.d['speakingroom:old-vocab'],'{"count":10}');assert.equal(body.d['secret-token'],undefined);assert.ok(body.d['speakingroom:travelrepeat']);assert.equal(calls.length,2);});
test('graduated mistakes cannot be reintroduced by an older device snapshot',()=>{const {run}=setup({'speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{seen:5,ok:4,streak:3,lastT:200}})});run(`supportApplySnapshot({'speakingroom:travel_miss':JSON.stringify({'Can I get a towel?':{fid:'travel_can_i_get',miss:1,streak:0,lastT:100}})});`);assert.equal(run('missCount()'),0);});
test('single basic practice action starts ten questions and shows daily progress',()=>{const {run,elements}=setup();run('let routineArgs=null;startTravelDrill=(...args)=>{routineArgs=args;};renderSupportHome();');elements.get('#engTravel').onclick({type:'click'});assert.equal(run('routineArgs[0]'),10);assert.equal(run('routineArgs[1]'),true);const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.doesNotMatch(html,/id="routineZone"|id="heroZone"/);assert.match(elements.get('#coreToday').innerHTML,/0 \/ 10회/);assert.match(elements.get('#growthZone').innerHTML,/말하기 난이도/);});
test('XP rewards effort, correct recall and ten basic-expression attempts with real level progress',()=>{const {run}=setup();run(`const it=travelBuildItems(1,[TRAVEL_FRAMES[0]])[0];for(let i=0;i<10;i++)recordPractice({it,ok:true,perfect:true,meta:{typed:true},started:Date.now(),mode:'기본표현'});`);assert.equal(run('practiceReward().total'),225);assert.equal(run('practiceReward().level'),2);assert.equal(run('practiceReward().remaining'),125);assert.equal(run('practiceReward().todayCount'),10);run(`recordPractice({it,ok:false,perfect:false,meta:{typed:true},started:Date.now(),mode:'기본표현'})`);assert.equal(run('practiceReward().total'),235);});
test('synced XP events are idempotent and the daily bonus only counts once across devices',()=>{const {run}=setup();run(`const event={t:Date.now(),xp:20,dailyBonus:25,fid:'travel_can_i_get'};supportApplySnapshot({'speakingroom:practice_log_v1':JSON.stringify({first:event,second:event})});supportApplySnapshot({'speakingroom:practice_log_v1':JSON.stringify({first:event})});`);assert.equal(run('practiceReward().total'),65);});
test('basic expression difficulty uses actual outcomes and controls sentence length',()=>{const {run}=setup();run(`for(let i=0;i<4;i++)autoLvlRecord('speak','perfect')`);assert.equal(run('alGet().speak'),4);run(`const d=alGet();d.speak=1;alSave(d);const f={id:'test',items:[{en:'Can I get water?',ko:'short'},{en:'Can I get a glass of water without any ice please?',ko:'long'}]};const o={};let lengths=[];for(let i=0;i<5;i++)lengths.push(travelPickItem(f,o).en.split(/\s+/).length);`);assert.ok(run('lengths.every(n=>n<=8)'));run('d.speak=40;alSave(d);let seenLong=false;for(let i=0;i<5;i++)if(travelPickItem(f,o).ko==="long")seenLong=true;');assert.equal(run('seenLong'),true);});
test('words accumulate after three unaided correct answers and repeated tokens count once per answer',()=>{const {run}=setup();run(`const it=travelBuildItems(1,[TRAVEL_FRAMES[0]])[0];it._intro=false;it.ex.en='Can I get water?';for(let i=0;i<3;i++)recordPractice({it,heard:'Can I get water water please?',ok:true,perfect:true,meta:{typed:true},started:Date.now(),mode:'기본표현'});`);assert.equal(run('supportWordStats().find(w=>w.word==="water").count'),3);assert.equal(run('supportWordStats().filter(w=>w.count>=WORD_SUCCESS_GOAL).length'),2);assert.equal(run('supportWordStats().some(w=>w.word==="i"||w.word==="can")'),false);});
test('incorrect, hinted, introductory and immediate retry answers do not count towards word mastery',()=>{const {run}=setup();run(`const it=travelBuildItems(1,[TRAVEL_FRAMES[0]])[0];const base={it,heard:'Can I get water?',meta:{typed:true},started:Date.now(),mode:'기본표현'};recordPractice({...base,ok:false,perfect:false});recordPractice({...base,ok:true,perfect:false});it._intro=true;recordPractice({...base,ok:true,perfect:true});it._intro=false;it.recall=true;recordPractice({...base,ok:true,perfect:true});`);assert.equal(run('supportWordStats().length'),0);});
test('first-use guides wait for completion and can be replayed without changing learning records',()=>{const {run}=setup();run(`let entered=0;let handlers={};openSheet=()=>({querySelector:s=>handlers[s]||(handlers[s]={}),remove(){}});const enter=withFirstGuide('basic',()=>entered++);enter();`);assert.equal(run('entered'),0);assert.equal(run('hGet(featureGuideKey("basic"),false)'),false);run(`handlers['#featureNext'].onclick();handlers['#featureNext'].onclick();`);assert.equal(run('entered'),0);run(`handlers['#featureNext'].onclick();`);assert.equal(run('entered'),1);assert.equal(run('hGet(featureGuideKey("basic"),false)'),true);run('enter();');assert.equal(run('entered'),2);run('showFeatureGuide("basic");');assert.equal(run('entered'),2);assert.equal(run('supportCollect()[featureGuideKey("basic")]'),undefined);});

test('the revised basic guide is shown once to existing learners without resetting other guides',()=>{const {run,records}=setup({'speakingroom:feature_guide:v2:basic':'true','speakingroom:feature_guide:v2:study':'true','speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{introduced:true,seen:8,ok:6}})});run(`let entered=0;let handlers={};openSheet=()=>({querySelector:s=>handlers[s]||(handlers[s]={}),remove(){}});showFeatureGuide('basic',()=>entered++);`);assert.equal(run('entered'),0);assert.equal(run('travelStat("travel_can_i_get").ok'),6);run(`showFeatureGuide('study',()=>entered++);`);assert.equal(run('entered'),1);assert.equal(records.get('speakingroom:feature_guide:v2:basic'),'true');});

test('all 761 examples are reviewed and each expression has a short, gradable first sentence',()=>{
 const {run}=setup();
 assert.equal(run('TRAVEL_ALL_FRAMES.length'),32);assert.equal(run('TRAVEL_ALL_FRAMES.reduce((n,f)=>n+basicCurriculumCatalog(f).length,0)'),761);
 const failures=run(`TRAVEL_ALL_FRAMES.flatMap(f=>{
   const r=basicCurriculumRule(f),pool=basicCoreItems(f),starter=basicStarterItem(f),errors=[];
   if(!starter||!pool.length)errors.push(f.id+' missing starter');
   for(const i of [...r.core,...r.complex,...Object.keys(r.simple||{}).map(Number)])if(!f.items[i])errors.push(f.id+' invalid index '+i);
   if(r.core.some(i=>r.complex.includes(i)))errors.push(f.id+' overlapping tiers');
   if(r.core.some(i=>f.items[i].en.split(/\\s+/).length>8))errors.push(f.id+' long core');
   for(const ex of pool){
     const frame=basicFrameFor(f,ex),it={frame,ex};
     if(ex.en.split(/\\s+/).length>8||/\\b(until|after|before|if|when|without|nearby|tomorrow)\\b|,|\\band\\b/i.test(ex.en))errors.push(f.id+' extra clause '+ex.en);
     if(!travelGrade(it,ex.en).ok||!travelKrOf(ex.en))errors.push(f.id+' invalid answer '+ex.en);
     for(const alt of travelAnswerAlternatives(it))if(!travelGrade(it,alt).ok)errors.push(f.id+' rejected alternative '+alt);
   }
   return errors;
 })`);
 assert.deepEqual(Array.from(failures),[]);
});

test('first exposure stays short at high global difficulty and building a queue does not introduce unseen expressions',()=>{
 const {run}=setup();run('const level=alGet();level.speak=60;alSave(level);');
 for(const id of run('TRAVEL_FRAMES.map(f=>f.id)')){
   assert.equal(run(`travelBuildItems(1,[TRAVEL_BY_ID[${JSON.stringify(id)}]])[0].ex.en`),run(`basicStarterItem(TRAVEL_BY_ID[${JSON.stringify(id)}]).en`));
   assert.equal(run(`!!travelStat(${JSON.stringify(id)}).introduced`),false);
 }
 run(`startDrill(travelBuildItems(10,[TRAVEL_BY_ID.travel_can_i_leave]),'기본표현')`);
 assert.equal(run('autoDrill.items[0].ex.en'),'Can I leave my bags here?');assert.equal(run('autoDrill.items[0]._intro'),true);
 assert.equal(run('autoDrill.items.every(it=>it.ex._tier===1)'),true);
});

test('adding details requires unaided recall of this expression, not global level or another expression',()=>{
 const {run}=setup();run(`const f=TRAVEL_BY_ID.travel_can_i_leave;const level=alGet();level.speak=60;alSave(level);const it={frame:f,ex:basicStarterItem(f),_intro:false};const answer={it,heard:it.ex.en,ok:true,perfect:true,meta:{typed:true},started:Date.now(),mode:'기본표현'};`);
 assert.equal(run('basicCurriculumStage(f)'),1);
 run(`for(let i=0;i<2;i++)recordPractice(answer)`);assert.equal(run('basicCurriculumStage(f)'),1);
 run('recordPractice(answer)');assert.equal(run('basicCurriculumStage(f)'),2);
 assert.equal(run('basicCurriculumStage(TRAVEL_BY_ID.travel_think_i_left)'),1);
 run(`const level2=alGet();level2.speak=15;alSave(level2);it.ex=basicCurriculumCatalog(f).find(x=>x._tier===2);for(let i=0;i<3;i++)recordPractice(answer);`);
 assert.equal(run('basicCurriculumStage(f)'),2);
 run('const level3=alGet();level3.speak=35;alSave(level3)');assert.equal(run('basicCurriculumStage(f)'),3);
});

test('introductory, hinted, incorrect and immediate retry attempts do not unlock added grammar or erase old progress',()=>{
 const {run}=setup({'speakingroom:prof':'{"xp":123}','speakingroom:travelrepeat':'{"travel_can_i_leave":{"seen":20,"ok":18,"introduced":true}}'});
 run(`const f=TRAVEL_BY_ID.travel_can_i_leave,it={frame:f,ex:basicStarterItem(f),_intro:false};const answer={it,heard:it.ex.en,ok:true,perfect:true,meta:{typed:true},started:Date.now(),mode:'기본표현'};for(let i=0;i<3;i++){it._intro=true;recordPractice(answer);it._intro=false;it.recall=true;recordPractice(answer);it.recall=false;recordPractice({...answer,perfect:false});recordPractice({...answer,ok:false,perfect:false});}`);
 assert.equal(run('supportEvents().filter(e=>e.curriculumTier).length'),0);assert.equal(run('basicCurriculumStage(f)'),1);
 assert.equal(run('travelStat(f.id).ok'),18);assert.equal(run('practiceReward().total>123'),true);
});

test('shortened answers keep essential objects and grammar while no longer requiring the removed tail',()=>{
 const {run}=setup();
 const grade=(id,index,heard)=>run(`(()=>{const f=TRAVEL_BY_ID[${JSON.stringify('travel_'+id)}],ex=basicCoreItems(f).find(x=>x._sourceIndex===${index});return travelGrade({frame:basicFrameFor(f,ex),ex},${JSON.stringify(heard)}).ok;})()`);
 assert.equal(grade('can_i_leave',4,'Can I leave my bags here?'),true);assert.equal(grade('can_i_leave',4,'Can I leave my phone here?'),false);
 assert.equal(grade('say_again_slowly',0,'Could you repeat that?'),true);
 assert.equal(grade('pay_by_card',0,'Can I pay by card?'),true);assert.equal(grade('pay_by_card',0,'Can I pay in cash?'),false);
 assert.equal(grade('can_you',22,'Can you turn off the light?'),false);
 assert.equal(grade('can_i_get',4,'Can I get three tickets?'),false);
 assert.equal(run('basicCoreItems(TRAVEL_BY_ID.travel_can_i_leave).find(x=>x._sourceIndex===4)._answerKo'),'제 짐을 여기 맡겨도 될까요?');
});

test('saved short mistakes retain beginner explanations while older extended mistakes keep their full meaning',()=>{
 const {run}=setup();run(`const mistakes=missBuildItems([{fid:'travel_say_again_slowly',en:'Could you say that again?',ko:'다시 말해달라고 부탁해보세요.'},{fid:'travel_can_i_leave',en:'Can I leave my bags here until evening?',ko:'저녁까지 맡겨도 되는지 물어보세요.'}]);`);
 assert.equal(run('mistakes[0].ex._tier'),1);assert.equal(run('mistakes[0].frame.frame'),'Could you say that again?');assert.doesNotMatch(run('mistakes[0].frame.tip'),/slowly/);
 assert.equal(run('travelGrade(mistakes[0],"Could you repeat that?").ok'),true);
 assert.equal(run('mistakes[1].ex.en'),'Can I leave my bags here until evening?');assert.equal(run('travelGrade(mistakes[1],"Can I leave my bags here?").ok'),false);
});

test('exactly the nine selected expressions are stored in stage 2 and never sampled by stage 1',()=>{
 const {run}=setup();const expected=['travel_how_long','travel_what_time_does','travel_what_time_need','travel_problem_with','travel_think_i_left','travel_how_much_longer','travel_whats_difference','travel_what_does_mean','travel_what_should_i_do'];
 assert.deepEqual(Array.from(run('TRAVEL_STAGE2_FRAMES.map(f=>f.id)')).sort(),expected.sort());assert.equal(run('TRAVEL_FRAMES.length'),23);
 for(const difficulty of [1,15,35,60]){
   run(`const d${difficulty}=alGet();d${difficulty}.speak=${difficulty};alSave(d${difficulty});`);
   assert.equal(run('travelBuildItems(100).some(it=>TRAVEL_STAGE2_IDS.has(it.frame.id))'),false);
 }
 assert.equal(run('travelBuildItems(10,TRAVEL_STAGE2_FRAMES).length'),0);
 assert.equal(run('travelBuildItems(30,TRAVEL_ALL_FRAMES).some(it=>TRAVEL_STAGE2_IDS.has(it.frame.id))'),false);
 assert.equal(run('travelPoolOf([...TRAVEL_STAGE2_IDS]).length'),0);
});

test('old selections and mistakes from stage 2 are hidden without deleting their records or XP',()=>{
 const seed={
   'speakingroom:travel_study':'["travel_can_i_get","travel_how_long"]',
   'speakingroom:travelrepeat':'{"travel_how_long":{"seen":20,"ok":18,"introduced":true}}',
   'speakingroom:travel_miss':'{"How long does it take?":{"fid":"travel_how_long","miss":2},"Can I get water?":{"fid":"travel_can_i_get","miss":1}}',
   'speakingroom:prof':'{"xp":150}'
 };
 const {run,records}=setup(seed);assert.deepEqual(Array.from(run('travelStudyGet()')),['travel_can_i_get']);
 assert.equal(run('missList().length'),1);assert.equal(run('missBuildItems([{fid:"travel_how_long",en:"How long does it take?"}]).length'),0);
 assert.equal(run('TRAVEL_BY_ID.travel_how_long.items.length'),26);assert.equal(run('practiceReward().total'),150);
 for(const key of Object.keys(seed))assert.equal(records.get(key),seed[key]);
});

test('the core tutorial shows a familiar whole sentence and keeps first-look, recall and playback guidance',()=>{
 const {run}=setup({'speakingroom:feature_guide:v3:basic':'true'});
 assert.equal(run('FEATURE_GUIDES.basic.revision'),4);assert.equal(run('hGet(featureGuideKey("basic"),false)'),false);
 const demo=run('featureGuideDemo("familiar-phrase")');assert.match(demo,/이름이 뭐예요/);assert.match(demo,/What's your name\?/);assert.doesNotMatch(demo,/what your name\?/i);
 assert.match(run('FEATURE_GUIDES.basic.steps[0][1]'),/한 덩어리/);assert.equal(run('FEATURE_GUIDES.basic.steps[1][2]'),'first-recall');assert.match(run('featureGuideDemo("answer-tools")'),/내 목소리 듣기/);
});
