/* Original adaptive-level logic; home and supporting features for four practice modes. */
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
const SYNC_KEYS=[TRAVEL_KEY,TRAVEL_STUDY_KEY,MISS_KEY,'speakingroom:autolvl','speakingroom:name',PRACTICE_LOG,'speakingroom:compact_quest'];
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
function recordPractice({it,ok,perfect,meta,started,mode}){
  const log=supportLog(),id=window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():Date.now()+'-'+Math.random();
  const reaction=meta.speechStartAt?Math.max(0,(meta.speechStartAt-started-travelReadMs(it))/1000):null;
  log[id]={t:Date.now(),fid:it.frame.id,ok,perfect,typed:!!meta.typed,reaction,seconds:Math.min(90,Math.max(1,(Date.now()-started)/1000)),kind:mode==='자주 틀리는 문장'?'miss':'travel'};
  hSet(PRACTICE_LOG,log);supportBump(mode==='자주 틀리는 문장'?'miss':'travel');
  autoLvlRecord('speak',perfect?'perfect':ok?'ok':'miss');
  if(reaction!==null&&!meta.typed)autoLvlRecord('speed',perfect&&reaction<=3?'perfect':ok?'ok':'miss');
  supportQueueSync();
}
let supportTalkAt=Date.now();
function recordAiPractice(){const log=supportLog(),id=Date.now()+'-'+Math.random();log[id]={t:Date.now(),kind:'talk',seconds:Math.min(90,Math.max(1,(Date.now()-supportTalkAt)/1000))};supportTalkAt=Date.now();hSet(PRACTICE_LOG,log);supportBump('talk');supportQueueSync();}
function aiLevelInstruction(){const n=alGet().speak;return n<15?'Use very short beginner English, one sentence and one question at a time.':n<35?'Use everyday English, one or two short sentences and one natural question at a time.':'Use natural everyday English with occasional follow-up details, at most three sentences and one question at a time.';}
// Keep the original no-repeat item picker while adapting sentence length to the speaking level.
const originalTravelPickItem=travelPickItem;
travelPickItem=function(f,o){
  const n=alGet().speak,limit=n<15?8:n<35?12:Infinity;
  const candidates=f.items.filter(x=>x.en.trim().split(/\s+/).length<=limit);
  return originalTravelPickItem(candidates.length?{...f,items:candidates}:f,o);
};
function supportName(){return hGet('speakingroom:name','')||localStorage.getItem('speakingroom:sync_name')||'친구';}
function renderAutoLvlStatus(){if($('#autoLvlLine'))$('#autoLvlLine').textContent='말하기 D'+alGet().speak+' · 속도 D'+alGet().speed;}
function renderSupportHome(){
  const s=supportStats(),q=supportToday(),d=alGet(),done=[q.travel>=5,q.miss>=3||!missCount(),q.talk>=3].filter(Boolean).length;
  $('#profileBtn').textContent=supportName().slice(0,1);
  $('#heroZone').innerHTML=`<div class="home-head"><div class="hh-top"><div class="hh-lv"><span class="hh-lv-num">D${d.speak}</span><span class="hh-lv-band">말하기 난이도</span></div><div class="hh-chips"><span class="hh-chip"><b>🔥 ${s.streak}</b> 일 연속</span><span class="hh-chip"><b>${s.automatic}</b> 표현 익숙해짐</span></div></div><div class="hello-line">${escapeHtml(supportName())}님, 오늘도 입에서 꺼내볼까요?</div><div class="hh-bar"><i style="width:${Math.round(s.automatic/TRAVEL_FRAMES.length*100)}%"></i></div><div class="hh-xp"><span>익숙한 여행 표현</span><span>${s.automatic} / ${TRAVEL_FRAMES.length}</span></div></div>`;
  const tasks=[['travel','✈️','여행 표현','5번 말하기',5,q.travel,startTravelDrill],['miss','↻','오답 다지기',missCount()?'3번 다시 말하기':'오답이 쌓이면 연습해요',3,q.miss,openMissPicker],['talk','💬','실전회화','3번 주고받기',3,q.talk,openSurvival]];
  $('#routineZone').innerHTML=`<div class="panel-title"><span>☀️ 오늘의 루틴</span><small>${done}/3 완료</small></div><p class="routine-sub">짧게, 한 번 더. 오늘의 작은 목표예요.</p><div class="routine-steps">${tasks.map(([k,ico,t,sub,goal,count])=>`<button data-routine="${k}" class="routine-step ${count>=goal||k==='miss'&&!missCount()?'complete':''}"><span>${ico}</span><b>${t}</b><small>${sub}</small><span class="step-progress">${k==='miss'&&!missCount()?'—':Math.min(goal,count||0)+'/'+goal}</span></button>`).join('')}</div>`;
  tasks.forEach(([key,,,,,,fn])=>{$('[data-routine="'+key+'"]').onclick=()=>fn();});
  $('#growthZone').innerHTML=`<div class="panel-title"><span>🌱 말하기가 쌓이고 있어요</span><button id="growthDetail" class="quiet">기록 보기 ›</button></div><div class="growth-grid"><div><b>${s.accuracy===null?'—':s.accuracy+'%'}</b><span>여행 표현 정답률</span></div><div><b>${s.automatic}<small>개</small></b><span>익숙해진 표현</span></div><div><b>${s.total}<small>번</small></b><span>누적 말하기 연습</span></div></div><div class="adaptive-line"><span>✦ 난이도 자동 조절</span><b id="autoLvlLine">말하기 D${d.speak} · 속도 D${d.speed}</b></div><p class="routine-sub">성공하면 문장과 음성 속도를 조금씩 높여요.</p>`;
  $('#growthDetail').onclick=openGrowth;
  $('#syncSummary').textContent=localStorage.getItem('speakingroom:sync_nick')?'연결됨 · 기록 관리 ›':'기기 간 이어서 ›';
}
function openGrowth(){const ov=openSheet('실력 · 성장 기록'),s=supportStats(),voice=s.voice.slice(-20);const reaction=voice.length?voice.reduce((n,e)=>n+e.reaction,0)/voice.length:null;
  ov.querySelector('#sheetContent').innerHTML=`<div class="stat-grid"><div class="stat"><span class="se">🎯</span><div><div class="sv">${s.accuracy===null?'—':s.accuracy+'%'}</div><div class="sl">누적 정답률</div></div></div><div class="stat"><span class="se">⚡</span><div><div class="sv">${reaction===null?'—':reaction.toFixed(1)+'초'}</div><div class="sl">최근 말 시작 시간</div></div></div></div><p class="muted">말 시작 시간은 음성 입력의 최근 20회 기준이며, 상황을 읽는 예상 시간을 제외한 값이에요. 직접 입력은 포함하지 않아요.</p><div class="prof-h">표현별 숙련도</div>${TRAVEL_FRAMES.map(f=>{const r=travelStat(f.id),pct=Math.min(100,(r.streak||0)/3*100);return `<div class="mastery-row"><div><b>${escapeHtml(f.frame)}</b><small>${r.ok||0}번 정답 · ${r.miss||0}번 오답</small></div><div class="mastery-track"><i style="width:${pct}%"></i></div></div>`;}).join('')}`;
}
function openProfile(){const ov=openSheet('내 프로필'),s=supportStats();ov.querySelector('#sheetContent').innerHTML=`<div class="profile-heading"><div class="prof-av">${escapeHtml(supportName().slice(0,1))}</div><div><b>${escapeHtml(supportName())}님</b><small>${s.streak}일 연속 · ${s.total}번 연습 · 말하기 D${alGet().speak}</small></div></div><label class="field-label" for="profileName">앱에서 부를 이름</label><input id="profileName" class="auto-input" maxlength="12" value="${escapeHtml(supportName())}"><button id="saveName" class="primary">이름 저장</button><div class="prof-h">나의 영어</div><button id="profileGrowth" class="tut-li">🌱 실력 · 성장 기록 <span>›</span></button><button id="profileRank" class="tut-li">🏆 랭킹 <span>›</span></button><div class="prof-h">계정 · 기기 연동</div><button id="profileSync" class="tut-li">☁️ 기록 동기화 <span>›</span></button><div class="prof-h">시작 안내 · 튜토리얼</div><button id="profileGuide" class="tut-li">📖 처음 사용법 다시 보기 <span>›</span></button>`;
  ov.querySelector('#saveName').onclick=()=>{hSet('speakingroom:name',ov.querySelector('#profileName').value.trim().slice(0,12)||'친구');ov.remove();renderHome();supportQueueSync();};
  for(const [id,fn]of [['profileGrowth',openGrowth],['profileRank',openRank],['profileSync',openSync],['profileGuide',openTutorial]])ov.querySelector('#'+id).onclick=fn;
}
const GUIDE=[['✈️','먼저 여행 표현부터','상황을 읽고 영어로 말해보세요. 처음에는 표현을 보여주고, 다음부터는 상황만 보고 기억에서 꺼내요.'],['↻','틀린 문장은 한 번 더','틀린 문장은 잠시 뒤 다시 나와요. 답을 본 뒤에는 ‘가리고 다시 말하기’로 입에 붙이고, 오답 목록에서도 반복할 수 있어요.'],['✓','필요한 표현만 골라요','‘골라서 연습’에서 약한 표현을 선택하세요. 자주 틀리는 문장은 연속 3번 맞히면 오답 목록에서 빠져요.'],['💬','실제 대화로 이어가요','AI 실전회화에서 상황을 골라 주고받아보세요. 막히면 도움말을 쓰고, 연습 기록은 프로필에서 확인해요.']];
function openTutorial(){let index=0;const ov=openSheet('처음 사용법');const paint=()=>{const [ico,title,text]=GUIDE[index];ov.querySelector('#sheetContent').innerHTML=`<div class="guide-card"><div class="onb-badge">${ico}</div><div class="onb-dots">${GUIDE.map((_,i)=>`<span class="onb-dot ${i===index?'on':''}"></span>`).join('')}</div><small>${index+1} / ${GUIDE.length}</small><h3>${title}</h3><p>${text}</p></div><div class="guide-actions">${index?'<button id="guideBack" class="quiet">이전</button>':''}<button id="guideNext" class="primary">${index===GUIDE.length-1?'연습 시작하기':'다음'}</button></div>`;if(index)ov.querySelector('#guideBack').onclick=()=>{index--;paint();};ov.querySelector('#guideNext').onclick=()=>{if(index===GUIDE.length-1){hSet('speakingroom:compact_guide_seen',true);ov.remove();}else{index++;paint();}};};paint();}
function supportMergeLog(a,b){const out={...a};for(const [k,v]of Object.entries(b||{}))if(v&&typeof v==='object'&&Number.isFinite(v.t))out[k]=v;return out;}
function supportMergeTravel(a,b){const out={...a};for(const [k,v]of Object.entries(b||{})){if(!v||typeof v!=='object')continue;const own=out[k];if(!own){out[k]=v;continue;}const recent=(v.lastT||0)>(own.lastT||0)?v:own;out[k]={...recent,seen:Math.max(own.seen||0,v.seen||0),ok:Math.max(own.ok||0,v.ok||0),miss:Math.max(own.miss||0,v.miss||0),introduced:!!(v.introduced||own.introduced),used:[...new Set([...(own.used||[]),...(v.used||[])])]};}return out;}
function supportApplySnapshot(data){for(const key of SYNC_KEYS){if(typeof data[key]!=='string')continue;let remote;try{remote=JSON.parse(data[key]);}catch(_){continue;}const local=hGet(key,null);if(key===PRACTICE_LOG)remote=supportMergeLog(local||{},remote);else if(key===TRAVEL_KEY)remote=supportMergeTravel(local||{},remote);else if(key===MISS_KEY){const out={...local};for(const [en,r]of Object.entries(remote||{}))if(r&&typeof r==='object'&&(!out[en]||(r.lastT||0)>(out[en].lastT||0)))out[en]=r;remote=out;for(const [en,r]of Object.entries(remote)){const f=(hGet(TRAVEL_KEY,{})||{})[r.fid];if(f&&(f.lastT||0)>=(r.lastT||0)&&(f.streak||0)>=3)delete remote[en];}}else if(key==='speakingroom:compact_quest'){if(local&&local.date===remote.date)remote={...remote,travel:Math.max(local.travel||0,remote.travel||0),miss:Math.max(local.miss||0,remote.miss||0),talk:Math.max(local.talk||0,remote.talk||0)};else if(local&&local.date>remote.date)remote=local;}else if(key==='speakingroom:autolvl'&&local){remote={...local,...remote};}hSet(key,remote);}}
function supportCollect(){const data={};for(const key of SYNC_KEYS){const v=localStorage.getItem(key);if(v!==null)data[key]=v;}return data;}
function supportRankingSummary(){const s=supportStats(),now=Date.now(),week=s.events.filter(e=>e.t>=now-7*86400000),old=hGet('speakingroom:prof',{})||{};return {name:supportName(),xp:old.xp||0,lv:1,week:0,streak:s.streak,blocks:s.automatic,lvl:alGet().speak,mins:Math.round(week.reduce((n,e)=>n+(e.seconds||0),0)/60),allMins:Math.round(s.events.reduce((n,e)=>n+(e.seconds||0),0)/60)};}
async function supportSync(nick){if(supportSyncBusy)throw Error('다른 동기화가 진행 중이에요.');supportSyncBusy=true;try{
 const response=await fetch(PROXY_URL+'/u?n='+encodeURIComponent(nick),{cache:'no-store'});if(!response.ok)throw Error('기록을 불러오지 못했어요 ('+response.status+').');const saved=await response.json();
 const existing=saved.d&&typeof saved.d==='object'?saved.d:{};supportApplySnapshot(existing);
 // Preserve unrelated historical server records without collecting other local storage or login tokens.
 const d={...existing,...supportCollect()},t=Date.now();const res=await fetch(PROXY_URL+'/u?n='+encodeURIComponent(nick),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t,d,sum:supportRankingSummary()})});if(!res.ok)throw Error('기록을 저장하지 못했어요 ('+res.status+').');localStorage.setItem('speakingroom:sync_t',String(t));renderHome();return t;
 }finally{supportSyncBusy=false;}}
let supportSyncTimer;
function supportQueueSync(){const nick=localStorage.getItem('speakingroom:sync_nick');if(!nick||!hGet('speakingroom:compact_sync_enabled',false))return;clearTimeout(supportSyncTimer);supportSyncTimer=setTimeout(()=>supportSync(nick).catch(()=>{if($('#syncSummary'))$('#syncSummary').textContent='저장 대기 · 다시 연결 ›';}),4000);}
function openSync(){const ov=openSheet('기록 동기화'),nick=localStorage.getItem('speakingroom:sync_nick')||'';
 ov.querySelector('#sheetContent').innerHTML=`<div class="sync-cloud">☁️</div><h3>어디서든 이어서 연습해요</h3><p class="muted">다른 기기에서도 같은 닉네임을 입력하면 학습 기록을 불러와 합쳐요. 닉네임은 로그인 비밀번호가 아니므로 다른 사람이 추측하기 어려운 별명을 사용하세요.</p><label for="syncNickname" class="field-label">연동 닉네임</label><input id="syncNickname" class="auto-input" maxlength="24" value="${escapeHtml(nick)}" placeholder="나만 알아볼 별명"><p class="muted">연결하면 학습 기록이 기존 동기화 서버에 저장되고, 표시 이름과 학습 통계는 랭킹에 공개돼요. ChatGPT 로그인 정보와 대화 내용은 보내지 않아요.</p><button id="syncConnect" class="primary">기록 연결 · 동기화</button>${nick?'<button id="syncDisconnect" class="quiet">이 기기 자동 동기화 끄기</button>':''}<p id="syncStatus" role="status" class="muted">${localStorage.getItem('speakingroom:sync_t')?'마지막 저장: '+new Date(Number(localStorage.getItem('speakingroom:sync_t'))).toLocaleString('ko-KR'):''}</p>`;
 ov.querySelector('#syncConnect').onclick=async()=>{const input=ov.querySelector('#syncNickname'),name=input.value.trim().toLowerCase().replace(/\s+/g,'').slice(0,24);if(!name){ov.querySelector('#syncStatus').textContent='닉네임을 입력해주세요.';return;}const btn=ov.querySelector('#syncConnect');btn.disabled=true;ov.querySelector('#syncStatus').textContent='기록을 불러와 합치는 중…';try{await supportSync(name);localStorage.setItem('speakingroom:sync_nick',name);localStorage.setItem('speakingroom:sync_name',name);hSet('speakingroom:compact_sync_enabled',true);ov.querySelector('#syncStatus').textContent='연결됐어요. 연습한 기록은 자동으로 저장돼요.';renderHome();}catch(e){ov.querySelector('#syncStatus').textContent=e.message;}finally{btn.disabled=false;}};
 if(nick)ov.querySelector('#syncDisconnect').onclick=()=>{hSet('speakingroom:compact_sync_enabled',false);clearTimeout(supportSyncTimer);ov.querySelector('#syncStatus').textContent='이 기기에서 자동 동기화를 껐어요. 학습 기록은 남아 있어요.';};
}
async function openRank(){const ov=openSheet('랭킹');let rows=[],tab='mins',error='';const tabs=[['mins','이번 주 시간','분'],['allMins','누적 시간','분'],['blocks','익숙한 표현','개'],['streak','연속 학습','일']];
 const paint=()=>{if(!ov.isConnected)return;const selected=tabs.find(t=>t[0]===tab),sorted=[...rows].sort((a,b)=>(b[tab]||0)-(a[tab]||0));ov.querySelector('#sheetContent').innerHTML=`<p class="muted">각자 쌓은 연습 기록을 함께 봐요. 기록 동기화를 연결하면 랭킹에 참여해요.</p><div class="rank-tabs">${tabs.map(([k,t])=>`<button data-rank-tab="${k}" class="${tab===k?'active':''}">${t}</button>`).join('')}</div>${error?`<p class="notice">${escapeHtml(error)}</p>`:''}<div class="rank-list">${sorted.length?sorted.map((r,i)=>`<div class="rank-row ${r.n===localStorage.getItem('speakingroom:sync_nick')?'mine':''}"><span class="rank-place">${i<3?['🥇','🥈','🥉'][i]:i+1}</span><b>${escapeHtml(String(r.name||r.n||'친구'))}</b><strong>${Number(r[tab])||0}<small>${selected[2]}</small></strong></div>`).join(''):'<p class="empty">아직 표시할 기록이 없어요.</p>'}</div><button id="rankSync" class="quiet">내 기록 연결하기 ›</button>`;ov.querySelectorAll('[data-rank-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.rankTab;paint();});ov.querySelector('#rankSync').onclick=openSync;};
 ov.querySelector('#sheetContent').innerHTML='<p class="muted" role="status">랭킹을 불러오고 있어요…</p>';
 try{const r=await fetch(PROXY_URL+'/board',{cache:'no-store'});if(!r.ok)throw Error('랭킹을 불러오지 못했어요 ('+r.status+').');const data=await r.json();rows=Array.isArray(data)?data:[];}catch(e){error=e.message;}paint();
}
$('#profileBtn').onclick=openProfile;$('#tutorialBtn').onclick=openTutorial;$('#rankBtn').onclick=openRank;$('#syncBtn').onclick=openSync;
renderSupportHome();
