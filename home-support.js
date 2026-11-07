/* Original adaptive-level logic; home and supporting features for four practice modes. */
// The default learner keeps the historical keys byte-for-byte. Additional
// learners use a namespace; names and sync nicknames are labels, not login IDs.
const LEARNING_ACTIVE='speakingroom:learning_active_v1',LEARNING_PROFILES='speakingroom:learning_profiles_v1';
const SENTENCE_MASTERY='speakingroom:sentence_mastery_v1';
const learningRawGet=hGet,learningRawSet=hSet;
const LEARNING_KEYS=new Set(['speakingroom:travelrepeat','speakingroom:travelrepeat:lastFrame','speakingroom:travel_study','speakingroom:travel_miss','speakingroom:travel_count','speakingroom:autolvl','speakingroom:name','speakingroom:prof','speakingroom:practice_log_v1','speakingroom:compact_quest','speakingroom:practice_xpbase','speakingroom:answer_vocab','speakingroom:compact_sync_enabled','speakingroom:sync_nick','speakingroom:sync_name','speakingroom:sync_t',SENTENCE_MASTERY]);
function learningProfileId(){const id=learningRawGet(LEARNING_ACTIVE,'legacy'),profiles=learningRawGet(LEARNING_PROFILES,{})||{};return id==='legacy'||typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&Object.prototype.hasOwnProperty.call(profiles,id)?id:'legacy';}
function learningProfileKey(key,id=learningProfileId()){return id==='legacy'||(!LEARNING_KEYS.has(key)&&!/^speakingroom:(pronunciation|grading)_/.test(key))?key:'speakingroom:learner:'+id+':'+key;}
hGet=function(key,fallback){return learningRawGet(learningProfileKey(key),fallback);};
hSet=function(key,value){return learningRawSet(learningProfileKey(key),value);};
function learningLocalGet(key){return localStorage.getItem(learningProfileKey(key));}
function learningLocalSet(key,value){localStorage.setItem(learningProfileKey(key),value);}
function learningNewAttemptId(){return window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function learningProfileList(){const saved=learningRawGet(LEARNING_PROFILES,{});return [{id:'legacy',name:learningRawGet('speakingroom:name','')||'기존 학습자'},...Object.entries(saved||{}).filter(([id,p])=>id!=='legacy'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&p&&typeof p==='object').map(([id,p])=>({id,name:learningRawGet(learningProfileKey('speakingroom:name',id),p.name)||'학습자'}))];}
function learningProfileCreate(name){name=String(name||'').trim().slice(0,12);if(!name)throw Error('학습자 이름을 입력해주세요.');const id='p_'+learningNewAttemptId(),profiles=learningRawGet(LEARNING_PROFILES,{})||{};profiles[id]={name,createdAt:Date.now()};learningRawSet(LEARNING_PROFILES,profiles);learningRawSet(learningProfileKey('speakingroom:name',id),name);return id;}
function learningProfileSwitch(id){if(!learningProfileList().some(p=>p.id===id))throw Error('학습자를 찾지 못했어요.');if(id===learningProfileId())return id;if(typeof goToSetup==='function')goToSetup();else{if(typeof stopMicrophone==='function')stopMicrophone();if(typeof svStop==='function')svStop();}clearTimeout(supportSyncTimer);learningRawSet(LEARNING_ACTIVE,id);if(typeof learningProfileChanged==='function')learningProfileChanged(id);if(typeof renderHome==='function')renderHome();return id;}
function learningSentenceKey(en){return String(en||'').toLowerCase().replace(/’/g,"'").replace(/[^a-z0-9' ]/g,' ').replace(/\s+/g,' ').trim();}
let learningMasteryCache={};
function learningMasteryRows(profileId=learningProfileId()){
 const raw=localStorage.getItem(learningProfileKey(SENTENCE_MASTERY,profileId))||'';
 if(learningMasteryCache.raw===raw&&learningMasteryCache.profileId===profileId)return learningMasteryCache.rows;
 let data;try{data=JSON.parse(raw);}catch(_){data={};}const rows=Object.create(null);
 for(const event of Object.values(data?.events||{}).filter(e=>e&&typeof e.en==='string'&&Number.isFinite(e.t)&&Number.isFinite(e.delta)).sort((a,b)=>a.t-b.t||(a.order||0)-(b.order||0)||String(a.id).localeCompare(String(b.id)))){
  const key=learningSentenceKey(event.en);if(!key)continue;const row=rows[key]||(rows[key]={score:0,seen:0,correct:0,misses:0,missStreak:0,lastT:0});
  row.score=Math.max(0,Math.min(100,row.score+Math.max(-20,Math.min(20,event.delta))));row.seen++;if(event.ok){row.correct++;row.missStreak=0;}else{row.misses++;row.missStreak++;}row.lastT=Math.max(row.lastT,event.t);
 }
 learningMasteryCache={raw,profileId,rows};return rows;
}
function learningSentenceMastery(en,profileId=learningProfileId()){return {...(learningMasteryRows(profileId)[learningSentenceKey(en)]||{score:0,seen:0,correct:0,misses:0,missStreak:0,lastT:0})};}
function learningSentenceWeight(en,now=Date.now()){
 const row=learningSentenceMastery(en);if(!row.seen)return 4;
 const days=Math.max(0,(now-row.lastT)/86400000);
 if(row.score>80)return .08+Math.min(3,Math.max(0,days-7)/15);
 return (1.2+(80-row.score)/80*1.8)*(1+Math.min(5,row.missStreak)*.6+Math.min(5,row.misses)*.1);
}
function learningRecordMastery(event,id){const data=hGet(SENTENCE_MASTERY,{version:1,events:{}})||{},events=data.events||{};if(events[id])return;const en=String(event.en||'');if(!en)return;events[id]={id,en,t:event.t,order:event.order||0,ok:!!event.ok,retry:!!event.retry,delta:event.ok?(event.retry?4:event.perfect&&!event.intro?18:10):-20};hSet(SENTENCE_MASTERY,{version:1,events});}
const AL_KEY="speakingroom:autolvl";
const AL_SKILLS=["word","listen","block","speed","speak"];
const AL_TOAST={
  word:{up:"📈 단어가 좋아져서 조금 더 어려워져요",down:"🌱 단어를 살짝 쉽게 갈게요"},
  listen:{up:"👂 귀가 트여서 듣기가 조금 어려워져요",down:"🌱 듣기를 살짝 쉽게 갈게요"},
  block:{up:"🧱 블록이 안정돼서 조금 더 어려워져요",down:"🌱 블록 연습을 살짝 쉽게 갈게요"},
  speed:{up:"⚡ 빨라져서 제한이 살짝 빡빡해져요",down:"🌱 시간 여유를 조금 더 줄게요"},
  speak:{up:"🗣 말이 늘어서 문장이 조금 길어져요",down:"🌱 문장을 살짝 짧게 갈게요"}
};
function alGet(){
  let d=null; try{ d=hGet(AL_KEY,null); }catch(e){}
  if(!d || typeof d!=="object" || d.word==null){
    const base=Math.max(1,Math.min(60,Math.round(Number(state.lvl)||1)));
    d={word:base, listen:base, block:base, speed:base, st:{}};
    try{ hSet(AL_KEY,d); }catch(e){}
  }
  if(!d.st) d.st={};
  /* 🗣 speak 는 나중에 추가된 능력이다. 없던 사람은 블록 실력에서 이어받는다.
     (안 그러면 그동안 해온 사람이 D1부터 다시 시작하게 된다) */
  if(d.speak==null){
    d.speak=Math.max(1,Math.min(60, d.block||d.word||1));
    d.placed=d.placed||{}; if(d.placed.block) d.placed.speak=true;
    d.base=d.base||{}; if(d.base.speak==null) d.base.speak=d.speak;
    try{ hSet(AL_KEY,d); }catch(e){}
  }
  // 🚀 빠른 시작 배치 필드 — 없으면 배치 모드 시작(신규/기존 모두 첫 문제들로 초기 레벨을 빠르게 잡음)
  if(!d.n){ d.n={}; d.placed=d.placed||{}; d.base={word:d.word,listen:d.listen,block:d.block,speed:d.speed}; try{ hSet(AL_KEY,d); }catch(e){} }
  d.placed=d.placed||{};d.placed.speak=true;d.placed.speed=true;
  return d;
}
function alProbeLevel(skill){
  const d=alGet();
  if(d.placed && d.placed[skill]) return d[skill];
  const i=(d.n&&d.n[skill])||0;
  const pm=((d.pm||{})[skill])||0;        // 배치 중 miss 누적
  const lastMiss=!!((d.lm||{})[skill]);   // 직전 문제 miss 여부
  const LADDER=[3,12,24,6,36];   // 완전 초보 배려: D3로 시작해 성공 경험 먼저
  let v = i<LADDER.length ? LADDER[i] : Math.max(6,(d[skill]||1)) + (i%2===1?4:0);   // 이후: 현재 레벨 + 약간의 탐색
  if(pm>=2) v=Math.min(v,8);              // 초반 miss 2회+ → 쉬운 문제 중심으로 안정화
  if(lastMiss) v=Math.min(v,6);           // 틀린 직후엔 반드시 쉬운 문제 (연속 어려움 금지)
  return Math.max(1, Math.min(60, v));
}
function alSave(d){ try{ hSet(AL_KEY,d); }catch(e){} }
function autoLvlRecord(skill, kind){
  try{
    if(AL_SKILLS.indexOf(skill)<0) return;
    const d=alGet();
    // 🚀 배치 모드: 사다리 탐색 — 탐색 문제를 perfect로 맞히면 그 근처로 즉시 점프
    if(!(d.placed&&d.placed[skill])){
      const q=alProbeLevel(skill);   // 이 문제가 출제된 탐색 레벨 (n 증가 전 = 출제 시점과 동일)
      d.pm=d.pm||{}; d.lm=d.lm||{};
      if(kind==="perfect"){
        const floor = q>=36?24 : q>=24?16 : q>=12?8 : 0;   // 한 번 맞힌 것만으로 과하게 올리지 않음
        d[skill]=Math.min(60, Math.max((d[skill]||1)+2, floor));
        d.lm[skill]=false;
      } else if(kind==="miss" || kind==="hardmiss"){
        d[skill]=Math.max(1,(d[skill]||1)-(kind==="hardmiss"?3:2));
        d.pm[skill]=(d.pm[skill]||0)+1;
        d.lm[skill]=true;            // 다음 문제는 쉬운 걸로 (실패감 완화)
      } else {
        d.lm[skill]=false;
      }
      d.n[skill]=(d.n[skill]||0)+1;
      const risen=(d[skill]||1)-(((d.base||{})[skill])||1);
      // 종료: 샘플 10개 or (탐색 5문제 이상 + 충분한 상승) — D36 탐색까지는 돌게
      if((d.n[skill]||0)>=10 || ((d.n[skill]||0)>=5 && risen>=8)){ d.placed=d.placed||{}; d.placed[skill]=true; }
      alSave(d);
      try{ renderAutoLvlStatus(); }catch(e){}
      return;   // 배치 중엔 일반 스트릭·토스트 생략 (조용히)
    }
    const st=d.st[skill]||{up:0,miss:0,run:0};
    let delta=0;
    // 잘하면 빨리 올리고(4연속), 막히면 훨씬 빨리 내린다(2연속부터, 계속 막히면 더 크게).
    // 예전엔 3연속 실패마다 -1이라 D23에서 입문까지 60번 실패해야 했음.
    /* 승급은 '연속'이 아니라 '최근 정답률'로 판단한다.
       예전엔 완벽 4연속이 필요해서, 중간에 한 번만 삐끗해도 쌓은 게 전부 날아갔다.
       4문제 중 3개를 맞히면(75%) 실력이 는 것이 맞으므로 그때 올린다.
       완벽/보통(다시 듣기 사용)을 구분하지 않는다 — 맞혔으면 맞힌 것이다.
       내려가는 규칙은 그대로 둔다: 어려우면 빨리 쉬워져야 한다. */
    st.hist = Array.isArray(st.hist) ? st.hist : [];
    const isMiss = (kind==="miss" || kind==="hardmiss");
    // 한 번에 맞힌 것(perfect)과 힌트·재시도 끝에 맞힌 것(ok)을 점수로 구분한다.
    // 둘 다 '맞힘'이지만, 크게 뛰어올리는 건 한 번에 맞혔을 때만.
    st.hist.push(isMiss ? 0 : (kind==="perfect" ? 1 : 0.85));
    if(st.hist.length>6) st.hist.shift();       // 최근 6문제만 본다
    /* 틀렸다고 난이도를 쭉쭉 떨어뜨리지 않는다.
       예전엔 연속으로 막히면 한 번에 -4까지 떨어져서, 어렵다 싶으면 순식간에
       hat·sun 수준까지 되돌아갔다. 못 맞히면 '안 올리면' 되는 것이지
       배운 걸 되돌릴 이유가 없다. 내리는 건 아래 정답률 창에서 최대 -1만. */
    if(isMiss){ st.miss=(st.miss||0)+1; st.up=0; st.run=(st.run||0)+1; }
    else { st.miss=0; st.run=0; }
    /* 올리는 폭은 '얼마나 잘하는지'에 비례한다.
       예전엔 아무리 잘해도 4문제마다 +1이 최대라, 12문제를 전부 맞혀도 하루 +3.
       매크로 밴드 하나가 6이라 나흘을 다 맞혀도 단어 수준이 두 밴드밖에 못 움직였다. */
    if(delta===0 && st.hist.length>=4){
      const rate=st.hist.reduce((a,c)=>a+c,0)/st.hist.length;
      if(rate>=0.99)     delta=3;    // 4문제를 전부 한 번에 맞힘 — 지금 난이도가 확실히 쉽다
      else if(rate>=0.7) delta=2;    // 4문제 중 3개 또는 힌트로 다 맞힘 — 잘 따라오고 있다
      else if(rate<=0.4) delta=-1;   // 너무 어려울 때만 한 칸. 되돌리는 게 아니라 숨 고르기
      // 절반(2/4)은 지금 난이도가 맞는 구간 — 그대로 둔다
      if(delta) st.hist=[];          // 바뀐 난이도에서 다시 센다
    }
    d.st[skill]=st;
    /* 한 번 도달한 수준 아래로는 한 밴드(6) 넘게 내려가지 않는다.
       하루 못했다고 처음부터 다시 시작하게 만들면 쌓은 게 사라진다. */
    d.best=d.best||{};
    if((d[skill]||1) > (d.best[skill]||0)) d.best[skill]=d[skill];
    if(delta){
      const cur=d[skill]||1;
      let nv=cur+delta;
      if(delta<0){
        // 바닥은 '더 내려가지 않게' 막는 용도다. 이미 바닥보다 낮으면 그 자리를 지킬 뿐,
        // 바닥까지 끌어올리지는 않는다.
        const floor=Math.max(1,(d.best[skill]||1)-6);
        nv=Math.max(nv, Math.min(floor, cur));
      }
      nv=Math.max(1, Math.min(60, nv));
      if(nv!==d[skill]){ d[skill]=nv; try{ bleShowHintToast(AL_TOAST[skill][delta>0?"up":"down"]); }catch(e){} }
    }
    alSave(d);
    try{ renderAutoLvlStatus(); }catch(e){}
  }catch(e){}
}
function getAutoLevels(){
  const d=alGet();
  const lv=k=>{ if(d.placed&&d.placed[k]) return d[k]||1; try{ return alProbeLevel(k); }catch(e){ return d[k]||1; } };
  const word=lv("word"), listen=lv("listen"), block=lv("block"), speed=lv("speed"), speak=lv("speak");
  return { wordLevel:word, listenLevel:listen, blockRecallLevel:block, speedLevel:speed, speakLevel:speak,
           overallLevel:Math.max(1,Math.min(60,Math.round(word*0.25+listen*0.25+block*0.3+speed*0.2))) };
}
const PRACTICE_LOG='speakingroom:practice_log_v1';
const SUPPORT_DAY=()=>new Date().toLocaleDateString('sv-SE');
const SYNC_KEYS=[TRAVEL_KEY,TRAVEL_STUDY_KEY,MISS_KEY,'speakingroom:autolvl','speakingroom:name',PRACTICE_LOG,'speakingroom:compact_quest','speakingroom:practice_xpbase',SENTENCE_MASTERY,'speakingroom:pronunciation_mode_v1'];
let supportSyncBusy=false;
function supportLog(){return hGet(PRACTICE_LOG,{})||{};}
function supportEvents(){return Object.values(supportLog()).filter(e=>e&&Number.isFinite(e.t)).sort((a,b)=>a.t-b.t);}
function supportStats(){
  const records=Object.values(travelAll()).filter(x=>x&&typeof x==='object');
  const total=records.reduce((n,r)=>n+(Number(r.seen)||0),0),right=records.reduce((n,r)=>n+(Number(r.ok)||0),0);
  const events=supportEvents(),voice=events.filter(e=>Number.isFinite(e.reaction)&&!e.typed);
  const allTravel=travelAll(),automatic=TRAVEL_FRAMES.filter(f=>(allTravel[f.id]||{}).streak>=3).length;
  const days=[...new Set(events.map(e=>new Date(e.t).toLocaleDateString('sv-SE')))];
  let streak=0,date=new Date();if(!days.includes(SUPPORT_DAY()))date.setDate(date.getDate()-1);
  while(days.includes(date.toLocaleDateString('sv-SE'))){streak++;date.setDate(date.getDate()-1);}
  return {total,right,accuracy:total?Math.round(right/total*100):null,automatic,voice,streak,events};
}
function supportToday(){const q=hGet('speakingroom:compact_quest',{});return q.date===SUPPORT_DAY()?q:{date:SUPPORT_DAY(),travel:0,miss:0,talk:0};}
function supportBump(kind){const q=supportToday();q[kind]=(q[kind]||0)+1;hSet('speakingroom:compact_quest',q);}
function recordPractice({it,heard,ok,perfect,meta={},started=Date.now(),mode,attemptGroupId,attemptId,profileId=learningProfileId(),retry=false}){
  if(profileId!==learningProfileId()){it._earnedXP=0;return {ignored:true};}
  const log=supportLog(),id='attempt:'+String(attemptId||learningNewAttemptId()),group=String(attemptGroupId||it._attemptGroupId||learningNewAttemptId());
  if(log[id]){learningRecordMastery(log[id],id);it._earnedXP=0;return {duplicate:true,xp:0};}
  const previous=Object.values(log).filter(e=>e&&e.rewardVersion===2&&e.attemptGroupId===group);
  const isRetry=previous.length>0||retry;
  const firstWrong=previous.some(e=>e.firstWrong)||(!previous.length&&!ok);
  const cap=previous.length?Math.min(...previous.map(e=>Number(e.rewardCap)||0)):(firstWrong||isRetry?5:ok?15+(perfect?5:0):5);
  const awarded=previous.reduce((n,e)=>n+Math.max(0,Number(e.xp)||0),0);
  const xp=ok?Math.max(0,Math.min(cap-awarded,firstWrong||isRetry?5:15+(perfect?5:0))):0;
  const reaction=meta.speechStartAt?Math.max(0,(meta.speechStartAt-started-travelReadMs(it))/1000):null;
  const order=Object.values(log).reduce((n,e)=>Math.max(n,Number(e?.order)||0),0)+1;
  log[id]={t:Date.now(),order,fid:it.frame.id,en:it.ex.en,ok,perfect,intro:!!it._intro,retry:isRetry,attemptGroupId:group,rewardVersion:2,rewardCap:cap,firstWrong,typed:!!meta.typed,reaction,seconds:Math.min(90,Math.max(1,(Date.now()-started)/1000)),kind:mode==='자주 틀리는 문장'?'miss':'travel',xp};
  if(perfect&&!it._intro&&!it.recall&&it.ex._tier)log[id].curriculumTier=it.ex._tier;
  const before=practiceReward();
  if(mode==='기본표현')supportBump('travel');else if(mode==='자주 틀리는 문장')supportBump('miss');
  const bonus=mode==='기본표현'&&supportToday().travel>=10&&!supportEvents().some(e=>new Date(e.t).toLocaleDateString('sv-SE')===SUPPORT_DAY()&&e.dailyBonus)?25:0;
  if(bonus)log['dailyBonus:'+SUPPORT_DAY()]={t:Date.now(),kind:'dailyBonus',xp:0,dailyBonus:bonus};
  if(perfect&&!it._intro&&!it.recall&&heard){const expected=new Set(practiceWords(it.ex.en));log[id].words=practiceWords(heard).filter(w=>expected.has(w));}
  hSet(PRACTICE_LOG,log);learningRecordMastery(log[id],id);const after=practiceReward();it._earnedXP=xp;
  it._rewardMessage='+'+xp+' XP'+(bonus?' · 오늘의 10회 목표 +25 XP':'')+(after.level>before.level?' · 레벨 업! Lv.'+after.level:'');
  autoLvlRecord('speak',perfect?'perfect':ok?'ok':'miss');
  if(reaction!==null&&!meta.typed)autoLvlRecord('speed',perfect&&reaction<=3?'perfect':ok?'ok':'miss');
  supportQueueSync();
  return {xp,bonus,mastery:learningSentenceMastery(it.ex.en)};
}
let supportTalkAt=Date.now();
function recordAiPractice(){const log=supportLog(),id=Date.now()+'-'+Math.random();log[id]={t:Date.now(),kind:'talk',seconds:Math.min(90,Math.max(1,(Date.now()-supportTalkAt)/1000))};supportTalkAt=Date.now();hSet(PRACTICE_LOG,log);supportBump('talk');supportQueueSync();}
function aiLevelInstruction(){const n=alGet().speak;return n<15?'Use very short beginner English, one sentence and one question at a time.':n<35?'Use everyday English, one or two short sentences and one natural question at a time.':'Use natural everyday English with occasional follow-up details, at most three sentences and one question at a time.';}
// A short sentence can still contain a new clause. Review grammar and require
// successful unaided recall of this expression before adding a detail.
const originalTravelPickItem=travelPickItem;
function learningPickItem(f,o){
  if(!f.items.some(ex=>learningSentenceMastery(ex.en).seen))return originalTravelPickItem(f,o);
  const weights=f.items.map(ex=>learningSentenceWeight(ex.en));let draw=Math.random()*weights.reduce((n,w)=>n+w,0),pick=f.items[f.items.length-1];
  for(let i=0;i<f.items.length;i++){draw-=weights[i];if(draw<0){pick=f.items[i];break;}}
  const st=o[f.id]||(o[f.id]={seen:0,ok:0,miss:0,lastT:0});st.used=[...new Set([...(Array.isArray(st.used)?st.used:[]),pick.ko])];st.lastKo=pick.ko;return pick;
}
function basicCurriculumStage(f,context){
  const n=context?.n??alGet().speak,events=(context?.events||supportEvents()).filter(e=>e.fid===f.id&&e.perfect);
  if(n<15||events.filter(e=>e.curriculumTier===1).length<3)return 1;
  return n>=35&&events.filter(e=>e.curriculumTier===2).length>=3?3:2;
}
function learningEligibleItems(f,options={},context){
  const n=context?.n??alGet().speak,limit=n<15?8:n<35?12:Infinity;
  const core=basicCoreItems(f);
  if(core){
    if(options.introduce)return [basicStarterItem(f)];
    const stage=basicCurriculumStage(f,context),catalog=basicCurriculumCatalog(f);
    const candidates=stage===1?core:[...catalog.filter(x=>x._tier<=stage&&x.en.trim().split(/\s+/).length<=(stage===2?12:Infinity)),...core.filter(x=>x._answerKo)];
    return candidates;
  }
  const candidates=f.items.filter(x=>x.en.trim().split(/\s+/).length<=limit);
  return candidates.length?candidates:f.items;
}
travelPickItem=function(f,o,options={}){
  const next={...f,items:learningEligibleItems(f,options)};
  return options.introduce?originalTravelPickItem(next,o):learningPickItem(next,o);
};
// Keep the established frame-cost scheduler, while charging mastered frames
// more for each appearance. Otherwise a one-sentence frame would stay frequent.
const learningOriginalFrameWeight=travelWeightFor,learningOriginalFramePicker=travelPickFrames;
let learningFrameWeightSnapshot=null;
function learningFrameCostFactor(f,context){const items=learningEligibleItems(f,{},context);if(!items.length||!items.some(ex=>learningSentenceMastery(ex.en).seen))return 1;const mean=items.reduce((n,ex)=>n+learningSentenceWeight(ex.en),0)/items.length;return Math.max(.25,Math.min(12,3/mean));}
travelWeightFor=function(id,stat){const f=TRAVEL_BY_ID[id],factor=learningFrameWeightSnapshot?.get(id)??(f?learningFrameCostFactor(f):1);return learningOriginalFrameWeight(id,stat)*factor;};
travelPickFrames=function(n,pool){const previous=learningFrameWeightSnapshot,context={n:alGet().speak,events:supportEvents()};learningFrameWeightSnapshot=new Map((pool||TRAVEL_FRAMES).map(f=>[f.id,learningFrameCostFactor(f,context)]));try{return learningOriginalFramePicker(n,pool);}finally{learningFrameWeightSnapshot=previous;}};
function learningRewardEvents(events){
 const caps=Object.create(null),used=Object.create(null);for(const e of events)if(e.rewardVersion===2&&e.attemptGroupId)caps[e.attemptGroupId]=Math.min(caps[e.attemptGroupId]??Infinity,Math.max(0,Number(e.rewardCap)||0));
 return events.map(e=>{let xp=Math.max(0,Number(e.xp)||0);if(e.rewardVersion===2&&e.attemptGroupId){const group=e.attemptGroupId;xp=Math.min(xp,Math.max(0,caps[group]-(used[group]||0)));used[group]=(used[group]||0)+xp;}return {...e,xp};});
}
function practiceReward(){
  let base=hGet('speakingroom:practice_xpbase',null);
  if(base===null){base=Math.max(0,Number((hGet('speakingroom:prof',{})||{}).xp)||0);hSet('speakingroom:practice_xpbase',base);}
  const events=supportEvents(),bonuses={};for(const e of events){const day=new Date(e.t).toLocaleDateString('sv-SE');bonuses[day]=Math.max(bonuses[day]||0,Number(e.dailyBonus)||0);}
  const rewarded=learningRewardEvents(events),earned=rewarded.reduce((n,e)=>n+e.xp,0)+Object.values(bonuses).reduce((n,v)=>n+v,0);
  const total=Math.max(0,Number(base)||0)+earned;let level=1,remaining=total,need=100;
  while(remaining>=need&&level<10000){remaining-=need;level++;need=100+(level-1)*50;}
  const today=rewarded.filter(e=>new Date(e.t).toLocaleDateString('sv-SE')===SUPPORT_DAY());
  return {total,level,remaining,need,todayXP:today.reduce((n,e)=>n+(Number(e.xp)||0),0)+(bonuses[SUPPORT_DAY()]||0),todayCount:today.filter(e=>e.fid).length};
}
function renderReward(){const r=practiceReward(),s=supportStats();$('#rewardZone').innerHTML=`<div class="reward-top"><div><span class="reward-label">쌓아온 연습</span><b>Lv.${r.level}<small>학습 레벨</small></b></div><span class="xp-total">${r.total.toLocaleString()}<small>총 XP</small></span></div><div class="xp-track"><i style="width:${Math.round(r.remaining/r.need*100)}%"></i></div><div class="xp-next"><span>다음 레벨까지 ${r.need-r.remaining} XP</span><b>${r.remaining} / ${r.need}</b></div><div class="reward-stats"><span>오늘 <b>${r.todayCount}회</b></span><span>오늘 <b>+${r.todayXP} XP</b></span><span>누적 <b>${s.total}회</b></span></div>`;if($('#coreDifficulty'))$('#coreDifficulty').textContent='기본표현 D'+alGet().speak;}
function basicDifficultyLabel(n=alGet().speak,tier){return '기본표현 D'+n+' · '+(tier===1?'짧은 핵심 문장':tier===2?'정보를 하나씩 더하기':tier===3?'조건까지 말해보기':n<15?'짧은 문장부터':n<35?'문장을 조금 더 길게':'다양한 길이의 문장');}
const WORD_SUCCESS_GOAL=3;
function practiceWords(text){return [...new Set((String(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[]).filter(w=>w.length>1&&!TRAVEL_SKIP_WORDS.has(w)&&!TRAVEL_FILLER_WORDS.has(w)))];}
function supportWordStats(){const counts={};for(const event of supportEvents()){if(!event.perfect||!Array.isArray(event.words))continue;for(const word of new Set(event.words)){if(typeof word==='string'&&/^[a-z]+(?:'[a-z]+)?$/.test(word))counts[word]=(counts[word]||0)+1;}}return Object.entries(counts).map(([word,count])=>({word,count})).sort((a,b)=>b.count-a.count||a.word.localeCompare(b.word));}
function openLearnedWords(){const ov=openSheet('익숙해진 단어'),words=supportWordStats(),learned=words.filter(w=>w.count>=WORD_SUCCESS_GOAL),growing=words.filter(w=>w.count<WORD_SUCCESS_GOAL);ov.querySelector('#sheetContent').innerHTML=`<p class="muted">연습 예문에 나오는 단어를 표현이나 힌트 없이 바로 맞힌 답변에서 ${WORD_SUCCESS_GOAL}회 이상 사용하면 여기에 쌓여요. 한 답변에서 반복한 단어는 한 번만 세고, a·the 같은 문법 단어는 제외해요.</p><div class="word-total">${learned.length}<small>개 단어가 익숙해졌어요</small></div>${learned.length?'<div class="learned-word-list">'+learned.map(w=>'<div class="learned-word"><b>'+escapeHtml(w.word)+'</b><span>바로 맞힘 '+w.count+'회 ✓</span></div>').join('')+'</div>':'<p class="empty">기본표현을 반복하면 익숙해진 단어가 쌓여요.</p>'}${growing.length?'<div class="prof-h">조금만 더 연습하면 익숙해져요</div>'+growing.map(w=>'<div class="growing-word"><b>'+escapeHtml(w.word)+'</b><span>'+w.count+' / '+WORD_SUCCESS_GOAL+'회</span></div>').join(''):''}`;}
function supportName(){return hGet('speakingroom:name','')||learningLocalGet('speakingroom:sync_name')||'친구';}
function renderAutoLvlStatus(){if($('#autoLvlLine'))$('#autoLvlLine').textContent='말하기 D'+alGet().speak+' · 속도 D'+alGet().speed;}
function renderSupportHome(){
  const s=supportStats(),q=supportToday(),d=alGet(),done=q.travel>=10;
  const learnedWords=supportWordStats().filter(w=>w.count>=WORD_SUCCESS_GOAL);
  renderReward();
  $('#profileBtn').textContent=supportName().slice(0,1);
  $('#coreStartLabel').textContent=done?'한 번 더 10회 연습':'10회 연습 시작';
  $('#coreToday').innerHTML=`<span>${done?'오늘의 목표 완료 ✓':'오늘의 연습'} <b>${Math.min(10,q.travel||0)} / 10회</b></span><span class="core-progress"><i style="width:${Math.min(100,(q.travel||0)/10*100)}%"></i></span>`;
  $('#growthZone').innerHTML=`<div class="panel-title"><span>🌱 말하기가 쌓이고 있어요</span><button id="growthDetail" class="quiet">기록 보기 ›</button></div><div class="growth-grid"><div><b>${s.accuracy===null?'—':s.accuracy+'%'}</b><span>기본표현 정답률</span></div><div><b>${s.automatic}<small>개</small></b><span>익숙해진 표현</span></div><button id="learnedWords" class="word-stat"><b>${learnedWords.length}<small>개</small></b><span>익숙해진 단어 ›</span></button><div><b>${s.total}<small>번</small></b><span>누적 말하기 연습</span></div></div><div class="adaptive-line"><span>말하기 난이도 · 자동 조절</span><b id="autoLvlLine">말하기 D${d.speak} · 속도 D${d.speed}</b></div><p class="routine-sub">답변에 맞춰 문장 길이와 듣기 속도를 조절해요.</p>`;
  $('#growthDetail').onclick=openGrowth;$('#learnedWords').onclick=openLearnedWords;
  $('#syncSummary').textContent=learningLocalGet('speakingroom:sync_nick')?'연결됨 · 기록 관리 ›':'기기 간 이어서 ›';
}
function openGrowth(){const ov=openSheet('실력 · 성장 기록'),s=supportStats(),voice=s.voice.slice(-20);const reaction=voice.length?voice.reduce((n,e)=>n+e.reaction,0)/voice.length:null;
  ov.querySelector('#sheetContent').innerHTML=`<div class="stat-grid"><div class="stat"><span class="se">🎯</span><div><div class="sv">${s.accuracy===null?'—':s.accuracy+'%'}</div><div class="sl">누적 정답률</div></div></div><div class="stat"><span class="se">⚡</span><div><div class="sv">${reaction===null?'—':reaction.toFixed(1)+'초'}</div><div class="sl">최근 말 시작 시간</div></div></div></div><p class="muted">말 시작 시간은 음성 입력의 최근 20회 기준이며, 상황을 읽는 예상 시간을 제외한 값이에요. 직접 입력은 포함하지 않아요.</p><div class="prof-h">표현별 숙련도</div>${TRAVEL_FRAMES.map(f=>{const r=travelStat(f.id),pct=Math.min(100,(r.streak||0)/3*100);return `<div class="mastery-row"><div><b>${escapeHtml(f.frame)}</b><small>${r.ok||0}번 정답 · ${r.miss||0}번 오답</small></div><div class="mastery-track"><i style="width:${pct}%"></i></div></div>`;}).join('')}`;
}
function openProfile(){const ov=openSheet('내 프로필'),s=supportStats();ov.querySelector('#sheetContent').innerHTML=`<div class="profile-heading"><div class="prof-av">${escapeHtml(supportName().slice(0,1))}</div><div><b>${escapeHtml(supportName())}님</b><small>Lv.${practiceReward().level} · ${practiceReward().total} XP · ${s.total}번 연습 · 기본표현 D${alGet().speak}</small></div></div><label class="field-label" for="learningProfile">학습자</label><select id="learningProfile" class="auto-input">${learningProfileList().map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===learningProfileId()?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select><p class="muted">학습자마다 학습 기록과 숙련도를 따로 저장해요. 기존 기록은 ‘기존 학습자’에 그대로 남아요.</p><input id="newLearningProfile" class="auto-input" maxlength="12" placeholder="새 학습자 이름"><button id="addLearningProfile" class="quiet">학습자 추가</button><p id="learningProfileStatus" class="muted" role="status"></p><label class="field-label" for="profileName">앱에서 부를 이름</label><input id="profileName" class="auto-input" maxlength="12" value="${escapeHtml(supportName())}"><button id="saveName" class="primary">이름 저장</button><section id="pronunciationSettings"></section><div class="prof-h">나의 영어</div><button id="profileGrowth" class="tut-li">🌱 실력 · 성장 기록 <span>›</span></button><button id="profileRank" class="tut-li">🏆 랭킹 <span>›</span></button><div class="prof-h">계정 · 기기 연동</div><button id="profileSync" class="tut-li">☁️ 기록 동기화 <span>›</span></button><div class="prof-h">시작 안내 · 튜토리얼</div><button id="profileGuide" class="tut-li">📖 처음 사용법 다시 보기 <span>›</span></button>`;
  ov.querySelector('#learningProfile').onchange=e=>{learningProfileSwitch(e.target.value);ov.remove();openProfile();};
  ov.querySelector('#addLearningProfile').onclick=()=>{try{const id=learningProfileCreate(ov.querySelector('#newLearningProfile').value);learningProfileSwitch(id);ov.remove();openProfile();}catch(e){ov.querySelector('#learningProfileStatus').textContent=e.message;}};
  if(typeof renderPronunciationSettings==='function')renderPronunciationSettings(ov.querySelector('#pronunciationSettings'));
  ov.querySelector('#saveName').onclick=()=>{hSet('speakingroom:name',ov.querySelector('#profileName').value.trim().slice(0,12)||'친구');ov.remove();renderHome();supportQueueSync();};
  for(const [id,fn]of [['profileGrowth',openGrowth],['profileRank',openRank],['profileSync',openSync],['profileGuide',openTutorial]])ov.querySelector('#'+id).onclick=fn;
}
const GUIDE=[['✈️','먼저 기본표현부터','상황을 읽고 영어로 말해보세요. 처음에는 표현을 보여주고, 다음부터는 상황만 보고 기억에서 꺼내요.'],['↻','틀린 문장은 한 번 더','틀린 문장은 잠시 뒤 다시 나와요. 답을 본 뒤에는 ‘가리고 다시 말하기’로 입에 붙이고, 오답 목록에서도 반복할 수 있어요.'],['✓','필요한 표현만 골라요','‘골라서 연습’에서 약한 표현을 선택하세요. 자주 틀리는 문장은 연속 3번 맞히면 오답 목록에서 빠져요.'],['💬','실제 대화로 이어가요','AI 실전회화에서 상황을 골라 주고받아보세요. 막히면 도움말을 쓰고, 연습 기록은 프로필에서 확인해요.']];
function openTutorial(){let index=0;let previousPose=null;const ov=openSheet('처음 사용법');const paint=()=>{const [ico,title,text]=GUIDE[index];ov.querySelector('#sheetContent').innerHTML=`<div class="guide-card"><div class="onb-badge">${ico}</div><div class="onb-dots">${GUIDE.map((_,i)=>`<span class="onb-dot ${i===index?'on':''}"></span>`).join('')}</div><small>${index+1} / ${GUIDE.length}</small><h3>${title}</h3><p class="guide-story">${text}</p></div><div class="guide-actions">${index?'<button id="guideBack" class="quiet">이전</button>':''}<button id="guideNext" class="primary">${index===GUIDE.length-1?'연습 시작하기':'다음'}</button></div>`;if(index)ov.querySelector('#guideBack').onclick=()=>{index--;paint();};ov.querySelector('#guideNext').onclick=()=>{if(index===GUIDE.length-1){hSet('speakingroom:compact_guide_seen',true);ov.remove();}else{index++;paint();}};};paint();}
function supportMergeLog(a,b){const out={...a};for(const [k,v]of Object.entries(b||{}))if(v&&typeof v==='object'&&Number.isFinite(v.t))out[k]=v;return out;}
function supportMergeTravel(a,b){const out={...a};for(const [k,v]of Object.entries(b||{})){if(!v||typeof v!=='object')continue;const own=out[k];if(!own){out[k]=v;continue;}const recent=(v.lastT||0)>(own.lastT||0)?v:own;out[k]={...recent,seen:Math.max(own.seen||0,v.seen||0),ok:Math.max(own.ok||0,v.ok||0),miss:Math.max(own.miss||0,v.miss||0),introduced:!!(v.introduced||own.introduced),used:[...new Set([...(own.used||[]),...(v.used||[])])]};}return out;}
function supportApplySnapshot(data,profileId=learningProfileId()){if(profileId!==learningProfileId())return false;for(const key of SYNC_KEYS){if(typeof data[key]!=='string')continue;let remote;try{remote=JSON.parse(data[key]);}catch(_){continue;}const local=hGet(key,null);if(key===SENTENCE_MASTERY)remote={version:1,events:supportMergeLog(local?.events||{},remote?.events||{})};else if(key===PRACTICE_LOG)remote=supportMergeLog(local||{},remote);else if(key===TRAVEL_KEY)remote=supportMergeTravel(local||{},remote);else if(key===MISS_KEY){const out={...local};for(const [en,r]of Object.entries(remote||{}))if(r&&typeof r==='object'&&(!out[en]||(r.lastT||0)>(out[en].lastT||0)))out[en]=r;remote=out;for(const [en,r]of Object.entries(remote)){const f=(hGet(TRAVEL_KEY,{})||{})[r.fid];if(f&&(f.lastT||0)>=(r.lastT||0)&&(f.streak||0)>=3)delete remote[en];}}else if(key==='speakingroom:compact_quest'){if(local&&local.date===remote.date)remote={...remote,travel:Math.max(local.travel||0,remote.travel||0),miss:Math.max(local.miss||0,remote.miss||0),talk:Math.max(local.talk||0,remote.talk||0)};else if(local&&local.date>remote.date)remote=local;}else if(key==='speakingroom:practice_xpbase'){remote=Math.max(Number(local)||0,Number(remote)||0);}else if(key==='speakingroom:autolvl'&&local){remote={...local,...remote};}hSet(key,remote);}return true;}
function supportCollect(){const data={};for(const key of SYNC_KEYS){const v=learningLocalGet(key);if(v!==null)data[key]=v;}return data;}
function supportRankingSummary(){const s=supportStats(),now=Date.now(),week=s.events.filter(e=>e.t>=now-7*86400000),old=hGet('speakingroom:prof',{})||{};return {name:supportName(),xp:practiceReward().total,lv:practiceReward().level,week:learningRewardEvents(s.events).filter(e=>e.t>=now-7*86400000).reduce((n,e)=>n+e.xp,0),streak:s.streak,blocks:s.automatic,lvl:alGet().speak,mins:Math.round(week.reduce((n,e)=>n+(e.seconds||0),0)/60),allMins:Math.round(s.events.reduce((n,e)=>n+(e.seconds||0),0)/60)};}
async function supportSync(nick){if(supportSyncBusy)throw Error('다른 동기화가 진행 중이에요.');const profileId=learningProfileId();supportSyncBusy=true;try{
 const response=await fetch(PROXY_URL+'/u?n='+encodeURIComponent(nick),{cache:'no-store'});if(!response.ok)throw Error('기록을 불러오지 못했어요 ('+response.status+').');const saved=await response.json();
 if(profileId!==learningProfileId())throw Error('학습자가 변경되어 동기화를 멈췄어요.');
 const existing=saved.d&&typeof saved.d==='object'?saved.d:{};supportApplySnapshot(existing,profileId);
 // Preserve unrelated historical server records without collecting other local storage or login tokens.
 const d={...existing,...supportCollect()},t=Date.now();const res=await fetch(PROXY_URL+'/u?n='+encodeURIComponent(nick),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t,d,sum:supportRankingSummary()})});if(!res.ok)throw Error('기록을 저장하지 못했어요 ('+res.status+').');if(profileId!==learningProfileId())throw Error('학습자가 변경되어 동기화를 마무리하지 않았어요.');learningLocalSet('speakingroom:sync_t',String(t));renderHome();return t;
 }finally{supportSyncBusy=false;}}
let supportSyncTimer;
function supportQueueSync(){const nick=learningLocalGet('speakingroom:sync_nick'),profileId=learningProfileId();if(!nick||!hGet('speakingroom:compact_sync_enabled',false))return;clearTimeout(supportSyncTimer);supportSyncTimer=setTimeout(()=>{if(profileId!==learningProfileId())return;supportSync(nick).catch(()=>{if($('#syncSummary'))$('#syncSummary').textContent='저장 대기 · 다시 연결 ›';});},4000);}
function openSync(){const ov=openSheet('기록 동기화'),nick=learningLocalGet('speakingroom:sync_nick')||'';
 ov.querySelector('#sheetContent').innerHTML=`<div class="sync-cloud">☁️</div><h3>어디서든 이어서 연습해요</h3><p class="muted">다른 기기에서도 같은 닉네임을 입력하면 학습 기록을 불러와 합쳐요. 닉네임은 로그인 비밀번호가 아니므로 다른 사람이 추측하기 어려운 별명을 사용하세요.</p><label for="syncNickname" class="field-label">연동 닉네임</label><input id="syncNickname" class="auto-input" maxlength="24" value="${escapeHtml(nick)}" placeholder="나만 알아볼 별명"><p class="muted">연결하면 학습 기록이 기존 동기화 서버에 저장되고, 표시 이름과 학습 통계는 랭킹에 공개돼요. ChatGPT 로그인 정보와 대화 내용은 보내지 않아요.</p><button id="syncConnect" class="primary">기록 연결 · 동기화</button>${nick?'<button id="syncDisconnect" class="quiet">이 기기 자동 동기화 끄기</button>':''}<p id="syncStatus" role="status" class="muted">${learningLocalGet('speakingroom:sync_t')?'마지막 저장: '+new Date(Number(learningLocalGet('speakingroom:sync_t'))).toLocaleString('ko-KR'):''}</p>`;
 ov.querySelector('#syncConnect').onclick=async()=>{const input=ov.querySelector('#syncNickname'),name=input.value.trim().toLowerCase().replace(/\s+/g,'').slice(0,24);if(!name){ov.querySelector('#syncStatus').textContent='닉네임을 입력해주세요.';return;}const btn=ov.querySelector('#syncConnect');btn.disabled=true;ov.querySelector('#syncStatus').textContent='기록을 불러와 합치는 중…';try{await supportSync(name);learningLocalSet('speakingroom:sync_nick',name);learningLocalSet('speakingroom:sync_name',name);hSet('speakingroom:compact_sync_enabled',true);ov.querySelector('#syncStatus').textContent='연결됐어요. 연습한 기록은 자동으로 저장돼요.';renderHome();}catch(e){ov.querySelector('#syncStatus').textContent=e.message;}finally{btn.disabled=false;}};
 if(nick)ov.querySelector('#syncDisconnect').onclick=()=>{hSet('speakingroom:compact_sync_enabled',false);clearTimeout(supportSyncTimer);ov.querySelector('#syncStatus').textContent='이 기기에서 자동 동기화를 껐어요. 학습 기록은 남아 있어요.';};
}
async function openRank(){const ov=openSheet('랭킹');let rows=[],tab='mins',error='';const tabs=[['mins','이번 주 시간','분'],['allMins','누적 시간','분'],['blocks','익숙한 표현','개'],['streak','연속 학습','일']];
 const paint=()=>{if(!ov.isConnected)return;const selected=tabs.find(t=>t[0]===tab),sorted=[...rows].sort((a,b)=>(b[tab]||0)-(a[tab]||0));ov.querySelector('#sheetContent').innerHTML=`<p class="muted">각자 쌓은 연습 기록을 함께 봐요. 기록 동기화를 연결하면 랭킹에 참여해요.</p><div class="rank-tabs">${tabs.map(([k,t])=>`<button data-rank-tab="${k}" class="${tab===k?'active':''}">${t}</button>`).join('')}</div>${error?`<p class="notice">${escapeHtml(error)}</p>`:''}<div class="rank-list">${sorted.length?sorted.map((r,i)=>`<div class="rank-row ${r.n===learningLocalGet('speakingroom:sync_nick')?'mine':''}"><span class="rank-place">${i<3?['🥇','🥈','🥉'][i]:i+1}</span><b>${escapeHtml(String(r.name||r.n||'친구'))}</b><strong>${Number(r[tab])||0}<small>${selected[2]}</small></strong></div>`).join(''):'<p class="empty">아직 표시할 기록이 없어요.</p>'}</div><button id="rankSync" class="quiet">내 기록 연결하기 ›</button>`;ov.querySelectorAll('[data-rank-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.rankTab;paint();});ov.querySelector('#rankSync').onclick=openSync;};
 ov.querySelector('#sheetContent').innerHTML='<p class="muted" role="status">랭킹을 불러오고 있어요…</p>';
 try{const r=await fetch(PROXY_URL+'/board',{cache:'no-store'});if(!r.ok)throw Error('랭킹을 불러오지 못했어요 ('+r.status+').');const data=await r.json();rows=Array.isArray(data)?data:[];}catch(e){error=e.message;}paint();
}
$('#profileBtn').onclick=openProfile;$('#tutorialBtn').onclick=openTutorial;$('#rankBtn').onclick=openRank;$('#syncBtn').onclick=openSync;
renderSupportHome();
/* A brief first-use guide per feature. These device-local flags never enter sync. */
const FEATURE_GUIDES={
 basic:{icon:'⚡',title:'기본표현',revision:4,cta:'내 입에 붙일 첫 한마디 →',steps:[
  ['이 한마디는, 바로 떠오르죠?','what은 의문사, your은 소유격…\n말할 때마다 하나씩 조립하진 않죠.\n익숙한 문장이 한 덩어리로 떠올라요.','familiar-phrase'],
  ['그렇게 나오는 말을 늘려봐요','3초영어는 짧은 표현을 내 입으로 반복해,\n상황을 만나면 꺼내 말하는 연습을 하는 곳이에요.\n\n처음엔 보고 말하고, 다음엔 가리고 말해요.','first-recall'],
  ['하루 10번, 내 입에 한마디씩','막히면 단어 힌트나 표현 보기를 눌러요.\n확인한 뒤에는 가리고 다시 말해봐요.\n\n읽고 아는 데서, 꺼내 말하는 데까지.\n삼초랑 짧은 한마디부터 입에 붙여봐요.','answer-tools']
 ]},
 study:{icon:'✓',title:'골라서 연습',steps:[['이 표현만 자꾸 막히나요?','지금 필요한 표현, 입에 잘 안 붙는 표현만 골라봐요. 여러 개를 함께 선택할 수 있어요.'],['선택한 표현으로만 반복해요','연습하기를 누르고 문제 수를 고르면 체크한 표현만 나와요. 기본표현과 같은 방식으로 말하고, 틀린 문장은 다시 연습해요.']]},
 miss:{icon:'↻',title:'자주 틀리는 문장',steps:[['아까 못 꺼낸 말, 다시 해볼까요?','막혔던 문장은 내가 모아둘게요. 답을 읽는 데서 멈추지 말고, 이번엔 직접 꺼내봐요.'],['연속 3번 맞히면 졸업해요','틀린 문장 반복하기를 눌러 연습하세요. 한 문장을 연속 3번 맞히면 목록에서 빠져요.']]},
 ai:{icon:'💬',title:'AI 실전회화',steps:[['연습한 한마디로 대화를 이어봐요','상황을 고르면 상대가 먼저 말을 걸어요. 완벽한 문장을 만들려고 오래 고민하지 말고, 전하고 싶은 뜻부터 말해봐요.'],['막히면 도움을 받아요','막혔어요에서 예시 답변을, 내 표현 확인에서 교정을 볼 수 있어요. Android의 ChatGPT 연결과 음성 대화는 이 화면에서 사용해요.']]},
 growth:{icon:'🌱',title:'실력 · 성장 기록',steps:[['조금씩 쌓인 연습, 눈으로 볼까요?','오늘 꺼내본 말이 기록으로 남아요. 연습 횟수와 정답률, 연속 3번 맞혀 익숙해진 표현을 확인해봐요.'],['말 시작 시간은 음성 답변으로 봐요','최근 20회의 음성 답변을 기준으로 상황 읽는 예상 시간을 제외해 보여줘요. 직접 입력은 말 시작 시간에 포함하지 않아요.']]},
 words:{icon:'📚',title:'익숙해진 단어',steps:[['내가 직접 꺼낸 단어들이에요','예문에 나온 단어를 힌트 없이 맞힌 답변에서 3회 사용하면 여기에 쌓여요. 문장 속에서 직접 써본 단어를 확인해봐요.'],['아직 쌓이는 중인 단어도 보여요','1~2회 맞힌 단어와 3회 이상 맞힌 단어를 구분해서 볼 수 있어요. 답을 보고 따라 한 경우와 한 답변 안의 중복은 세지 않아요.']]},
 xp:{icon:'⭐',title:'학습 레벨 · 경험치',steps:[['꺼낸 한마디가 쌓여요','처음 정답이면 15 XP, 힌트 없이 맞히면 20 XP예요. 처음 틀린 문제는 다시 맞혀도 재시도 전체를 합쳐 최대 5 XP예요. 오늘 기본표현 10회의 +25 XP는 문제 점수와 별도로 받아요.'],['학습 레벨과 D 난이도는 달라요','학습 레벨은 연습량을 보여주고, 기본표현 D는 답변 결과에 맞춘 문장 난이도예요. 틀려도 얻은 XP와 학습 레벨은 줄지 않아요.']]},
 profile:{icon:'☺',title:'내 프로필',steps:[['나의 기록을 한곳에서 봐요','앱에서 부를 이름을 바꾸고, 학습 레벨과 경험치, 성장 기록을 확인할 수 있어요.'],['필요한 안내를 다시 볼 수 있어요','랭킹과 기록 동기화로 이동하거나 처음 사용법을 다시 열어 각 기능의 안내를 볼 수 있어요.']]},
 rank:{icon:'🏆',title:'랭킹',steps:[['함께 쌓은 기록을 봐요','이번 주와 누적 학습 시간, 익숙한 표현, 연속 학습 기록을 비교할 수 있어요.'],['기록 동기화로 참여해요','연결한 표시 이름과 학습 통계가 랭킹에 공개돼요. 내 기록을 연결하지 않아도 랭킹을 확인할 수 있어요.']]},
 sync:{icon:'☁️',title:'기록 동기화',steps:[['같은 닉네임으로 이어서 해요','다른 기기에서 같은 닉네임을 입력하면 기존 서버의 학습 기록을 불러와 합쳐요. 추측하기 어려운 별명을 사용하세요.'],['무엇이 저장되는지 확인해요','연결하면 학습 기록을 서버에 저장하고 표시 이름과 요약 통계를 랭킹에 공개해요. ChatGPT 로그인 정보와 대화 내용은 보내지 않아요. 자동 동기화를 꺼도 기존 기록은 남아 있어요.']]}
};
const SAMCHO_POSES={welcome:'mascot-welcome.png',explain:'mascot-guide.png',listen:'mascot-listen.png',cheer:'mascot-cheer.png'};
function samchoGuidePose(id,index,total){if(index===0)return 'welcome';if(id==='ai'||id==='sync')return 'listen';return index===total-1?'cheer':'explain';}
function featureGuideKey(id){return 'speakingroom:feature_guide:v'+(FEATURE_GUIDES[id]?.revision||2)+':'+id;}
function featureGuideDemo(kind){
 if(kind==='familiar-phrase')return `<div class="guide-familiar"><div class="familiar-cue"><span>이름을 물어보고 싶을 때</span><p>이름이 뭐예요?</p></div><span class="familiar-arrow" aria-hidden="true">↓</span><div class="familiar-answer"><span>입에서 나오는 한마디</span><b lang="en">What's your name?</b></div><p class="familiar-note">바로 떠올랐다면, 그 감각을<br>다른 표현으로 넓혀봐요.</p><div class="familiar-goal">아는 영어 말고, <strong>나오는 영어.</strong></div></div>`;
 if(kind==='first-recall')return `<div class="guide-practice-demo"><div class="guide-demo-first"><span class="guide-demo-step">1 · 처음 만난 표현</span><strong>처음 배우는 문장이에요</strong><p>이 주소 맞아요?</p><b lang="en">Is this the right address?</b><small>보고 익히고, 소리 내어 말해요.</small></div><span class="guide-demo-arrow" aria-hidden="true">↓</span><div class="guide-demo-recall"><span class="guide-demo-step">2 · 그 표현을 다시 연습할 때</span><p>기사에게 주소를 보여줬다.<br>이 주소가 맞는지 물어보세요.</p><span class="guide-hidden-answer">● ● ● <span>이번엔 내가 꺼내 말하기</span></span></div></div>`;
 if(kind==='answer-tools')return '<div class="guide-practice-tools"><span>🔊 예문 듣기</span><span>🗣 내 목소리 듣기</span><b>🎙 가리고 다시 말하기</b></div>';
 return '';
}
function showFeatureGuide(id,proceed=null){const guide=FEATURE_GUIDES[id];if(!guide)return;if(proceed&&hGet(featureGuideKey(id),false))return proceed();let index=0;let previousPose=null;const ov=openSheet(guide.title+' 시작 안내');
 const paint=()=>{const [title,text,demo]=guide.steps[index];const pose=samchoGuidePose(id,index,guide.steps.length);const previous=previousPose;previousPose=pose;ov.querySelector('#sheetContent').innerHTML=`<div class="feature-guide ${demo?'guide-with-demo':''}"><div class="guide-brand">3<span>3초영어 안내</span></div><div class="samcho-stage samcho-${pose}">${previous&&previous!==pose?`<img class="samcho-out" src="${SAMCHO_POSES[previous]}" alt="" aria-hidden="true">`:""}<div class="samcho-enter"><img class="guide-mascot" src="${SAMCHO_POSES[pose]}" alt="3초영어 말풍선 마스코트 삼초"></div></div><span class="mascot-name">삼초랑 한마디씩</span>${guide.steps.length>1?`<div class="onb-dots">${guide.steps.map((_,i)=>`<span class="onb-dot ${i===index?'on':''}"></span>`).join('')}</div><small>${index+1} / ${guide.steps.length}</small>`:''}<h3>${title}</h3><p class="guide-story">${text}</p>${featureGuideDemo(demo)}</div><div class="guide-actions">${index?'<button id="featurePrev" class="quiet">이전</button>':''}<button id="featureNext" class="primary">${index===guide.steps.length-1?(proceed?(guide.cta||'시작하기'):'알겠어요'):'다음'}</button></div>`;if(index)ov.querySelector('#featurePrev').onclick=()=>{index--;paint();};ov.querySelector('#featureNext').onclick=()=>{if(index<guide.steps.length-1){index++;paint();}else{hSet(featureGuideKey(id),true);ov.remove();if(proceed)proceed();}};};paint();}
function withFirstGuide(id,fn){return function(...args){return showFeatureGuide(id,()=>fn.apply(this,args));};}
startTravelDrill=withFirstGuide('basic',startTravelDrill);
openTravelStudyPicker=withFirstGuide('study',openTravelStudyPicker);
openMissPicker=withFirstGuide('miss',openMissPicker);
openSurvival=withFirstGuide('ai',openSurvival);
openGrowth=withFirstGuide('growth',openGrowth);
openLearnedWords=withFirstGuide('words',openLearnedWords);
openProfile=withFirstGuide('profile',openProfile);
openRank=withFirstGuide('rank',openRank);
openSync=withFirstGuide('sync',openSync);
openTutorial=function(){const ov=openSheet('3초영어 사용법');ov.querySelector('#sheetContent').innerHTML='<p class="muted">처음 들어가는 기능은 짧게 안내해요. 여기서 언제든 다시 볼 수 있어요.</p>'+Object.entries(FEATURE_GUIDES).map(([id,g])=>`<button class="tut-li" data-feature-guide="${id}"><span>${g.icon} ${g.title}</span><span>›</span></button>`).join('');ov.querySelectorAll('[data-feature-guide]').forEach(b=>b.onclick=()=>showFeatureGuide(b.dataset.featureGuide));};
$('#engTravel').onclick=()=>startTravelDrill(10,true,true);$('#engStudy').onclick=()=>openTravelStudyPicker();$('#engMiss').onclick=()=>openMissPicker();$('#engReal').onclick=()=>openSurvival();
$('#profileBtn').onclick=()=>openProfile();$('#tutorialBtn').onclick=()=>openTutorial();$('#rankBtn').onclick=()=>openRank();$('#syncBtn').onclick=()=>openSync();
const supportRenderWithoutGuide=renderSupportHome;
renderSupportHome=function(){supportRenderWithoutGuide();const reward=$('#rewardZone');if(reward){const btn=document.createElement('button');btn.id='rewardHelp';btn.className='reward-help';btn.textContent='레벨 · XP 안내 ?';btn.onclick=()=>showFeatureGuide('xp');reward.appendChild(btn);}};
renderSupportHome();
