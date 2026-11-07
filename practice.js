/* Four practice modes only. Learning records retain their existing storage keys. */
const APP_VERSION="v4.6.0", APP_BUILD="2026-11-07";
const $=s=>document.querySelector(s);
const setup=$("#setup"), stage=$("#stage"), msg=$("#msg"), threadInner=$("#threadInner");
const state={mode:"talk",engine:"survival",scn:null,convo:[],ttsOn:true,busy:false};
let curScreen="setup", autoDrill=null, sessionEpoch=0, pendingReply=false,autoDrillClock=null;
const TTS=window.speechSynthesis, SSU=window.SpeechSynthesisUtterance;
function levelRate(slow){const v=typeof alGet==='function'?alGet().speed||1:30;const rate=.70+(v-1)*(.34/59);return slow?Math.max(.45,rate*.6):rate;}
function adWordHint(it){const k=travelKeyOf(it);return k.key.length?k.key.join(' · '):'';}
function showError(error){ $("#notice").textContent=String(error&&error.message||error); }
function renderHome(){
  $("#engStudySub").textContent="필요한 표현만 골라 반복해요";
  $("#engMissSub").textContent=missCount()?`${missCount()}문장 · 틀린 문장만 다시 말해요`:"틀린 문장을 자동으로 모아 반복해요";
  if(typeof renderSupportHome==='function')renderSupportHome();
}
let answerLoopTimer=null, answerVoiceUrl=null, answerVoicePlayer=null,activeWordPractice=null;
function stopAnswerLoop(){if(answerLoopTimer)clearTimeout(answerLoopTimer);answerLoopTimer=null;const button=$('#answerLoop');if(button)button.textContent='🔁 반복 듣기';}
function stopMyVoice(){if(answerVoicePlayer){answerVoicePlayer.pause();answerVoicePlayer=null;}const button=$('#answerVoice');if(button)button.textContent='🗣 내 목소리 듣기';}
function clearAnswerVoice(){stopMyVoice();if(answerVoiceUrl)URL.revokeObjectURL(answerVoiceUrl);answerVoiceUrl=null;}
function saveAnswerVoice(blob){clearAnswerVoice();if(blob&&blob.size>44)answerVoiceUrl=URL.createObjectURL(blob);}
function nativeRecordingBlob(result){if(!result.audioBase64)return null;const bytes=Uint8Array.from(atob(result.audioBase64),c=>c.charCodeAt(0));return new Blob([bytes],{type:'audio/wav'});}
async function listenMyVoice(){
  const out=$('#answerToolInfo'),button=$('#answerVoice');if(!button)return;
  if(answerVoicePlayer){stopMyVoice();return;}
  if(!answerVoiceUrl){
    out.hidden=false;
    if(window.srNativePracticePlayback){
      out.innerHTML='<p>내 목소리로 한 번 더 말하고, 예문과 비교해보세요.</p><button id="recordMyVoice" class="quiet">🎙 녹음하기</button>';
      const record=$('#recordMyVoice');record.onclick=async()=>{
        if(qzRecording){window.srNativeRequest('recognizeStop').catch(()=>{});return;}
        const epoch=micEpoch;stopAnswerLoop();svStop();if(TTS)TTS.cancel();micBeep();qzRecording=true;record.textContent='■ 녹음 중 · 누르면 종료';
        try{const result=await window.srNativeRequest('recordPractice');if(epoch!==micEpoch)return;saveAnswerVoice(nativeRecordingBlob(result));if(!answerVoiceUrl)throw Error('녹음된 소리가 없어요. 다시 말해주세요.');micBeepEnd();out.textContent='녹음했어요. 내 목소리 듣기를 눌러 비교해보세요.';}
        catch(e){if(epoch===micEpoch)out.textContent=e.message;}finally{if(epoch===micEpoch)qzRecording=false;}
      };
    }else out.textContent=window.SpeakingRoomNative?'내 목소리 듣기는 앱 0.5.7부터 사용할 수 있어요. Play 스토어에서 업데이트해주세요.':'마이크로 답한 뒤 내 목소리를 들을 수 있어요. 직접 입력한 답변에는 녹음이 없어요.';
    return;
  }
  stopAnswerLoop();svStop();if(TTS)TTS.cancel();
  const epoch=micEpoch,player=new Audio(answerVoiceUrl);answerVoicePlayer=player;button.textContent='■ 재생 멈추기';
  player.onended=()=>{if(answerVoicePlayer===player)stopMyVoice();};
  player.onerror=()=>{if(answerVoicePlayer!==player)return;stopMyVoice();out.hidden=false;out.textContent='녹음을 재생하지 못했어요. 다시 말하며 녹음해주세요.';};
  try{await player.play();}catch(e){if(epoch===micEpoch&&answerVoicePlayer===player){stopMyVoice();out.hidden=false;out.textContent='녹음을 재생하지 못했어요. 내 목소리 듣기를 다시 눌러주세요.';}}
}
function stopMicrophone(preservePreparation=false){ stopAnswerLoop();stopMyVoice(); micEpoch++;micPreparing=false; if(window.srNativePracticeSpeech&&!preservePreparation)window.srNativeRequest("recognizeCancel").catch(()=>{}); vadCancel(); micLiveStop(_micLive); if(qzMR&&qzMR.state!=="inactive")try{qzMR.stop();}catch(_){} qzRecording=false;micStreamRelease(); }
function goToSetup(){
  if(activeWordPractice)activeWordPractice.sheet.remove();
  stopResponseClock();
  if(typeof PracticeAI!=='undefined')PracticeAI.cancel();
  sessionEpoch++; stopMicrophone();clearAnswerVoice(); if(TTS)TTS.cancel(); svStop();
  autoDrill=null; state.busy=false; pendingReply=false; state.scn=null;
  for(const id of ['stage','sprint'])$("#"+id).hidden=true;
  stage.style.display="none"; setup.hidden=false; setup.style.display="block";
  curScreen="setup"; $("#notice").textContent=""; renderHome();
}
function openSheet(title,onClose){
  const old=$("#practiceSheet");if(old)old.remove();
  const ov=document.createElement('dialog');ov.id='practiceSheet';ov.className='practice-sheet';
  ov.innerHTML=`<div class="sheet-head"><h2>${escapeHtml(title)}</h2><button class="quiet" id="sheetClose" aria-label="닫기">✕</button></div><div id="sheetContent"></div>`;
  const remove=ov.remove.bind(ov);let closed=false;ov.remove=()=>{if(closed)return;closed=true;if(onClose)onClose();remove();};
  document.body.appendChild(ov);ov.querySelector('#sheetClose').onclick=()=>ov.remove();ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});ov.addEventListener('cancel',e=>{e.preventDefault();ov.remove();});ov.addEventListener('close',()=>ov.remove());ov.showModal();return ov;
}
function practiceAnswerWords(it){return [...new Set(adWords(it.ex.en))].filter(w=>w.length>2&&!/^(can|could|would|the|you|your|have|does|there|that|with|for|and|this|are)$/.test(w));}
function practiceTrackWordMisses(it,heard,meta,g){
  // Recognition mismatches are practice suggestions, never a pronunciation diagnosis.
  if(g.ok||meta.typed||!heard)return;
  const heardWords=adWords(heard),counts=it._wordMisses||(it._wordMisses={}),saved=hGet('speakingroom:answer_vocab',{});let changed=false;
  for(const w of practiceAnswerWords(it)){
    if(TRAVEL_SKIP_WORDS.has(w)||TRAVEL_FILLER_WORDS.has(w))continue;
    const present=heardWords.some(x=>x===w||travelSynEq(x,w)||adLooseWordEq(x,w)||(typeof phWordEq==='function'&&phWordEq(x,w)));
    if(present)continue;counts[w]=(counts[w]||0)+1;
    if(counts[w]>=2){saved[w]={...saved[w],en:w,ko:saved[w]?.ko||FREQ_DICT[w]||FREQ_DICT[w.replace(/s$/,'')]||'',misses:Math.max(saved[w]?.misses||0,counts[w]),lastT:Date.now()};changed=true;}
  }
  if(changed)hSet('speakingroom:answer_vocab',saved);
}
function openWordPractice(word,it){
  word=adNorm(word);if(!/^[a-z]+$/.test(word)||!autoDrill||!pendingReply||!practiceProfileCurrent())return;
  const lesson=autoDrill;stopMicrophone();svStop();if(TTS)TTS.cancel();
  const current={sheet:null},ov=openSheet('이 단어만 입에 붙여봐요',()=>{if(activeWordPractice===current){activeWordPractice=null;stopMicrophone();svStop();if(TTS)TTS.cancel();}});current.sheet=ov;activeWordPractice=current;
  const host=ov.querySelector('#sheetContent'),saved=hGet('speakingroom:answer_vocab',{}),meaning=saved[word]?.ko||FREQ_DICT[word]||FREQ_DICT[word.replace(/s$/,'')]||'';
  host.innerHTML=`<div class="word-practice"><p class="eyebrow">한 단어 집중 연습</p><h3>${escapeHtml(word)}</h3><p>${escapeHtml(meaning)}</p><p class="muted">듣고, 이 단어만 또렷하게 말해보세요.<br>여기서는 문장 점수와 숙련도가 바뀌지 않아요.</p><button id="wordPracticeListen" class="quiet">🔊 단어 듣기</button><p id="wordPracticeStatus" role="status">준비되면 마이크를 눌러주세요.</p><button id="wordPracticeMic" class="primary">🎤 이 단어 말하기</button><button id="wordPracticeBack" class="quiet">문장으로 돌아가기</button></div>`;
  const status=host.querySelector('#wordPracticeStatus'),mic=host.querySelector('#wordPracticeMic'),back=host.querySelector('#wordPracticeBack');let busy=false;
  const valid=()=>activeWordPractice===current&&autoDrill===lesson&&practiceProfileCurrent();
  host.querySelector('#wordPracticeListen').onclick=()=>{if(!busy&&valid())speakEn(word,it?._voiceRate??levelRate());};
  back.onclick=()=>ov.remove();
  mic.onclick=async()=>{
    if(!valid()||busy)return;busy=true;mic.disabled=true;svStop();if(TTS)TTS.cancel();status.textContent='시작음이 들리면 단어를 말해주세요.';
    const label=setTimeout(()=>{if(valid()&&micPreparing)mic.textContent='마이크 연결 중…';},350);
    try{await micFillCb((text,meta={})=>{
      if(!valid())return;busy=false;mic.disabled=false;mic.textContent='🎤 한 번 더 말하기';
      if(!text){status.textContent=meta.sttErr||'말소리가 잘 들리지 않았어요. 다시 말해보세요.';return;}
      const ok=adNorm(text)===word;
      status.textContent=ok?'✓ '+word+'로 들렸어요! 이제 문장 안에서 꺼내볼까요?':'이렇게 들렸어요: '+text+'\n예문을 다시 듣고 '+word+'만 말해보세요.';
      if(ok){const words=hGet('speakingroom:answer_vocab',{}),old=words[word]||{};words[word]={...old,en:word,ko:old.ko||meaning,practiceCorrect:(old.practiceCorrect||0)+1,lastT:Date.now()};hSet('speakingroom:answer_vocab',words);back.textContent='문장으로 돌아가 다시 말하기 →';back.onclick=()=>{if(!valid())return;ov.remove();if(autoDrill===lesson&&pendingReply)return autoDrillRecall();};}
    },word,()=>{if(valid()){clearTimeout(label);status.textContent='말한 단어를 확인하고 있어요.';mic.textContent='말소리 확인 중…';}},{mode:'accuracy',onReady:()=>{if(valid()){clearTimeout(label);mic.textContent='■ 듣는 중';status.textContent='단어를 말하면 자동으로 끝나요.';}}});}
    finally{clearTimeout(label);if(valid()){busy=false;mic.disabled=false;}}
  };
  speakEn(word,it?._voiceRate??levelRate());prewarmPractice(lesson,{ex:{en:word}});return ov;
}
function travelCountPick(onPick){
  const ov=openSheet('몇 문제 할까요?');
  ov.querySelector('#sheetContent').innerHTML='<p class="muted">틀린 문장은 잠시 뒤 다시 나와요.</p><div class="count-row">'+TRAVEL_COUNTS.map(n=>`<button class="count-choice" data-count="${n}">${n}<small>문제</small></button>`).join('')+'</div>';
  ov.querySelectorAll('[data-count]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.count);hSet(TRAVEL_COUNT_KEY,n);ov.remove();onPick(n);});
}
function travelPoolOf(ids){if(!ids||!ids.length)return null;return TRAVEL_FRAMES.filter(f=>ids.includes(f.id));}
function travelBuildItems(count,pool){
  const frames=travelPickFrames(count,pool),records=travelAll();
  const introPlanned=new Set();
  const items=frames.map(f=>{const introduce=!records[f.id]?.introduced&&!introPlanned.has(f.id);introPlanned.add(f.id);const ex=travelPickItem(f,records,{introduce}),frame=basicFrameFor(f,ex);return {_travel:true,_difficulty:typeof alGet==='function'?alGet().speak:1,frame,block:{id:f.id,block:frame.frame},ex:{...ex,situation:f.purpose},limit:3};});
  travelSave(records);travelMarkShown(frames.map(f=>f.id));return items;
}
function travelReadMs(it){return Math.max(2500,Math.min(7000,String(it.ex.ko||'').replace(/\s/g,'').length*220));}
function startTravelDrill(count,skipGuide,skipPick,ids){
  if(count==null&&!skipPick)return travelCountPick(n=>startTravelDrill(n,true,true,ids));
  if(ids&&ids.length&&!travelPoolOf(ids).length)return showError('선택한 표현이 없어요. 다시 골라주세요.');
  startDrill(travelBuildItems(Math.max(3,Math.min(30,count||travelCountGet())),travelPoolOf(ids)),ids?'골라서 연습':'기본표현');
}
function openTravelStudyPicker(){
  const ov=openSheet('골라서 연습'),selected=new Set(travelStudyGet().filter(id=>TRAVEL_BY_ID[id]));
  const content=ov.querySelector('#sheetContent');
  content.innerHTML='<p class="muted">입에 안 붙는 표현만 체크하세요.</p><div class="selection-actions"><button id="pickWeak" class="quiet">약한 표현</button><button id="pickAll" class="quiet">전체</button><button id="pickNone" class="quiet">해제</button></div><div id="expressionList"></div><button id="pickStart" class="primary"></button>';
  const paint=()=>{
    content.querySelector('#expressionList').innerHTML=TRAVEL_FRAMES.map(f=>{const display=basicFrameFor(f,basicStarterItem(f));return `<label class="expression-row"><input type="checkbox" value="${f.id}" ${selected.has(f.id)?'checked':''}><span><b>${escapeHtml(display.frame)}</b><small>${escapeHtml(display.ko)}</small></span></label>`;}).join('');
    content.querySelectorAll('input').forEach(box=>box.onchange=()=>{box.checked?selected.add(box.value):selected.delete(box.value);travelStudySet([...selected]);paint();});
    const start=content.querySelector('#pickStart');start.textContent=selected.size?`${selected.size}개 표현 연습하기`:'표현을 골라주세요';start.disabled=!selected.size;
    start.onclick=()=>{const ids=[...selected];ov.remove();travelCountPick(n=>startTravelDrill(n,true,true,ids));};
  };
  const choose=ids=>{selected.clear();ids.forEach(id=>selected.add(id));travelStudySet([...selected]);paint();};
  content.querySelector('#pickWeak').onclick=()=>choose(TRAVEL_FRAMES.filter(f=>{const s=travelStat(f.id)||{};return !s.seen||(s.miss||0)>(s.ok||0)||(s.streak||0)<3;}).map(f=>f.id));
  content.querySelector('#pickAll').onclick=()=>choose(TRAVEL_FRAMES.map(f=>f.id));content.querySelector('#pickNone').onclick=()=>choose([]);paint();
}
function missRecord(it,ok){
  const en=it.ex.en,records=missAll();if(ok&&!records[en])return;
  const r=records[en]||{miss:0,ok:0,streak:0};r.fid=it.frame.id;r.ko=it.ex.ko;r.sit=it.frame.purpose;r.lastT=Date.now();
  if(ok){r.ok=(r.ok||0)+1;r.streak=(r.streak||0)+1;}else{r.miss=(r.miss||0)+1;r.streak=0;}
  if(r.streak>=MISS_GRADUATE)delete records[en];else records[en]=r;missSave(records);
}
function missBuildItems(list){return list.filter(m=>TRAVEL_ACTIVE_IDS.has(m.fid)).map(m=>{const f=TRAVEL_BY_ID[m.fid],core=(basicCoreItems(f)||[]).find(ex=>ex.en===m.en),ex={...core,en:m.en,ko:m.ko||travelKrOf(m.en)||f.ko,situation:f.purpose},frame=basicFrameFor(f,ex);return {_travel:true,_miss:true,frame,block:{id:f.id,block:frame.frame},ex,limit:3,_intro:false};});}
function openMissPicker(){
  const ov=openSheet('자주 틀리는 문장'),content=ov.querySelector('#sheetContent');
  const list=missList();
  content.innerHTML=list.length?`<p class="muted">연속 ${MISS_GRADUATE}번 맞히면 목록에서 빠져요.</p>`+list.map(m=>`<div class="miss-row"><b>${escapeHtml(m.en)}</b><span>${escapeHtml(m.ko||travelKrOf(m.en))}</span><small>${m.miss}번 틀림 · 연속 ${m.streak||0}번 정답</small></div>`).join('')+'<button id="missStart" class="primary">틀린 문장 반복하기</button>':'<p class="empty">기본표현을 연습하다 틀린 문장이 여기에 모여요.</p>';
  const start=content.querySelector('#missStart');if(start)start.onclick=()=>{ov.remove();startMissDrill(list.slice(0,30));};
}
function startMissDrill(list){const items=missBuildItems(list);for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}if(items.length)startDrill(items,'자주 틀리는 문장');}
function startDrill(items,title){
  goToSetup();const profileId=typeof learningProfileId==='function'?learningProfileId():'legacy';
  items=items.map(it=>({...it,_attemptGroupId:practiceAttemptId(),_attempts:0,_hadIncorrect:false}));
  autoDrill={items,idx:0,results:[],title,t0:0,typedAt:null,profileId};
  curScreen='sprint';setup.hidden=true;setup.style.display='none';$('#sprint').hidden=false;autoDrillRender();
}
function autoDrillRender(recall=false){
  if(!autoDrill)return;if(autoDrill.idx>=autoDrill.items.length)return autoDrillDone();
  stopResponseClock();stopMicrophone(recall&&pendingReply&&!qzRecording&&!micPreparing);clearAnswerVoice();svStop();if(TTS)TTS.cancel();
  const it=autoDrill.items[autoDrill.idx];it.recall=recall;it._voiceRate=levelRate();
  if(window.SpeakingRoomNative||window.srNativePracticeSpeech){micAudioReady();if(_svPending.size<4)svPrepare(it.ex.en,it._voiceRate).catch(()=>{});}
  if(it._intro==null){it._intro=!travelStat(it.frame.id).introduced;if(it._intro)travelMarkIntroduced(it.frame.id);}
  const firstLook=it._intro&&!recall;
  const guidance=recall?'방금 본 문장을 가렸어요.\n기억에서 꺼내보세요.':firstLook?'처음엔 문장을 보고 말해도 괜찮아요.\n천천히 소리 내어 말해보세요.':'상황을 읽고, 영어로 말해보세요.\n완벽하지 않아도 괜찮아요.';
  const host=$('#sprintScroll');host.innerHTML=`<div class="auto-card">
    <div class="practice-top"><button id="autoExit" class="quiet">‹ 끝내기</button><div class="lesson-progress" aria-label="연습 진행"><i style="width:${autoDrill.idx/autoDrill.items.length*100}%"></i></div><span>${autoDrill.idx+1} / ${autoDrill.items.length}</span></div>
    <div class="drill-prompt">
      <p class="eyebrow">${escapeHtml(autoDrill.title)}</p>${typeof basicDifficultyLabel==='function'?`<p class="difficulty-note">${escapeHtml(basicDifficultyLabel(it._difficulty,it.ex._tier))}</p>`:''}<p id="autoSpeed" class="response-clock" role="status"></p>
      <h2>${firstLook?escapeHtml(it.frame.frame):'상황을 보고 말해보세요'}</h2>
      <p class="situation">${escapeHtml(it.ex.ko)}</p>
      ${firstLook?`<div class="intro"><p class="intro-label">처음 배우는 문장이에요</p><p>${escapeHtml(it.frame.ko)}</p><b>${escapeHtml(it.ex.en)}</b></div>`:''}
    </div>
    <div id="autoHintRow"><button class="quiet" id="autoWord">🔍 단어 힌트</button><button class="quiet" id="autoShow">👀 표현 보기</button></div>
    <div id="autoCoach" class="practice-coach"><img src="mascot-guide.png" alt="" width="88" height="88"><p id="autoStat" class="muted" role="status">${escapeHtml(guidance)}</p></div>
    <div class="auto-actions"><button class="primary" id="autoMic">🎤 터치해서 말하기</button><button class="quiet" id="autoType">직접 입력</button><input id="autoInput" class="auto-input" placeholder="영어로 입력 후 Enter" autocomplete="off" hidden></div>
  </div>`;
  autoDrill.t0=Date.now();autoDrill.typedAt=null;autoDrill.systemWaitMs=0;pendingReply=false;
  startResponseClock(autoDrill,it);prewarmPractice(autoDrill,it);
  $('#autoExit').onclick=autoDrillDone;
  $('#autoMic').onclick=beginAutoMic;
  $('#autoType').onclick=()=>{if(window.SpeakingRoomNative||window.srNativePracticeSpeech)micAudioReady();$('#autoInput').hidden=false;$('#autoInput').focus();};
  $('#autoInput').oninput=()=>{if(!autoDrill.typedAt)autoDrill.typedAt=Date.now();};
  $('#autoInput').onkeydown=e=>{if(e.key==='Enter'&&e.target.value.trim()&&!pendingReply){e.preventDefault();autoDrillFinish(e.target.value.trim(),{speechStartAt:autoDrill.typedAt,typed:true});}};
  $('#autoShow').onclick=()=>{stopMicrophone();it._hintUsed=true;autoDrillShowResult(it,true,false);};
  $('#autoWord').onclick=()=>{it._hintUsed=true;stopResponseClock();$('#autoSpeed').textContent='힌트로 익히는 중';$('#autoStat').textContent=adWordHint(it)||'이 표현은 통째로 기억해보세요.';};
}
function stopResponseClock(){if(autoDrillClock!==null)clearTimeout(autoDrillClock);autoDrillClock=null;}
function startResponseClock(lesson,it){
  stopResponseClock();const out=$('#autoSpeed');if(!out)return;
  if(it._intro||it.recall||it._hintUsed||it._attempts){out.textContent='보고 익힌 뒤, 다음엔 3초 안에 꺼내봐요';return;}
  const tick=()=>{if(autoDrill!==lesson||pendingReply)return;const left=Math.max(0,3000-(Date.now()-lesson.t0-(lesson.systemWaitMs||0)));out.textContent=left>0?'⚡ '+(left/1000).toFixed(1)+'초 · 생각나면 바로 말해요':'익히는 중 · 맞히면 15 XP, 빠른 정답은 30 XP';if(left>0)autoDrillClock=setTimeout(tick,100);};tick();
}
function prewarmPractice(lesson,it){
  if(!window.srNativePracticeBackgroundPreparation||!window.srNativeRequest||typeof PracticeAI==='undefined'||PracticeAI.getMode()!=='accuracy')return;
  const epoch=micEpoch;
  return PracticeAI.prepareRealtime().then(s=>{if(autoDrill!==lesson||epoch!==micEpoch||!s.available||PracticeAI.getMode()!=='accuracy')return;return window.srNativeRequest('preparePracticeFast',{background:true,expectedWords:it.ex.en.trim().split(/\s+/).filter(Boolean).length});}).catch(()=>{});
}
function practiceResponseTiming(lesson,it,meta,pressedAt,priorWait){
  const native=Number.isFinite(meta.speechStartOffsetMs)&&Number.isFinite(meta.captureDurationMs)&&meta.speechStartOffsetMs>=0&&meta.speechStartOffsetMs<=meta.captureDurationMs;
  const browser=!window.srNativePracticeSpeech&&meta.spoke&&Number.isFinite(meta.speechStartAt)&&Number.isFinite(meta.startAt)&&meta.speechStartAt>=meta.startAt&&meta.speechStartAt<=meta.stopAt;
  const offset=native?meta.speechStartOffsetMs:browser?meta.speechStartAt-meta.startAt:null;
  const pressedMs=Math.max(0,pressedAt-lesson.t0-priorWait),responseMs=offset===null?null:pressedMs+offset;
  const speedEligible=!meta.typed&&!it._intro&&!it._hintUsed&&!it.recall&&!it._attempts&&!it._hadIncorrect&&offset!==null;
  return {responseMs,speedEligible,withinThreeSeconds:speedEligible&&pressedMs<=3000&&responseMs<=3000};
}
function practiceAttemptId(){return typeof learningNewAttemptId==='function'?learningNewAttemptId():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function practiceProfileCurrent(){return !autoDrill||typeof learningProfileId!=='function'||autoDrill.profileId===learningProfileId();}
function learningProfileChanged(){if(typeof PracticeAI!=='undefined')PracticeAI.cancel();}
async function beginAutoMic(){
  if(!autoDrill||!practiceProfileCurrent()||pendingReply||micPreparing)return;
  if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}
  const lesson=autoDrill,it=lesson.items[lesson.idx],attemptId=practiceAttemptId();
  const mode=typeof PracticeAI!=='undefined'?PracticeAI.getMode():'accuracy';
  const pressedAt=Date.now(),priorWait=lesson.systemWaitMs||0;let prepared=false;
  stopResponseClock();svStop();if(TTS)TTS.cancel();$('#autoStat').textContent='시작음이 들리면 말해주세요.';
  if($('#autoSpeed'))$('#autoSpeed').textContent='답변 속도는 실제 말하기 시작으로 확인해요';
  const labelTimer=setTimeout(()=>{if(autoDrill===lesson&&micPreparing&&!qzRecording){$('#autoMic').textContent='마이크 연결 중…';$('#autoStat').textContent='음성을 연결하고 있어요. 이 대기는 응답 시간에서 제외해요.';}},350);
  try{return await micFillCb((text,meta)=>{if(autoDrill!==lesson||!practiceProfileCurrent())return;if(!prepared)lesson.systemWaitMs=priorWait+Date.now()-pressedAt;return autoDrillFinish(text,{...meta,...practiceResponseTiming(lesson,it,meta,pressedAt,priorWait),attemptId,gradingMode:mode});},it.ex.en,()=>{
    clearTimeout(labelTimer);
    if(autoDrill!==lesson)return;$('#autoMic').textContent='말소리 인식 중…';$('#autoStat').textContent='말하기가 끝났어요. 말한 내용을 확인하고 있어요.';
  },{mode,requestId:attemptId,onReady:()=>{clearTimeout(labelTimer);if(autoDrill!==lesson)return;if(!prepared){prepared=true;lesson.systemWaitMs=priorWait+Date.now()-pressedAt;}$('#autoMic').textContent='■ 듣는 중';$('#autoStat').textContent='말을 마치면 자동으로 끝나요.';}});}finally{clearTimeout(labelTimer);}
}
function autoDrillRecall(){if(!autoDrill||!pendingReply||micPreparing||qzRecording)return;autoDrillRender(true);return beginAutoMic();}
function autoDrillFinish(heard,meta={}){
  if(!autoDrill||pendingReply||!practiceProfileCurrent())return;
  if(!heard){$('#autoStat').textContent=meta.sttErr||'잘 들리지 않았어요. 다시 말하거나 직접 입력해주세요.';$('#autoMic').textContent='🎤 다시 말하기';return;}
  pendingReply=true;stopMicrophone();saveAnswerVoice(meta.recordingBlob);
  const lesson=autoDrill,it=lesson.items[lesson.idx],requestId=meta.attemptId||practiceAttemptId();
  const mode=meta.gradingMode||(typeof PracticeAI!=='undefined'?PracticeAI.getMode():'accuracy');
  if(mode==='meaning'&&typeof PracticeAI!=='undefined'){
    const local=PracticeAI.localDecision(it,heard);
    if(local.decided)return autoDrillApplyResult(lesson,it,heard,{...meta,attemptId:requestId},local);
    $('#autoMic').textContent='뜻 확인 중…';$('#autoStat').textContent='말한 문장의 뜻을 확인하고 있어요.';
    const epoch=sessionEpoch;
    return PracticeAI.judge(it,heard,requestId).then(g=>{if(lesson===autoDrill&&epoch===sessionEpoch&&practiceProfileCurrent())autoDrillApplyResult(lesson,it,heard,{...meta,attemptId:requestId},g);}).catch(e=>{
      if(lesson!==autoDrill||epoch!==sessionEpoch||!practiceProfileCurrent())return;
      pendingReply=false;$('#autoMic').textContent='🎤 다시 말하기';$('#autoStat').textContent=e.message+' 점수와 숙련도는 바뀌지 않았어요.';
    });
  }
  return autoDrillApplyResult(lesson,it,heard,{...meta,attemptId:requestId},travelGrade(it,heard));
}
function autoDrillApplyResult(lesson,it,heard,meta,g){
  if(lesson!==autoDrill||!practiceProfileCurrent())return;
  if(g.retry){pendingReply=false;$('#autoMic').textContent='🎤 다시 말하기';$('#autoStat').textContent='말한 내용을 확실히 판단하기 어려워요. 다시 말해주세요. 점수와 숙련도는 바뀌지 않았어요.';return;}
  const retry=!!(it._hadIncorrect||it._attempts),perfect=g.ok&&!it._intro&&!it._hintUsed&&!it.recall&&!retry&&meta.speedEligible===true&&meta.withinThreeSeconds===true&&Number.isFinite(meta.responseMs)&&meta.responseMs>=0&&meta.responseMs<=3000;
  it._attempts=(it._attempts||0)+1;if(!g.ok)it._hadIncorrect=true;
  it._lastHeard=heard;it._lastOk=g.ok;practiceTrackWordMisses(it,heard,meta,g);
  travelRecord(it.frame.id,g.ok);missRecord(it,g.ok);autoDrill.results.push({ok:g.ok,perfect,en:it.ex.en,heard});
  if(typeof recordPractice==='function'){recordPractice({it,heard,ok:g.ok,perfect,meta,started:autoDrill.t0,mode:autoDrill.title,attemptGroupId:it._attemptGroupId,attemptId:meta.attemptId,profileId:autoDrill.profileId,retry});autoDrill.results[autoDrill.results.length-1].xp=it._earnedXP||0;}
  if(!perfect&&(it._requeues||0)<2){const again={...it,_intro:false,_hintUsed:false,_requeues:(it._requeues||0)+1,_lastHeard:'',_lastOk:false};if(!it._requeues)autoDrill.items.splice(Math.min(autoDrill.items.length,autoDrill.idx+5+Math.floor(Math.random()*3)),0,again);else autoDrill.items.push(again);}
  const message=perfect?'⚡ '+(meta.responseMs/1000).toFixed(1)+'초 만에 꺼냈어요!':g.ok?(it.recall||retry?'다시 말해서 맞혔어요. 다음 문장으로 이어가요.':it._intro||it._hintUsed?'표현을 익혔어요. 이번엔 가리고 말해봐요.':'정답이에요. 다음엔 3초 안에 꺼내봐요.'):g.meaningOnly?`뜻은 통하지만 이번에는 ${it.frame.frame} 표현으로 연습해보세요.`:g.keyMiss?'표현은 맞았어요. 상황에 맞는 핵심 낱말을 넣어보세요.':`이번에는 ${it.frame.frame} 표현으로 말해보세요.`;
  const needsRecall=!g.ok||(!it.recall&&(it._intro||it._hintUsed));
  autoDrillShowResult(it,needsRecall,perfect,message+(it._rewardMessage?'\n'+it._rewardMessage:''));
}
function autoDrillShowResult(it,retry,perfect,message='표현을 보고 다시 말해보세요.'){
  stopResponseClock();
  pendingReply=true;
  const referenceRate=it._voiceRate??levelRate();
  const card=document.querySelector('.auto-card'),old=$('#autoAnswer');if(old)old.remove();
  $('#autoHintRow').hidden=true;
  const intro=card.querySelector('.intro');if(intro)intro.remove();const heading=card.querySelector('h2');if(heading)heading.textContent='상황을 보고 말해보세요';
  const answer=document.createElement('div');answer.id='autoAnswer';answer.className='answer';
  const key=travelKeyOf(it),kr=travelKrOf(it.ex.en),notes=prepNotes(it.ex.en),words=practiceAnswerWords(it),weakWords=words.filter(w=>(it._wordMisses?.[w]||0)>=2);
  answer.innerHTML=`<small class="answer-kicker">이렇게 말하면 돼요</small><b class="answer-sentence">${escapeHtml(it.ex.en)}</b>${kr?`<p class="answer-ko">${escapeHtml(kr)}</p>`:''}<p class="answer-pattern">표현은 <b>${escapeHtml(it.frame.frame)}</b>${key.key.length?` · 꼭 들어갈 말 <em>${escapeHtml(key.key.join(' · '))}</em>`:''}<br>나머지는 상황에 맞게 바꿔도 돼요.</p>${it._lastOk&&adNorm(it._lastHeard)!==adNorm(it.ex.en)?`<p class="accepted-answer">✓ 내가 말한 표현도 맞아요: ${escapeHtml(it._lastHeard)}</p>`:''}${notes.length?`<section class="answer-explain prep-explain"><h3>🔤 왜 이 전치사냐면</h3>${notes.map(n=>`<div class="prep-row"><b>${escapeHtml(n.w)}</b><p><strong>${escapeHtml(n.t)}</strong> — ${n.d}</p></div>`).join('')}</section>`:''}${it.frame.tip?`<section class="answer-explain usage-explain"><h3>🧭 언제 쓰는 표현이냐면</h3><div>${it.frame.tip}</div>${it.frame.parts?.length?`<div class="answer-chunks"><h3>✂️ 이렇게 끊어서 보세요 <span>표현 예시</span></h3><div class="chunk-row">${it.frame.parts.map(([en,ko])=>`<span><b>${escapeHtml(en)}</b><small>${escapeHtml(ko)}</small></span>`).join('')}</div>${it.frame.pnote?`<p>${it.frame.pnote}</p>`:''}</div>`:''}</section>`:''}<div class="answer-words"><span>🔍 단어 뜻 · 연습</span>${words.map(w=>`<button data-word="${escapeHtml(w)}" class="${weakWords.includes(w)?'word-needs-practice':''}">${escapeHtml(w)}${weakWords.includes(w)?' <small>집중 연습</small>':''}</button>`).join('')}</div>${weakWords.length?'<p class="word-practice-nudge">자꾸 다르게 들리는 단어를 눌러 따로 연습해보세요.</p>':''}<div id="answerWordInfo" hidden></div><div class="answer-tools"><button id="answerListen">🔊 다시 듣기</button><button id="answerLoop">🔁 반복 듣기</button><button id="answerSay">🎙 다시 말하기</button><button id="answerStress">📊 문장 강세</button><button id="answerAi">💬 AI 질문</button><button id="answerVocab">📒 단어장</button></div><div id="answerToolInfo" hidden role="status"></div>`;
  const voiceButton=document.createElement('button');voiceButton.id='answerVoice';voiceButton.textContent='🗣 내 목소리 듣기';voiceButton.onclick=listenMyVoice;
  const tools=answer.querySelector('.answer-tools');tools.insertBefore(voiceButton,tools.querySelector('#answerStress'));
  card.className='auto-card has-answer';
  const coach=$('#autoCoach');coach.className='practice-coach practice-feedback';
  const mascot=coach.querySelector('img');if(mascot)mascot.remove();
  card.insertBefore(answer,coach);
  $('#answerListen').onclick=()=>speakEn(it.ex.en,referenceRate);
  $('#answerLoop').onclick=()=>{if(answerLoopTimer){stopAnswerLoop();$('#answerLoop').textContent='🔁 반복 듣기';}else{const play=()=>{if(!answer.isConnected)return stopAnswerLoop();speakEn(it.ex.en,referenceRate);answerLoopTimer=setTimeout(play,Math.max(4500,it.ex.en.length*95));};play();$('#answerLoop').textContent='⏹ 반복 멈추기';}};
  $('#answerSay').onclick=autoDrillRecall;
  answer.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>{const w=b.dataset.word,info=$('#answerWordInfo'),meaning=FREQ_DICT[w]||FREQ_DICT[w.replace(/s$/,'')]||'';info.hidden=false;info.innerHTML=`<b>${escapeHtml(w)}</b><span>${escapeHtml(meaning||'이 단어의 뜻은 AI 질문에서 물어볼 수 있어요.')}</span><button id="practiceAnswerWord">🎤 이 단어만 연습하기</button><button id="saveAnswerWord">＋ 단어장에 저장</button>`;$('#practiceAnswerWord').onclick=()=>openWordPractice(w,it);$('#saveAnswerWord').onclick=()=>{const saved=hGet('speakingroom:answer_vocab',{});saved[w]={...saved[w],en:w,ko:meaning,lastT:Date.now()};hSet('speakingroom:answer_vocab',saved);$('#saveAnswerWord').textContent='✓ 저장했어요';};speakEn(w);});
  $('#answerStress').onclick=()=>{const info=$('#answerToolInfo');info.hidden=false;info.innerHTML='<h3>문장에서 힘을 주어 말할 부분</h3><p class="stress-sentence">'+it.ex.en.split(/(\s+)/).map(w=>words.includes(adNorm(w))?`<b>${escapeHtml(w)}</b>`:escapeHtml(w)).join('')+'</p><small>내용을 전달하는 낱말은 또렷하게, 연결하는 말은 가볍게 말해보세요.</small>';};
  $('#answerAi').onclick=()=>{const ov=openSheet('이 표현, 더 알고 싶어요'),host=ov.querySelector('#sheetContent');host.innerHTML=`<p class="question-expression">${escapeHtml(it.ex.en)}</p><textarea id="answerQuestion" placeholder="예: 여기서 for를 쓰는 이유가 뭐예요?"></textarea><button id="askAnswerQuestion" class="primary">질문하기</button><p id="answerQuestionReply" role="status"></p>`;host.querySelector('#askAnswerQuestion').onclick=async()=>{const q=host.querySelector('#answerQuestion').value.trim(),out=host.querySelector('#answerQuestionReply'),button=host.querySelector('#askAnswerQuestion');if(!q)return;if(window.SpeakingRoomNative){let status;try{status=await window.srNativeRequest('status');}catch(e){out.textContent=e.message;return;}if(!status.ready){out.textContent='ChatGPT 연결을 마친 뒤 질문할 수 있어요.';await window.srNativeRequest('settings');return;}}button.disabled=true;out.textContent='설명을 준비하고 있어요…';try{const r=await callClaude('Explain this English expression to a Korean beginner in concise Korean. Expression: '+it.ex.en,[{role:'user',content:q}]);out.textContent=extractText(r);}catch(e){out.textContent=e.message;}finally{button.disabled=false;}};};
  $('#answerVocab').onclick=()=>{const ov=openSheet('내 단어장'),saved=Object.values(hGet('speakingroom:answer_vocab',{})).sort((a,b)=>(b.misses||0)-(a.misses||0)),host=ov.querySelector('#sheetContent');host.innerHTML=saved.length?saved.map(w=>`<button class="vocab-item" data-vocab="${escapeHtml(w.en)}"><b>${escapeHtml(w.en)}</b><span>${escapeHtml(w.ko||'뜻을 확인해보세요')+(w.misses>=2?' · 집중 연습':'')}</span><span>🔊</span></button>`).join(''):'<p class="muted">위의 단어를 누르고 저장하면 여기에 모여요.</p>';host.querySelectorAll('[data-vocab]').forEach(b=>b.onclick=()=>openWordPractice(b.dataset.vocab,it));};
  $('#autoStat').textContent=message+(it._lastHeard?`\n내가 말한 문장: ${it._lastHeard}`:'');
  card.querySelector('.auto-actions').innerHTML=(retry?'<button id="autoRetry" class="primary">가리고 다시 말하기</button>':'')+'<button id="autoNext" class="'+(retry?'quiet':'primary')+'">다음 →</button>';
  if($('#autoRetry'))$('#autoRetry').onclick=autoDrillRecall;
  if($('#autoSpeed'))$('#autoSpeed').textContent=perfect?'⚡ 3초 안에 꺼낸 문장':it._lastOk?'✓ 맞혔어요 · 다음 문장으로':'보고 다시 익혀봐요';
  $('#autoNext').onclick=()=>autoDrillAdvance(perfect,it);speakEn(it.ex.en,referenceRate);if(retry)prewarmPractice(autoDrill,it);
}
function autoDrillAdvance(perfect,it){
  const next=autoDrill.idx+1;if(autoDrill.items[next]&&autoDrill.items[next].frame.id===it.frame.id){const swap=autoDrill.items.findIndex((x,i)=>i>next&&x.frame.id!==it.frame.id);if(swap>0)[autoDrill.items[next],autoDrill.items[swap]]=[autoDrill.items[swap],autoDrill.items[next]];}
  autoDrill.idx++;autoDrillRender();
}
function autoDrillDone(){
  if(!autoDrill)return;
  stopResponseClock();
  if(typeof PracticeAI!=='undefined')PracticeAI.cancel();
  sessionEpoch++;stopMicrophone();clearAnswerVoice();svStop();if(TTS)TTS.cancel();
  const rows=autoDrill.results,title=autoDrill.title,correct=rows.filter(r=>r.ok).length;
  autoDrill=null;pendingReply=false;
  $('#sprintScroll').innerHTML=`<div class="done"><p class="eyebrow">${escapeHtml(title)}</p><h2>${rows.length?'연습을 마쳤어요':'다음에 이어서 연습해요'}</h2>${rows.length?`<p>${rows.length}번 중 ${correct}번 상황에 맞게 말했어요.</p>${rows.some(r=>r.xp)?`<div class="session-reward"><b>+${rows.reduce((n,r)=>n+(r.xp||0),0)} XP</b><span>이번 연습에서 쌓은 경험치</span></div>`:''}<p class="muted">틀린 문장은 ‘자주 틀리는 문장’에서 다시 연습할 수 있어요.</p>`:''}<button id="doneHome" class="primary">홈으로</button></div>`;$('#doneHome').onclick=goToSetup;renderHome();
}
function openSurvival(){
  const ov=openSheet('AI 실전회화'),content=ov.querySelector('#sheetContent');
  const scenes=()=>{
    content.innerHTML='<p class="muted">상황을 골라 영어로 주고받아보세요.</p>'+SURVIVAL.map(s=>`<button class="scenario-row" data-scene="${s.id}"><span>${s.emo}</span><b>${escapeHtml(s.t)}</b><span>›</span></button>`).join('')+(window.SpeakingRoomNative?'<button id="aiAccount" class="quiet account">✓ ChatGPT 연결됨 · 연결 관리</button>':'');
    content.querySelectorAll('[data-scene]').forEach(b=>b.onclick=()=>{const scene=SURVIVAL.find(s=>s.id===b.dataset.scene);ov.remove();startSurvival(scene);});
    if(window.SpeakingRoomNative)content.querySelector('#aiAccount').onclick=()=>window.srNativeRequest('settings').catch(showError);
  };
  if(!window.SpeakingRoomNative){scenes();return;}
  const connection=(connected=false)=>{
    content.innerHTML='<div class="ai-connect"><span class="ai-connect-icon">💬</span><h3>삼초와 연습한 말을<br>대화로 꺼내볼까요?</h3><p>처음 한 번, 내 ChatGPT 계정을 연결해주세요.</p><button id="connectChatGPT" class="primary">ChatGPT 연결하기 →</button><p id="aiConnectStatus" role="status" class="muted">연결을 마치고 돌아오면 상황을 고를 수 있어요.</p></div>';
    if(connected){content.querySelector('.ai-connect h3').innerHTML='ChatGPT 로그인은 저장되어 있어요';content.querySelector('.ai-connect p').textContent='대화 준비를 확인하면 바로 연습할 수 있어요.';content.querySelector('#connectChatGPT').textContent='대화 연결 확인하기 →';content.querySelector('#aiConnectStatus').textContent='앱 0.5.5부터 대화 준비를 자동으로 확인해요. 다시 로그인할 필요는 없어요.';}
    content.querySelector('#connectChatGPT').onclick=()=>window.srNativeRequest('settings').catch(e=>{content.querySelector('#aiConnectStatus').textContent=e.message;});
  };
  const refresh=s=>{if(ov.isConnected===false)return;if(s.ready)scenes();else connection(!!s.connected);};
  window.srAiEntryRefresh=refresh;
  content.innerHTML='<p class="muted" role="status">ChatGPT 연결을 확인하고 있어요…</p>';
  window.srNativeRequest('status').then(refresh).catch(e=>{if(ov.isConnected===false)return;content.innerHTML='<p role="status">연결 상태를 확인하지 못했어요. '+escapeHtml(e.message)+'</p><button id="retryAiStatus" class="primary">다시 확인</button>';content.querySelector('#retryAiStatus').onclick=()=>{ov.remove();openSurvival();};});
}
function rolePrompt(){return ['You are a friendly realistic conversation partner helping a Korean learner practice spoken English.','Situation: '+state.scn.ctx,'Play the role of '+state.scn.role+'.',typeof aiLevelInstruction==='function'?aiLevelInstruction():'Use short beginner-friendly English: one or two sentences and one question at a time.','Stay in character and respond to the learner’s intended meaning, even with imperfect grammar.','Accept different natural expressions; do not require an exact memorized sentence or reveal answers before the learner tries.','Create a natural conversation. Ask for missing details one at a time. Let the learner explain, clarify, request, and correct misunderstandings. Wrap up when the situation is resolved.','Give a short hint only when asked. Do not score, award points, or prescribe other learning modes.'].join('\n');}
function startSurvival(scene){goToSetup();state.scn=scene;state.convo=[];state.engine='survival';state.mode='talk';startSession();}
async function startSession(){
  const epoch=sessionEpoch;curScreen='talk';setup.hidden=true;setup.style.display='none';stage.hidden=false;stage.style.display='flex';$('#sceneTitle').textContent=state.scn.t;threadInner.innerHTML='';setBusy(true);
  try{const result=await callClaude(rolePrompt(),[{role:'user',content:'Start the situation. Say your first line in English.'}]);if(epoch!==sessionEpoch)return;const text=stripUsedMarker(extractText(result)).clean;state.convo.push({role:'assistant',text});addCoachTurn(text);}catch(e){if(epoch===sessionEpoch)addCoachTurn('연결하지 못했어요. '+e.message,false);}finally{if(epoch===sessionEpoch)setBusy(false);}
}
function addTurn(text,role){const row=document.createElement('div');row.className='turn '+role;row.textContent=text;threadInner.appendChild(row);$('#thread').scrollTop=$('#thread').scrollHeight;return row;}
function addMeTurn(text){return addTurn(text,'me');}
function addCoachTurn(text,speak=true){addTurn(text,'coach');if(speak&&state.ttsOn)speakEn(text);}
function setBusy(b){state.busy=b;$('#sendBtn').disabled=b;$('#micBtn').disabled=b;$('#helpBtn').disabled=b;$('#fbBtn').disabled=b;$('#msg').disabled=b;}
async function sendMessage(){
  const text=msg.value.trim();if(!text||state.busy||!state.scn)return;
  const epoch=sessionEpoch;msg.value='';addMeTurn(text);state.convo.push({role:'user',text});setBusy(true);
  try{const result=await callClaude(rolePrompt(),state.convo.map(t=>({role:t.role,content:t.text})));if(epoch!==sessionEpoch)return;const answer=stripUsedMarker(extractText(result)).clean;state.convo.push({role:'assistant',text:answer});addCoachTurn(answer);if(typeof recordAiPractice==='function')recordAiPractice();}catch(e){if(epoch===sessionEpoch)addCoachTurn('응답하지 못했어요. '+e.message,false);}finally{if(epoch===sessionEpoch)setBusy(false);}
}
async function askHelp(){if(state.busy||!state.scn)return;await conversationAdvice('Give me one short example of how I can answer your last question, with a brief Korean meaning.');}
async function getFeedback(){if(state.busy||!state.scn)return;await conversationAdvice('Give concise Korean feedback on my most recent English sentence and one natural English alternative. Do not score. Do not advance the conversation.');}
async function conversationAdvice(request){
  const epoch=sessionEpoch;setBusy(true);
  try{const history=state.convo.map(t=>({role:t.role,content:t.text}));history.push({role:'user',content:request});const result=await callClaude(rolePrompt(),history);if(epoch===sessionEpoch)addCoachTurn(stripUsedMarker(extractText(result)).clean,false);}catch(e){if(epoch===sessionEpoch)addCoachTurn(e.message,false);}finally{if(epoch===sessionEpoch)setBusy(false);}
}
function speakEn(text,rate=levelRate()){if(!text)return;if(window.SpeakingRoomNative||window.srNativePracticeSpeech)micAudioReady();if(qzRecording)stopMicrophone();stopMyVoice();const epoch=sessionEpoch;svSpeak(text,rate).then(ok=>{if(epoch!==sessionEpoch||ok||!TTS||!SSU)return;TTS.cancel();const u=new SSU(text);u.lang='en-US';u.rate=rate;TTS.speak(u);});}
async function micFillCb(rawCb,refText='',onCaptureEnd=null,options={}){
  if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}
  if(micPreparing)return;micPreparing=true;
  const epoch=micEpoch;let delivered=false,endCued=false;
  const meaning=options.mode==='meaning'&&typeof PracticeAI!=='undefined';
  const ready=()=>{if(epoch!==micEpoch||delivered)return;qzRecording=true;micPreparing=false;if(options.onReady)options.onReady();};
  const captureEnded=()=>{if(epoch===micEpoch&&!endCued){endCued=true;micBeepEnd();if(onCaptureEnd)onCaptureEnd();}};
  const cb=(text,meta)=>{if(epoch===micEpoch&&!delivered){delivered=true;micPreparing=false;qzRecording=false;if(!meta?.sttErr)captureEnded();rawCb(text,meta);}};
  try{
  if(meaning){await PracticeAI.ensureReady();if(epoch!==micEpoch)return;}
  if(window.srNativeRequest && (window.srNativePracticeSpeech==null||window.srNativePracticePlayback==null)){
    try{const status=await window.srNativeRequest('status');window.srNativePracticeSpeech=!!status.practiceSpeech;window.srNativePracticePlayback=!!status.practicePlayback;window.srNativePracticeStreaming=!!status.practiceStreaming;window.srNativePracticeMicReady=!!status.practiceMicReady;window.srNativePracticeRealtime=!!status.practiceRealtime;window.srNativePracticeRealtimePreparation=!!status.practiceRealtimePreparation;window.srNativePracticeBackgroundPreparation=!!status.practiceBackgroundPreparation;window.srNativePracticeSpeechTiming=!!status.practiceSpeechTiming;}catch(e){cb('',{sttErr:'앱의 음성 기능 연결을 확인하지 못했어요. 앱을 다시 열어주세요. '+e.message});return;}
    if(epoch!==micEpoch)return;
  }
  if(window.srNativeRequest && !window.srNativePracticeSpeech){cb('',{sttErr:'학습 화면은 최신이지만 설치된 앱의 음성 기능은 이전 버전이에요. Play 스토어에서 앱을 0.5.3 이상으로 업데이트해주세요.'});return;}
  let realtimePrepared=!meaning&&window.srNativePracticeSpeech&&window.srNativePracticePlayback&&window.srNativePracticeRealtime===true&&typeof PracticeAI!=='undefined'&&PracticeAI.realtimeReady();
  if(realtimePrepared){
    let preparationTimedOut=false;
    try{
      // Allow the person to answer Android's permission dialog. The native
      // network preparation itself has a separate five-second deadline.
      const prepared=await speechWait(window.srNativeRequest('preparePracticeFast',{expectedWords:refText.trim().split(/\s+/).filter(Boolean).length}),30000,'음성 연결 준비가 늦어요. 다시 말하기를 눌러주세요.',()=>{preparationTimedOut=true;window.srNativeRequest('recognizeCancel').catch(()=>{});});
      if(epoch!==micEpoch)return;
      if(prepared.permissionGranted===false){cb('',{sttErr:prepared.error||'마이크 사용을 허용해주세요.'});return;}
      if(prepared.prepared!==true){PracticeAI.disableRealtime();realtimePrepared=false;}
    }catch(e){if(epoch!==micEpoch)return;if(preparationTimedOut){cb('',{sttErr:e.message});return;}PracticeAI.disableRealtime();realtimePrepared=false;}
  }
  if(epoch!==micEpoch)return;
  // The cue invites speaking only after network preparation and permissions.
  micBeep();
  // Finish the start cue before recording so it cannot be mistaken for speech.
  const cueWait=Math.max(0,_micCueUntil-Date.now());
  if(cueWait){await new Promise(resolve=>setTimeout(resolve,cueWait));if(epoch!==micEpoch)return;}
  if(window.srNativePracticeSpeech){
    const startAt=Date.now();let captureTimer=null;
    try{
      if(window.srNativePracticePlayback){
        const realtime=realtimePrepared;
        const streamed=!meaning&&(realtime||window.srNativePracticeStreaming===true);
        let capturedAt=null,readyAt=null;
        const endNativeCapture=()=>{if(epoch!==micEpoch||capturedAt!==null)return;capturedAt=Date.now();clearTimeout(captureTimer);qzRecording=false;micPreparing=true;captureEnded();};
        const words=refText.trim().split(/\s+/).filter(Boolean).length;
        const limit=words?Math.max(8000,Math.min(18000,3500+words*850)):20000;
        // The installed app already exposes PCM capture with silence detection.
        // A bounded stop also handles steady background noise; no second tap.
        const armCaptureLimit=()=>{if(captureTimer!==null||epoch!==micEpoch||capturedAt!==null)return;captureTimer=setTimeout(()=>{if(epoch===micEpoch&&capturedAt===null)window.srNativeRequest('recognizeStop').catch(()=>{});},limit);};
        const nativeReady=()=>{if(epoch!==micEpoch||capturedAt!==null||delivered)return;readyAt=Date.now();armCaptureLimit();ready();};
        if(!window.srNativePracticeMicReady)armCaptureLimit();
        const action=realtime?'streamPracticeFast':streamed?'streamPractice':'recordPractice';
        const result=await speechWait(window.srNativeRequest(action,{expectedWords:words},streamed?endNativeCapture:null,nativeReady),limit+(streamed?8000:5000)+(realtime?6000:0),streamed?'음성 인식이 응답하지 않아요. 다시 말해주세요.':'녹음이 응답하지 않아요. 다시 말해주세요.',()=>window.srNativeRequest('recognizeCancel').catch(()=>{}));
        clearTimeout(captureTimer);if(epoch!==micEpoch)return;
        const recordingBlob=nativeRecordingBlob(result);if(!recordingBlob)throw new Error('녹음된 소리가 없어요. 다시 말해주세요.');
        endNativeCapture();
        const meta={startAt:readyAt??startAt,stopAt:capturedAt,speechStartAt:null,spoke:true,recordingBlob};
        if(Number.isFinite(result.speechStartOffsetMs)&&Number.isFinite(result.captureDurationMs)&&result.speechStartOffsetMs>=0&&result.speechStartOffsetMs<=result.captureDurationMs){meta.speechStartOffsetMs=result.speechStartOffsetMs;meta.captureDurationMs=result.captureDurationMs;meta.speechStartAt=meta.startAt+result.speechStartOffsetMs;}
        const recognizeAt=capturedAt;
        const timing={preparationMs:readyAt===null?null:readyAt-startAt,captureMs:recognizeAt-(readyAt??startAt),recognitionMs:null,phase:'recognition',mode:meaning?'meaning':realtime?'realtime':'accuracy'};
        window.srLastSpeechTiming=timing;
        let text;
        try{
          if(realtime&&result.streamError){PracticeAI.disableRealtime();timing.mode='accuracy-fallback';text=await practiceTranscribe(recordingBlob,'audio/wav',meta,refText,{preferAzure:true,azureOnly:true});}
          else{if(streamed&&result.streamError)throw new Error(result.streamError);text=meaning?await PracticeAI.transcribe(recordingBlob,meta,options.requestId):streamed?practiceTranscriptText({DisplayText:result.text||''},meta,refText):await practiceTranscribe(recordingBlob,'audio/wav',meta,refText,{preferAzure:true});}
          timing.phase='complete';
        }
        catch(e){timing.phase='error';throw e;}
        finally{timing.recognitionMs=Date.now()-recognizeAt;}
        cb(text,meta);
      }else{
        if(meaning)throw Error('의미 중심 음성 연습은 앱 업데이트가 필요해요. 정확도 중심으로 계속 연습할 수 있어요.');
        const result=await window.srNativeRequest('recognize',{recordAnswer:!!refText});if(epoch!==micEpoch)return;
        cb(result.text||'',{startAt,speechStartAt:null,spoke:!!result.text,recordingBlob:nativeRecordingBlob(result)});
      }
    }
    catch(e){cb('',{sttErr:e.message});}
    finally{if(captureTimer)clearTimeout(captureTimer);if(epoch===micEpoch)qzRecording=false;}
    return;
  }
  try{
    const wait=micCooldownLeft();if(wait)await new Promise(r=>setTimeout(r,wait));if(epoch!==micEpoch)return;
    const stream=await micStreamGet();if(epoch!==micEpoch){micStreamRelease();return;}
    const meta={startAt:Date.now(),speechStartAt:null,spoke:false},live=meaning?null:micLiveStart(),chunks=[],mime=getBestMime();
    qzMR=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);const recorder=qzMR,actualMime=recorder.mimeType||mime;
    const finishCapture=()=>{if(epoch===micEpoch&&qzRecording&&recorder.state!=='inactive')recorder.stop();};
    if(live)live.onFinal=finishCapture;
    qzMR.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    qzMR.onstop=async()=>{
      if(epoch!==micEpoch){micLiveStop(live);return;}
      if(live)live.onFinal=null;vadCancel();qzRecording=false;micPreparing=true;captureEnded();micStartCooldown();micStreamIdle();meta.stopAt=Date.now();
      try{
        const raw=new Blob(chunks,{type:actualMime});if(raw.size>=400)meta.recordingBlob=raw;
        const device=await micLiveWait(live,900);if(epoch!==micEpoch)return;
        if(device&&device.text)return cb(device.text,meta);
        if(raw.size<400)return cb('',meta);
        if(meaning){const wav=/^audio\/wav\b/i.test(actualMime)?raw:await speechWait(recordedToWav(raw),3000,'녹음을 변환하지 못했어요. 다시 말해주세요.');cb(await PracticeAI.transcribe(wav,meta,options.requestId),meta);}
        else cb(await practiceTranscribe(raw,actualMime,meta,refText),meta);
      }catch(e){cb('',{...meta,sttErr:e.message});}
    };
    qzMR.start(250);ready();
    vadArm(stream,{...VAD_OPTS,silenceMs:600,maxSilenceMs:1400,maxMs:25000,noSpeechMs:7000,expectWords:refText.trim().split(/\s+/).filter(Boolean).length,onSpeechStart:t=>{meta.spoke=true;meta.speechStartAt=t;}});
  }catch(e){micStreamRelease();qzRecording=false;cb('',{sttErr:'녹음을 시작하지 못했어요. ('+String(e.name||'Error')+') '+String(e.message||'')});}
  }catch(e){cb('',{sttErr:e.message||'음성 연습을 준비하지 못했어요.'});}finally{if(epoch===micEpoch)micPreparing=false;}
}
function forceUpdate(){if(curScreen!=='setup')return showError('홈에서 업데이트를 확인해주세요.');if(window.SpeakingRoomNative)return window.srNativeRequest('webupdate').catch(showError);location.reload();}
async function checkForUpdate(){
  if(window.SpeakingRoomNative)return;
  try{const r=await fetch('practice.js?cb='+Date.now(),{cache:'no-store'});if(!r.ok)return;const v=(await r.text()).match(/APP_VERSION="([^"]+)"/);if(v&&v[1]!==APP_VERSION&&curScreen==='setup')location.reload();}catch(_){}
}
$('#engTravel').onclick=()=>startTravelDrill(10,true,true);$('#engStudy').onclick=openTravelStudyPicker;$('#engMiss').onclick=openMissPicker;$('#engReal').onclick=openSurvival;
$('#chatBack').onclick=goToSetup;$('#sendBtn').onclick=sendMessage;$('#helpBtn').onclick=askHelp;$('#fbBtn').onclick=getFeedback;
$('#msg').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}};
$('#micBtn').onclick=()=>{if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}if(state.busy||micPreparing)return;svStop();if(TTS)TTS.cancel();$('#micBtn').textContent='■ 듣는 중';micFillCb((text,meta)=>{$('#micBtn').textContent='🎤';if(text){msg.value=text;sendMessage();}else addCoachTurn(meta.sttErr||'잘 들리지 않았어요. 다시 말해주세요.',false);},'',()=>{$('#micBtn').textContent='확인 중…';});};
$('#ttsBtn').onclick=function(){state.ttsOn=!state.ttsOn;this.setAttribute('aria-pressed',String(state.ttsOn));if(!state.ttsOn){svStop();if(TTS)TTS.cancel();}};
$('#verFoot').textContent='업데이트 확인';$('#verFoot').onclick=forceUpdate;
window.addEventListener('popstate',()=>{const sheet=$('#practiceSheet');if(sheet)sheet.remove();else goToSetup();});
window.addEventListener('pagehide',()=>{stopMicrophone();svStop();});
goToSetup();checkForUpdate();
