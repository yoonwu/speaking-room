/* Session-only summaries. Inputs come from the lesson and profile snapshots;
   this helper never reads storage, awards points, or retains recorded answers. */
(function(global){
  'use strict';
  const own=(value,key)=>!!value&&Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  const nonnegative=value=>Number.isFinite(value)&&value>=0?value:null;
  const score=(value,max)=>Number.isFinite(value)&&value>=0&&value<=max?value:null;
  const text=value=>typeof value==='string'?value.trim():'';
  const normalizeSentence=value=>text(value).toLowerCase().replace(/’/g,"'").replace(/[^a-z0-9' ]/g,' ').replace(/\s+/g,' ').trim();
  const outcome=result=>result.ok===true?'full':result.expressionOnly===true?'partial':'wrong';
  function unaidedVoice(result){
    return result.timingVersion===2&&result.speedEligible===true&&!result.intro&&!result.hinted&&!result.typed&&!result.recall&&!result.retry&&nonnegative(result.responseMs)!==null&&nonnegative(result.tapMs)!==null&&nonnegative(result.speechStartDelayMs)!==null;
  }
  function fastExpression(result){
    return outcome(result)!=='wrong'&&unaidedVoice(result)&&result.withinThreeSeconds===true&&result.tapWithinThreeSeconds===true&&result.speechWithinOnePointFiveSeconds===true&&result.tapMs<=3000&&result.speechStartDelayMs<=1500;
  }
  function masteryIndex(snapshot){
    const out=new Map();
    for(const [key,value]of Object.entries(object(snapshot?.masteryRows)||{})){
      if(!object(value))continue;const normalized=normalizeSentence(value.en)||normalizeSentence(key);
      if(normalized)out.set(normalized,value);
    }
    return out;
  }
  function build(input={}){
    input=object(input)||{};
    const baseline=object(input.baseline),after=object(input.after),beforeProfile=text(baseline?.profileId),afterProfile=text(after?.profileId);
    const profileMismatch=!!(beforeProfile&&afterProfile&&beforeProfile!==afterProfile);
    const comparable=!!(baseline&&after&&!profileMismatch&&((!beforeProfile&&!afterProfile)||(beforeProfile&&beforeProfile===afterProfile)));
    const expectedProfile=beforeProfile||afterProfile,seenAttempts=new Set(),questions=new Set(),grouped=new Map();
    let attempts=0,attemptXP=0;
    for(const result of Array.isArray(input.results)?input.results:[]){
      if(!object(result))continue;const en=text(result.en),key=normalizeSentence(en),attemptId=text(result.attemptId),profileId=text(result.profileId);
      if(!key||(expectedProfile&&profileId&&profileId!==expectedProfile)||attemptId&&seenAttempts.has(attemptId))continue;
      if(attemptId)seenAttempts.add(attemptId);
      const question=text(result.attemptGroupId)||'sentence:'+key,xp=nonnegative(result.xp)||0;
      questions.add(question);attempts++;attemptXP+=xp;
      let row=grouped.get(key);
      if(!row){row={key,en,ko:text(result.ko),fid:text(result.fid),results:[],questions:new Set(),xp:0};grouped.set(key,row);}
      if(!row.ko)row.ko=text(result.ko);if(!row.fid)row.fid=text(result.fid);
      row.results.push(result);row.questions.add(question);row.xp+=xp;
    }
    const beforeMastery=masteryIndex(baseline),afterMastery=masteryIndex(after);
    const sentences=[...grouped.values()].map(group=>{
      const first=group.results[0],last=group.results[group.results.length-1],outcomes=group.results.map(outcome),finalOutcome=outcome(last);
      const before=beforeMastery.get(group.key),current=afterMastery.get(group.key);
      const beforeScore=comparable&&Number(before?.seen)>0?score(before.score,100):null,afterScore=comparable&&Number(current?.seen)>0?score(current.score,100):null;
      const scoreDelta=beforeScore!==null&&afterScore!==null?afterScore-beforeScore:null;
      return {key:group.key,en:group.en,ko:group.ko,fid:group.fid,attempts:group.results.length,questions:group.questions.size,xp:group.xp,
        firstOutcome:outcome(first),finalOutcome,firstFullCorrect:first.ok===true,allFullCorrect:outcomes.every(value=>value==='full'),hasFullCorrect:outcomes.includes('full'),hasPartial:outcomes.includes('partial'),hasWrong:outcomes.includes('wrong'),
        firstFastExpression:fastExpression(first),firstUnaidedExpression:outcome(first)!=='wrong'&&unaidedVoice(first),
        intro:group.results.some(result=>result.intro===true),hinted:group.results.some(result=>result.hinted===true),typed:group.results.some(result=>result.typed===true),recall:group.results.some(result=>result.recall===true),
        recovered:finalOutcome==='full'&&outcomes.slice(0,-1).some(value=>value!=='full'),unresolved:finalOutcome!=='full',
        beforeScore,afterScore,scoreDelta,improved:scoreDelta!==null&&scoreDelta>0,newlyPracticed:comparable&&(!before||Number(before.seen)<=0)&&afterScore!==null};
    });
    const expressionIds=new Set();for(const group of grouped.values())for(const result of group.results)if(text(result.fid))expressionIds.add(text(result.fid));
    const beforeExpressions=object(baseline?.expressionScores)||{},afterExpressions=object(after?.expressionScores)||{};
    const expressionChanges=[...expressionIds].map(fid=>{
      const beforeScore=comparable&&own(beforeExpressions,fid)?score(beforeExpressions[fid],10):null,afterScore=comparable&&own(afterExpressions,fid)?score(afterExpressions[fid],10):null;
      const delta=beforeScore!==null&&afterScore!==null?afterScore-beforeScore:null;
      return {fid,beforeScore,afterScore,delta,improved:delta!==null&&delta>0,isNew:comparable&&!own(beforeExpressions,fid)&&afterScore!==null};
    });
    const wellDone=sentences.filter(row=>row.allFullCorrect),needsPractice=sentences.filter(row=>row.unresolved),challenging=sentences.filter(row=>row.hasPartial||row.hasWrong),recovered=sentences.filter(row=>row.recovered),improved=sentences.filter(row=>row.improved),newlyPracticed=sentences.filter(row=>row.newlyPracticed);
    const newExpressionProgress=expressionChanges.filter(row=>row.isNew&&row.afterScore>0);
    const snapshotXP=comparable&&nonnegative(baseline.xpTotal)!==null&&nonnegative(after.xpTotal)!==null;
    const xp=snapshotXP?Math.max(0,after.xpTotal-baseline.xpTotal):attemptXP;
    return {completed:input.completed===true,totalPlanned:Number.isFinite(input.totalPlanned)?Math.max(0,Math.floor(input.totalPlanned)):0,attempts,attemptedQuestions:questions.size,uniqueSentences:sentences.length,
      xp,attemptXP,bonusXP:snapshotXP?Math.max(0,xp-attemptXP):0,xpSource:snapshotXP?'snapshot':'results',profileMismatch,
      counts:{firstFastExpressions:sentences.filter(row=>row.firstFastExpression).length,fullCorrect:sentences.filter(row=>row.finalOutcome==='full').length,allFullCorrect:wellDone.length,partial:sentences.filter(row=>row.finalOutcome==='partial').length,wrong:sentences.filter(row=>row.finalOutcome==='wrong').length,recovered:recovered.length,unresolved:needsPractice.length,improved:improved.length,newlyPracticed:newlyPracticed.length,improvedExpressions:expressionChanges.filter(row=>row.improved).length,newExpressionProgress:newExpressionProgress.length},
      sentences,wellDone,needsPractice,challenging,recovered,improved,newlyPracticed,expressionChanges,newExpressionProgress};
  }
  const api=Object.freeze({build,normalizeSentence});
  global.PracticeSessionSummary=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
