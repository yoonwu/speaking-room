const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Summary=require('../../practice-session.js');
const key=Summary.normalizeSentence;
function answer(en,id,extra={}){return {en,ko:'예문 뜻',fid:'travel_can_i_get',attemptId:id,attemptGroupId:id,ok:true,xp:30,timingVersion:2,tapMs:1000,speechStartDelayMs:500,responseMs:1500,tapWithinThreeSeconds:true,speechWithinOnePointFiveSeconds:true,withinThreeSeconds:true,speedEligible:true,...extra};}
function snapshot({profileId='legacy',xpTotal,masteryRows={},expressionScores={}}={}){return {profileId,...(xpTotal===undefined?{}:{xpTotal}),masteryRows,expressionScores};}
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}

test('an empty or early-ended session reports its supplied completion state without invented achievements',()=>{
 const empty=Summary.build({completed:false,totalPlanned:10});assert.equal(empty.completed,false);assert.equal(empty.totalPlanned,10);assert.equal(empty.attempts,0);assert.equal(empty.uniqueSentences,0);assert.equal(empty.xp,0);assert.equal(empty.counts.improved,0);assert.deepEqual(empty.wellDone,[]);assert.deepEqual(empty.needsPractice,[]);
 const early=Summary.build({results:[answer('Can I get water?','one')],completed:false,totalPlanned:10});assert.equal(early.completed,false);assert.equal(early.attemptedQuestions,1);assert.equal(early.counts.fullCorrect,1);assert.equal(early.counts.firstFastExpressions,1);assert.equal(early.counts.improved,0);
 assert.equal(Summary.build({completed:true,totalPlanned:0}).completed,true,'the caller determines whether the fixed lesson was finished');
});

test('sentence normalization deduplicates punctuation and repeated planned questions while attempt IDs protect XP',()=>{
 const first=answer("I’m from Korea.",'one',{attemptGroupId:'question-one',xp:15}),duplicate={...first,xp:999},second=answer("  I'M FROM KOREA!  ",'two',{attemptGroupId:'question-two',xp:0,retry:true});
 const summary=Summary.build({results:[first,duplicate,second,null,{en:'',attemptId:'empty',xp:100}]});assert.equal(summary.attempts,2);assert.equal(summary.uniqueSentences,1);assert.equal(summary.attemptedQuestions,2);assert.equal(summary.attemptXP,15);assert.equal(summary.xp,15);assert.equal(summary.sentences[0].questions,2);assert.equal(summary.sentences[0].attempts,2);assert.equal(summary.sentences[0].xp,15);assert.equal(summary.sentences[0].allFullCorrect,true);assert.equal(key("I’m from Korea."),key("I'M FROM KOREA!"));
});

test('full answers, pattern-only answers, wrong answers and retry recovery remain separate unique-sentence outcomes',()=>{
 const results=[
  answer('Recovered sentence.','a1',{ok:false,xp:0,attemptGroupId:'a'}),answer('Recovered sentence.','a2',{ok:false,expressionOnly:true,xp:5,retry:true,recall:true,attemptGroupId:'a'}),answer('Recovered sentence.','a3',{xp:0,retry:true,recall:true,attemptGroupId:'a'}),
  answer('Still difficult.','b1',{ok:false,expressionOnly:true,xp:10,tapMs:3500,responseMs:4000,tapWithinThreeSeconds:false,withinThreeSeconds:false,attemptGroupId:'b'}),answer('Still difficult.','b2',{ok:false,xp:0,retry:true,attemptGroupId:'b'}),
  answer('Only the expression.','c',{ok:false,expressionOnly:true,xp:15}),answer('All words correct.','d'),answer('Typed correct answer.','e',{typed:true,xp:15})
 ];
 const summary=Summary.build({results}),rows=Object.fromEntries(summary.sentences.map(row=>[row.en,row]));assert.equal(summary.uniqueSentences,5);assert.equal(summary.attempts,8);assert.equal(summary.attemptedQuestions,5);assert.equal(summary.counts.fullCorrect,3);assert.equal(summary.counts.allFullCorrect,2);assert.equal(summary.counts.partial,1);assert.equal(summary.counts.wrong,1);assert.equal(summary.counts.recovered,1);assert.equal(summary.counts.unresolved,2);assert.equal(summary.counts.firstFastExpressions,2);
 assert.equal(rows['Recovered sentence.'].firstOutcome,'wrong');assert.equal(rows['Recovered sentence.'].finalOutcome,'full');assert.equal(rows['Recovered sentence.'].recovered,true);assert.equal(rows['Recovered sentence.'].allFullCorrect,false);assert.equal(rows['Only the expression.'].hasFullCorrect,false);assert.equal(rows['Only the expression.'].firstFastExpression,true);assert.equal(rows['Only the expression.'].unresolved,true);assert.equal(rows['Typed correct answer.'].firstUnaidedExpression,false);
 assert.deepEqual(summary.recovered.map(row=>row.en),['Recovered sentence.']);assert.deepEqual(summary.needsPractice.map(row=>row.en),['Still difficult.','Only the expression.']);assert.deepEqual(summary.wellDone.map(row=>row.en),['All words correct.','Typed correct answer.']);assert.equal(summary.challenging.length,3);
});

test('first-fast expression evidence uses both v2 intervals and never promotes intro, hint, typed, recall or retry answers',()=>{
 const cases=[
  [{tapMs:3000,speechStartDelayMs:1500,responseMs:4500},true,true],
  [{tapMs:3001,speechStartDelayMs:100,responseMs:3101,tapWithinThreeSeconds:false,withinThreeSeconds:false},false,true],
  [{tapMs:100,speechStartDelayMs:1501,responseMs:1601,speechWithinOnePointFiveSeconds:false,withinThreeSeconds:false},false,true],
  [{timingVersion:1,fast:true,perfect:true},false,false],
  [{speechStartDelayMs:null,fast:true},false,false],[{speedEligible:false},false,false],
  ...['intro','hinted','typed','recall','retry'].map(flag=>[{[flag]:true},false,false])
 ];
 for(const [extra,fast,unaided]of cases){const summary=Summary.build({results:[answer('A sentence.','one',extra)]});assert.equal(summary.sentences[0].firstFastExpression,fast,JSON.stringify(extra));assert.equal(summary.sentences[0].firstUnaidedExpression,unaided,JSON.stringify(extra));}
 const retry=Summary.build({results:[answer('Only later fast.','first',{ok:false,xp:0}),answer('Only later fast.','retry',{retry:true,xp:5})]});assert.equal(retry.counts.firstFastExpressions,0);assert.equal(retry.counts.recovered,1);
});

test('improvement requires real prior seen history and a higher after score for a practiced sentence',()=>{
 const old='Known sentence.',fresh='First encounter.',zeroSeen='Unseen placeholder.',missingAfter='No after history.';
 const baseline=snapshot({masteryRows:{[key(old)]:{en:old,seen:2,score:18},[key(zeroSeen)]:{en:zeroSeen,seen:0,score:0},[key(missingAfter)]:{en:missingAfter,seen:1,score:10}}});
 const after=snapshot({masteryRows:{[key(old)]:{en:old,seen:3,score:28},[key(fresh)]:{en:fresh,seen:1,score:18},[key(zeroSeen)]:{en:zeroSeen,seen:1,score:18},unrelated:{en:'Not practiced here.',seen:20,score:100}}});
 const summary=Summary.build({results:[old,fresh,zeroSeen,missingAfter].map((en,i)=>answer(en,String(i))),baseline,after});assert.deepEqual(summary.improved.map(row=>row.en),[old]);assert.equal(summary.improved[0].scoreDelta,10);assert.deepEqual(summary.newlyPracticed.map(row=>row.en),[fresh,zeroSeen]);assert.equal(summary.sentences.find(row=>row.en===fresh).scoreDelta,null);assert.equal(summary.sentences.find(row=>row.en===missingAfter).improved,false);assert.equal(summary.sentences.find(row=>row.en===missingAfter).afterScore,null);assert.equal(summary.uniqueSentences,4);
});

test('expression score changes distinguish an observed zero from an absent past and ignore unrelated expression changes',()=>{
 const baseline=snapshot({expressionScores:{known:0,unchanged:8,falling:8,invalid:NaN}}),after=snapshot({expressionScores:{known:2,fresh:2,unchanged:8,falling:6,invalid:2,unrelated:10}});
 const summary=Summary.build({results:['known','fresh','unchanged','falling','invalid'].map((fid,i)=>answer('Sentence '+i,String(i),{fid})),baseline,after});const changes=Object.fromEntries(summary.expressionChanges.map(row=>[row.fid,row]));
 assert.equal(changes.known.improved,true);assert.equal(changes.known.delta,2);assert.equal(changes.fresh.beforeScore,null);assert.equal(changes.fresh.improved,false);assert.equal(changes.fresh.isNew,true);assert.equal(changes.falling.delta,-2);assert.equal(changes.invalid.improved,false);assert.equal(changes.invalid.isNew,false,'unknown invalid history is not claimed as new history');assert.equal(changes.unrelated,undefined);assert.equal(summary.counts.improvedExpressions,1);assert.deepEqual(summary.newExpressionProgress.map(row=>row.fid),['fresh']);
});

test('actual profile XP delta includes the real bonus while duplicate attempt delivery contributes once',()=>{
 const result=answer('Can I get water?','one'),summary=Summary.build({results:[result,{...result}],baseline:snapshot({xpTotal:100}),after:snapshot({xpTotal:155})});assert.equal(summary.xp,55);assert.equal(summary.attemptXP,30);assert.equal(summary.bonusXP,25);assert.equal(summary.xpSource,'snapshot');assert.equal(summary.attempts,1);
 const capped=Summary.build({results:[result,answer('Another sentence.','two')],baseline:snapshot({xpTotal:100}),after:snapshot({xpTotal:115})});assert.equal(capped.attemptXP,60);assert.equal(capped.xp,15,'actual total delta takes precedence over separately reported attempt amounts');assert.equal(capped.bonusXP,0);
 const decrease=Summary.build({results:[result],baseline:snapshot({xpTotal:100}),after:snapshot({xpTotal:90})});assert.equal(decrease.xp,0);assert.equal(decrease.bonusXP,0);
});

test('missing snapshots use deduplicated actual result XP without guessing bonuses or prior improvement',()=>{
 const result=answer('Can I get water?','one',{xp:15}),summary=Summary.build({results:[result,result],after:snapshot({xpTotal:999,masteryRows:{[key(result.en)]:{en:result.en,seen:1,score:18}}})});assert.equal(summary.xp,15);assert.equal(summary.xpSource,'results');assert.equal(summary.bonusXP,0);assert.equal(summary.counts.improved,0);assert.equal(summary.counts.newlyPracticed,0);
});

test('profile-mismatched snapshots cannot manufacture XP or improvements and foreign results are ignored',()=>{
 const en='Known sentence.',baseline=snapshot({profileId:'a',xpTotal:10,masteryRows:{[key(en)]:{en,seen:1,score:10}},expressionScores:{known:2}}),after=snapshot({profileId:'b',xpTotal:1000,masteryRows:{[key(en)]:{en,seen:10,score:100}},expressionScores:{known:10}});
 const summary=Summary.build({results:[answer(en,'own',{profileId:'a',fid:'known',xp:15}),answer('Foreign answer.','foreign',{profileId:'b',xp:500})],baseline,after});assert.equal(summary.profileMismatch,true);assert.equal(summary.uniqueSentences,1);assert.equal(summary.xp,15);assert.equal(summary.xpSource,'results');assert.equal(summary.counts.improved,0);assert.equal(summary.counts.improvedExpressions,0);assert.equal(summary.counts.newExpressionProgress,0);
});

test('building a summary is pure and never returns heard transcripts, audio, credentials or arbitrary source metadata',()=>{
 const en='Can I get water?',input=freeze({results:[answer(en,'one',{heard:'PRIVATE_TRANSCRIPT_MARKER',audioBase64:'PRIVATE_AUDIO_MARKER',recordingBlob:{bytes:'PRIVATE_RECORDING_MARKER'},authorization:'PRIVATE_TOKEN_MARKER'})],baseline:snapshot({xpTotal:0,masteryRows:{[key(en)]:{en,seen:1,score:10}}}),after:snapshot({xpTotal:30,masteryRows:{[key(en)]:{en,seen:2,score:28}}}),completed:true,totalPlanned:5});
 const before=JSON.stringify(input),summary=Summary.build(input);assert.equal(JSON.stringify(input),before);assert.deepEqual(Summary.build(input),summary);assert.doesNotMatch(JSON.stringify(summary),/PRIVATE_|heard|audioBase64|recordingBlob|authorization/);assert.equal(summary.improved[0].scoreDelta,18);assert.equal(summary.completed,true);
});

test('the browser global works without accessing DOM, storage, network or any other app script',()=>{
 const context={localStorage:{getItem(){throw Error('unexpected storage');}},fetch(){throw Error('unexpected fetch');}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../practice-session.js'),'utf8'),context);const result=vm.runInContext(`PracticeSessionSummary.build({results:[{en:'Hello.',ok:true,xp:15}],completed:false,totalPlanned:3})`,context);assert.equal(result.uniqueSentences,1);assert.equal(result.xp,15);assert.equal(result.completed,false);
});
