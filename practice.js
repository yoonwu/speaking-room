/* Four practice modes only. Learning records retain their existing storage keys. */
const APP_VERSION="v4.4.5", APP_BUILD="2026-10-06";
const $=s=>document.querySelector(s);
const setup=$("#setup"), stage=$("#stage"), msg=$("#msg"), threadInner=$("#threadInner");
const state={mode:"talk",engine:"survival",scn:null,convo:[],ttsOn:true,busy:false};
let curScreen="setup", autoDrill=null, sessionEpoch=0, pendingReply=false;
const TTS=window.speechSynthesis, SSU=window.SpeechSynthesisUtterance;
function levelRate(slow){const v=typeof alGet==='function'?alGet().speed||1:30;const rate=.70+(v-1)*(.34/59);return slow?Math.max(.45,rate*.6):rate;}
function adWordHint(it){const k=travelKeyOf(it);return k.key.length?k.key.join(' · '):'';}
function showError(error){ $("#notice").textContent=String(error&&error.message||error); }
function renderHome(){
  $("#engStudySub").textContent="필요한 표현만 골라 반복해요";
  $("#engMissSub").textContent=missCount()?`${missCount()}문장 · 틀린 문장만 다시 말해요`:"틀린 문장을 자동으로 모아 반복해요";
  if(typeof renderSupportHome==='function')renderSupportHome();
}
let answerLoopTimer=null, answerVoiceUrl=null, answerVoicePlayer=null;
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
        const epoch=micEpoch;stopAnswerLoop();svStop();if(TTS)TTS.cancel();qzRecording=true;record.textContent='■ 녹음 끝내기';
        try{const result=await window.srNativeRequest('recordPractice');if(epoch!==micEpoch)return;saveAnswerVoice(nativeRecordingBlob(result));if(!answerVoiceUrl)throw Error('녹음된 소리가 없어요. 다시 말해주세요.');out.textContent='녹음했어요. 내 목소리 듣기를 눌러 비교해보세요.';}
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
function stopMicrophone(){ stopAnswerLoop();stopMyVoice(); micEpoch++; if(window.srNativePracticeSpeech)window.srNativeRequest("recognizeCancel").catch(()=>{}); vadCancel(); micLiveStop(_micLive); if(qzMR&&qzMR.state!=="inactive")try{qzMR.stop();}catch(_){} qzRecording=false;micStreamRelease(); }
function goToSetup(){
  sessionEpoch++; stopMicrophone();clearAnswerVoice(); if(TTS)TTS.cancel(); svStop();
  autoDrill=null; state.busy=false; pendingReply=false; state.scn=null;
  for(const id of ['stage','sprint'])$("#"+id).hidden=true;
  stage.style.display="none"; setup.hidden=false; setup.style.display="block";
  curScreen="setup"; $("#notice").textContent=""; renderHome();
}
function openSheet(title){
  const old=$("#practiceSheet");if(old)old.remove();
  const ov=document.createElement('dialog');ov.id='practiceSheet';ov.className='practice-sheet';
  ov.innerHTML=`<div class="sheet-head"><h2>${escapeHtml(title)}</h2><button class="quiet" id="sheetClose" aria-label="닫기">✕</button></div><div id="sheetContent"></div>`;
  document.body.appendChild(ov);ov.querySelector('#sheetClose').onclick=()=>ov.remove();ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});ov.showModal();return ov;
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
    content.querySelector('#expressionList').innerHTML=TRAVEL_FRAMES.map(f=>`<label class="expression-row"><input type="checkbox" value="${f.id}" ${selected.has(f.id)?'checked':''}><span><b>${escapeHtml(f.frame)}</b><small>${escapeHtml(f.ko)}</small></span></label>`).join('');
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
function missBuildItems(list){return list.filter(m=>TRAVEL_BY_ID[m.fid]).map(m=>{const f=TRAVEL_BY_ID[m.fid],core=(basicCoreItems(f)||[]).find(ex=>ex.en===m.en),ex={...core,en:m.en,ko:m.ko||travelKrOf(m.en)||f.ko,situation:f.purpose},frame=basicFrameFor(f,ex);return {_travel:true,_miss:true,frame,block:{id:f.id,block:frame.frame},ex,limit:3,_intro:false};});}
function openMissPicker(){
  const ov=openSheet('자주 틀리는 문장'),content=ov.querySelector('#sheetContent');
  const list=missList();
  content.innerHTML=list.length?`<p class="muted">연속 ${MISS_GRADUATE}번 맞히면 목록에서 빠져요.</p>`+list.map(m=>`<div class="miss-row"><b>${escapeHtml(m.en)}</b><span>${escapeHtml(m.ko||travelKrOf(m.en))}</span><small>${m.miss}번 틀림 · 연속 ${m.streak||0}번 정답</small></div>`).join('')+'<button id="missStart" class="primary">틀린 문장 반복하기</button>':'<p class="empty">기본표현을 연습하다 틀린 문장이 여기에 모여요.</p>';
  const start=content.querySelector('#missStart');if(start)start.onclick=()=>{ov.remove();startMissDrill(list.slice(0,30));};
}
function startMissDrill(list){const items=missBuildItems(list);for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}if(items.length)startDrill(items,'자주 틀리는 문장');}
function startDrill(items,title){
  goToSetup();autoDrill={items,idx:0,results:[],title,t0:0,typedAt:null};
  curScreen='sprint';setup.hidden=true;setup.style.display='none';$('#sprint').hidden=false;autoDrillRender();
}
function autoDrillRender(recall=false){
  if(!autoDrill)return;if(autoDrill.idx>=autoDrill.items.length)return autoDrillDone();
  stopMicrophone();clearAnswerVoice();svStop();if(TTS)TTS.cancel();
  const it=autoDrill.items[autoDrill.idx];it.recall=recall;
  if(it._intro==null){it._intro=!travelStat(it.frame.id).introduced;if(it._intro)travelMarkIntroduced(it.frame.id);}
  const firstLook=it._intro&&!recall;
  const guidance=recall?'방금 본 문장을 가렸어요.\n기억에서 꺼내보세요.':firstLook?'처음엔 문장을 보고 말해도 괜찮아요.\n천천히 소리 내어 말해보세요.':'상황을 읽고, 영어로 말해보세요.\n완벽하지 않아도 괜찮아요.';
  const host=$('#sprintScroll');host.innerHTML=`<div class="auto-card">
    <div class="practice-top"><button id="autoExit" class="quiet">‹ 끝내기</button><div class="lesson-progress" aria-label="연습 진행"><i style="width:${autoDrill.idx/autoDrill.items.length*100}%"></i></div><span>${autoDrill.idx+1} / ${autoDrill.items.length}</span></div>
    <div class="drill-prompt">
      <p class="eyebrow">${escapeHtml(autoDrill.title)}</p>${typeof basicDifficultyLabel==='function'?`<p class="difficulty-note">${escapeHtml(basicDifficultyLabel(it._difficulty,it.ex._tier))}</p>`:''}
      <h2>${firstLook?escapeHtml(it.frame.frame):'상황을 보고 말해보세요'}</h2>
      <p class="situation">${escapeHtml(it.ex.ko)}</p>
      ${firstLook?`<div class="intro"><p class="intro-label">처음 배우는 문장이에요</p><p>${escapeHtml(it.frame.ko)}</p><b>${escapeHtml(it.ex.en)}</b></div>`:''}
    </div>
    <div id="autoHintRow"><button class="quiet" id="autoWord">🔍 단어 힌트</button><button class="quiet" id="autoShow">👀 표현 보기</button></div>
    <div id="autoCoach" class="practice-coach"><img src="mascot-guide.png" alt="" width="88" height="88"><p id="autoStat" class="muted" role="status">${escapeHtml(guidance)}</p></div>
    <div class="auto-actions"><button class="primary" id="autoMic">🎤 터치해서 말하기</button><button class="quiet" id="autoType">직접 입력</button><input id="autoInput" class="auto-input" placeholder="영어로 입력 후 Enter" autocomplete="off" hidden></div>
  </div>`;
  autoDrill.t0=Date.now();autoDrill.typedAt=null;pendingReply=false;
  $('#autoExit').onclick=autoDrillDone;
  $('#autoMic').onclick=async()=>{if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}if(pendingReply)return;svStop();if(TTS)TTS.cancel();$('#autoMic').textContent='말한 뒤 다시 누르면 끝나요';$('#autoStat').textContent='듣고 있어요…';await micFillCb((text,meta)=>{if(!autoDrill)return;autoDrillFinish(text,meta);},it.ex.en);};
  $('#autoType').onclick=()=>{$('#autoInput').hidden=false;$('#autoInput').focus();};
  $('#autoInput').oninput=()=>{if(!autoDrill.typedAt)autoDrill.typedAt=Date.now();};
  $('#autoInput').onkeydown=e=>{if(e.key==='Enter'&&e.target.value.trim()&&!pendingReply){e.preventDefault();autoDrillFinish(e.target.value.trim(),{speechStartAt:autoDrill.typedAt,typed:true});}};
  $('#autoShow').onclick=()=>{stopMicrophone();it._hintUsed=true;autoDrillShowResult(it,true,false);};
  $('#autoWord').onclick=()=>{it._hintUsed=true;$('#autoStat').textContent=adWordHint(it)||'이 표현은 통째로 기억해보세요.';};
}
function autoDrillFinish(heard,meta={}){
  if(!autoDrill||pendingReply)return;
  if(!heard){$('#autoStat').textContent=meta.sttErr||'잘 들리지 않았어요. 다시 말하거나 직접 입력해주세요.';$('#autoMic').textContent='🎤 다시 말하기';return;}
  pendingReply=true;stopMicrophone();saveAnswerVoice(meta.recordingBlob);
  const it=autoDrill.items[autoDrill.idx],g=travelGrade(it,heard),perfect=g.ok&&!it._hintUsed;
  it._lastHeard=heard;it._lastOk=g.ok;
  travelRecord(it.frame.id,g.ok);missRecord(it,g.ok);autoDrill.results.push({ok:g.ok,perfect,en:it.ex.en,heard});
  if(typeof recordPractice==='function'){recordPractice({it,heard,ok:g.ok,perfect,meta,started:autoDrill.t0,mode:autoDrill.title});autoDrill.results[autoDrill.results.length-1].xp=it._earnedXP||0;}
  if(!perfect&&(it._requeues||0)<2){const again={...it,_intro:false,_hintUsed:false,_requeues:(it._requeues||0)+1,_lastHeard:'',_lastOk:false};if(!it._requeues)autoDrill.items.splice(Math.min(autoDrill.items.length,autoDrill.idx+5+Math.floor(Math.random()*3)),0,again);else autoDrill.items.push(again);}
  const message=perfect?'상황에 맞게 말했어요.':g.ok?'표현을 보고 말했어요. 다음엔 상황만 보고 꺼내보세요.':g.meaningOnly?`뜻은 통하지만 이번에는 ${it.frame.frame} 표현으로 연습해보세요.`:g.keyMiss?'표현은 맞았어요. 상황에 맞는 핵심 낱말을 넣어보세요.':`이번에는 ${it.frame.frame} 표현으로 말해보세요.`;
  autoDrillShowResult(it,!perfect,perfect,message+(it._rewardMessage?'\n'+it._rewardMessage:''));
}
function autoDrillShowResult(it,retry,perfect,message='표현을 보고 다시 말해보세요.'){
  pendingReply=true;
  const card=document.querySelector('.auto-card'),old=$('#autoAnswer');if(old)old.remove();
  $('#autoHintRow').hidden=true;
  const intro=card.querySelector('.intro');if(intro)intro.remove();const heading=card.querySelector('h2');if(heading)heading.textContent='상황을 보고 말해보세요';
  const answer=document.createElement('div');answer.id='autoAnswer';answer.className='answer';
  const key=travelKeyOf(it),kr=travelKrOf(it.ex.en),notes=prepNotes(it.ex.en),words=[...new Set(adWords(it.ex.en))].filter(w=>w.length>2&&!/^(can|could|would|the|you|your|have|does|there|that|with|for|and|this|are)$/.test(w));
  answer.innerHTML=`<small class="answer-kicker">이렇게 말하면 돼요</small><b class="answer-sentence">${escapeHtml(it.ex.en)}</b>${kr?`<p class="answer-ko">${escapeHtml(kr)}</p>`:''}<p class="answer-pattern">표현은 <b>${escapeHtml(it.frame.frame)}</b>${key.key.length?` · 꼭 들어갈 말 <em>${escapeHtml(key.key.join(' · '))}</em>`:''}<br>나머지는 상황에 맞게 바꿔도 돼요.</p>${it._lastOk&&adNorm(it._lastHeard)!==adNorm(it.ex.en)?`<p class="accepted-answer">✓ 내가 말한 표현도 맞아요: ${escapeHtml(it._lastHeard)}</p>`:''}${notes.length?`<section class="answer-explain prep-explain"><h3>🔤 왜 이 전치사냐면</h3>${notes.map(n=>`<div class="prep-row"><b>${escapeHtml(n.w)}</b><p><strong>${escapeHtml(n.t)}</strong> — ${n.d}</p></div>`).join('')}</section>`:''}${it.frame.tip?`<section class="answer-explain usage-explain"><h3>🧭 언제 쓰는 표현이냐면</h3><div>${it.frame.tip}</div>${it.frame.parts?.length?`<div class="answer-chunks"><h3>✂️ 이렇게 끊어서 보세요 <span>표현 예시</span></h3><div class="chunk-row">${it.frame.parts.map(([en,ko])=>`<span><b>${escapeHtml(en)}</b><small>${escapeHtml(ko)}</small></span>`).join('')}</div>${it.frame.pnote?`<p>${it.frame.pnote}</p>`:''}</div>`:''}</section>`:''}<div class="answer-words"><span>🔍 단어 뜻</span>${words.map(w=>`<button data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('')}</div><div id="answerWordInfo" hidden></div><div class="answer-tools"><button id="answerListen">🔊 다시 듣기</button><button id="answerLoop">🔁 반복 듣기</button><button id="answerSay">🎙 다시 말하기</button><button id="answerStress">📊 문장 강세</button><button id="answerAi">💬 AI 질문</button><button id="answerVocab">📒 단어장</button></div><div id="answerToolInfo" hidden role="status"></div>`;
  const voiceButton=document.createElement('button');voiceButton.id='answerVoice';voiceButton.textContent='🗣 내 목소리 듣기';voiceButton.onclick=listenMyVoice;
  const tools=answer.querySelector('.answer-tools');tools.insertBefore(voiceButton,tools.querySelector('#answerStress'));
  card.className='auto-card has-answer';
  const coach=$('#autoCoach');coach.className='practice-coach practice-feedback';
  const mascot=coach.querySelector('img');if(mascot)mascot.remove();
  card.insertBefore(answer,coach);
  $('#answerListen').onclick=()=>speakEn(it.ex.en);
  $('#answerLoop').onclick=()=>{if(answerLoopTimer){stopAnswerLoop();$('#answerLoop').textContent='🔁 반복 듣기';}else{const play=()=>{if(!answer.isConnected)return stopAnswerLoop();speakEn(it.ex.en);answerLoopTimer=setTimeout(play,Math.max(4500,it.ex.en.length*95));};play();$('#answerLoop').textContent='⏹ 반복 멈추기';}};
  $('#answerSay').onclick=()=>autoDrillRender(true);
  answer.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>{const w=b.dataset.word,info=$('#answerWordInfo'),meaning=FREQ_DICT[w]||FREQ_DICT[w.replace(/s$/,'')]||'';info.hidden=false;info.innerHTML=`<b>${escapeHtml(w)}</b><span>${escapeHtml(meaning||'이 단어의 뜻은 AI 질문에서 물어볼 수 있어요.')}</span><button id="saveAnswerWord">＋ 단어장에 저장</button>`;$('#saveAnswerWord').onclick=()=>{const saved=hGet('speakingroom:answer_vocab',{});saved[w]={en:w,ko:meaning};hSet('speakingroom:answer_vocab',saved);$('#saveAnswerWord').textContent='✓ 저장했어요';};speakEn(w);});
  $('#answerStress').onclick=()=>{const info=$('#answerToolInfo');info.hidden=false;info.innerHTML='<h3>문장에서 힘을 주어 말할 부분</h3><p class="stress-sentence">'+it.ex.en.split(/(\s+)/).map(w=>words.includes(adNorm(w))?`<b>${escapeHtml(w)}</b>`:escapeHtml(w)).join('')+'</p><small>내용을 전달하는 낱말은 또렷하게, 연결하는 말은 가볍게 말해보세요.</small>';};
  $('#answerAi').onclick=()=>{const ov=openSheet('이 표현, 더 알고 싶어요'),host=ov.querySelector('#sheetContent');host.innerHTML=`<p class="question-expression">${escapeHtml(it.ex.en)}</p><textarea id="answerQuestion" placeholder="예: 여기서 for를 쓰는 이유가 뭐예요?"></textarea><button id="askAnswerQuestion" class="primary">질문하기</button><p id="answerQuestionReply" role="status"></p>`;host.querySelector('#askAnswerQuestion').onclick=async()=>{const q=host.querySelector('#answerQuestion').value.trim(),out=host.querySelector('#answerQuestionReply'),button=host.querySelector('#askAnswerQuestion');if(!q)return;if(window.SpeakingRoomNative){let status;try{status=await window.srNativeRequest('status');}catch(e){out.textContent=e.message;return;}if(!status.ready){out.textContent='ChatGPT 연결을 마친 뒤 질문할 수 있어요.';await window.srNativeRequest('settings');return;}}button.disabled=true;out.textContent='설명을 준비하고 있어요…';try{const r=await callClaude('Explain this English expression to a Korean beginner in concise Korean. Expression: '+it.ex.en,[{role:'user',content:q}]);out.textContent=extractText(r);}catch(e){out.textContent=e.message;}finally{button.disabled=false;}};};
  $('#answerVocab').onclick=()=>{const ov=openSheet('내 단어장'),saved=Object.values(hGet('speakingroom:answer_vocab',{})),host=ov.querySelector('#sheetContent');host.innerHTML=saved.length?saved.map(w=>`<button class="vocab-item" data-vocab="${escapeHtml(w.en)}"><b>${escapeHtml(w.en)}</b><span>${escapeHtml(w.ko||'뜻을 확인해보세요')}</span><span>🔊</span></button>`).join(''):'<p class="muted">위의 단어를 누르고 저장하면 여기에 모여요.</p>';host.querySelectorAll('[data-vocab]').forEach(b=>b.onclick=()=>speakEn(b.dataset.vocab));};
  $('#autoStat').textContent=message+(it._lastHeard?`\n내가 말한 문장: ${it._lastHeard}`:'');
  card.querySelector('.auto-actions').innerHTML=(retry?'<button id="autoRetry" class="primary">가리고 다시 말하기</button>':'')+'<button id="autoNext" class="'+(retry?'quiet':'primary')+'">다음 →</button>';
  if($('#autoRetry'))$('#autoRetry').onclick=()=>autoDrillRender(true);
  $('#autoNext').onclick=()=>autoDrillAdvance(perfect,it);speakEn(it.ex.en);
}
function autoDrillAdvance(perfect,it){
  const next=autoDrill.idx+1;if(autoDrill.items[next]&&autoDrill.items[next].frame.id===it.frame.id){const swap=autoDrill.items.findIndex((x,i)=>i>next&&x.frame.id!==it.frame.id);if(swap>0)[autoDrill.items[next],autoDrill.items[swap]]=[autoDrill.items[swap],autoDrill.items[next]];}
  autoDrill.idx++;autoDrillRender();
}
function autoDrillDone(){
  if(!autoDrill)return;stopMicrophone();clearAnswerVoice();svStop();if(TTS)TTS.cancel();
  const rows=autoDrill.results,title=autoDrill.title,correct=rows.filter(r=>r.ok).length;
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
function speakEn(text){if(!text)return;if(qzRecording)stopMicrophone();stopMyVoice();const epoch=sessionEpoch;svSpeak(text,levelRate()).then(ok=>{if(epoch!==sessionEpoch||ok||!TTS||!SSU)return;TTS.cancel();const u=new SSU(text);u.lang='en-US';u.rate=levelRate();TTS.speak(u);});}
async function micFillCb(rawCb,refText=''){
  if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}
  const epoch=micEpoch,cb=(text,meta)=>{if(epoch===micEpoch)rawCb(text,meta);};
  if(window.srNativeRequest && window.srNativePracticeSpeech==null){
    try{const status=await window.srNativeRequest('status');window.srNativePracticeSpeech=!!status.practiceSpeech;}catch(e){cb('',{sttErr:'앱의 음성 기능 연결을 확인하지 못했어요. 앱을 다시 열어주세요. '+e.message});return;}
    if(epoch!==micEpoch)return;
  }
  if(window.srNativeRequest && !window.srNativePracticeSpeech){cb('',{sttErr:'학습 화면은 최신이지만 설치된 앱의 음성 기능은 이전 버전이에요. Play 스토어에서 앱을 0.5.3 이상으로 업데이트해주세요.'});return;}
  if(window.srNativePracticeSpeech){
    qzRecording=true;const startAt=Date.now();
    try{const result=await window.srNativeRequest('recognize',{recordAnswer:!!refText});if(epoch!==micEpoch)return;cb(result.text||'',{startAt,speechStartAt:null,spoke:!!result.text,recordingBlob:nativeRecordingBlob(result)});}
    catch(e){cb('',{sttErr:e.message});}
    finally{if(epoch===micEpoch)qzRecording=false;}
    return;
  }
  try{
    const wait=micCooldownLeft();if(wait)await new Promise(r=>setTimeout(r,wait));if(epoch!==micEpoch)return;
    const stream=await micStreamGet();if(epoch!==micEpoch){micStreamRelease();return;}
    const meta={startAt:Date.now(),speechStartAt:null,spoke:false},live=micLiveStart(),chunks=[],mime=getBestMime();
    qzMR=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);const actualMime=qzMR.mimeType||mime;
    qzMR.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    qzMR.onstop=async()=>{
      if(epoch!==micEpoch){micLiveStop(live);return;}
      vadCancel();qzRecording=false;micStartCooldown();micStreamIdle();meta.stopAt=Date.now();
      try{
        const raw=new Blob(chunks,{type:actualMime});if(raw.size>=400)meta.recordingBlob=raw;
        const device=await micLiveWait(live,900);if(epoch!==micEpoch)return;
        if(device&&device.text)return cb(device.text,meta);
        if(raw.size<400)return cb('',meta);
        const response=await sttRecognize(raw,actualMime);if(!response.ok)throw new Error('음성 인식 연결 오류 ('+response.status+')');
        const data=await response.json();let text=data.DisplayText||(data.NBest&&data.NBest[0]&&(data.NBest[0].Display||data.NBest[0].Lexical))||'';
        if(text&&(!meta.spoke||meta.stopAt-meta.startAt<700)&&STT_HALLUC.test(text.trim()))text='';
        if(/[\uac00-\ud7af]/.test(text)){const roman=hanRoman(text);text=refText&&phCloseHan(roman,refText)?refText:roman;}
        cb(String(text).trim(),meta);
      }catch(e){cb('',{...meta,sttErr:e.message});}
    };
    qzMR.start(250);qzRecording=true;
    vadArm(stream,{...VAD_OPTS,silenceMs:450,maxSilenceMs:1400,maxMs:25000,noSpeechMs:7000,expectWords:refText.trim().split(/\s+/).length,onSpeechStart:t=>{meta.spoke=true;meta.speechStartAt=t;}});
  }catch(e){micStreamRelease();qzRecording=false;cb('',{sttErr:'녹음을 시작하지 못했어요. ('+String(e.name||'Error')+') '+String(e.message||'')});}
}
function forceUpdate(){if(curScreen!=='setup')return showError('홈에서 업데이트를 확인해주세요.');if(window.SpeakingRoomNative)return window.srNativeRequest('webupdate').catch(showError);location.reload();}
async function checkForUpdate(){
  if(window.SpeakingRoomNative)return;
  try{const r=await fetch('practice.js?cb='+Date.now(),{cache:'no-store'});if(!r.ok)return;const v=(await r.text()).match(/APP_VERSION="([^"]+)"/);if(v&&v[1]!==APP_VERSION&&curScreen==='setup')location.reload();}catch(_){}
}
$('#engTravel').onclick=()=>startTravelDrill(10,true,true);$('#engStudy').onclick=openTravelStudyPicker;$('#engMiss').onclick=openMissPicker;$('#engReal').onclick=openSurvival;
$('#chatBack').onclick=goToSetup;$('#sendBtn').onclick=sendMessage;$('#helpBtn').onclick=askHelp;$('#fbBtn').onclick=getFeedback;
$('#msg').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}};
$('#micBtn').onclick=()=>{if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}if(state.busy)return;svStop();if(TTS)TTS.cancel();$('#micBtn').textContent='말하기 끝';micFillCb((text,meta)=>{$('#micBtn').textContent='🎤';if(text){msg.value=text;sendMessage();}else addCoachTurn(meta.sttErr||'잘 들리지 않았어요. 다시 말해주세요.',false);});};
$('#ttsBtn').onclick=function(){state.ttsOn=!state.ttsOn;this.setAttribute('aria-pressed',String(state.ttsOn));if(!state.ttsOn){svStop();if(TTS)TTS.cancel();}};
$('#verFoot').textContent='업데이트 확인';$('#verFoot').onclick=forceUpdate;
window.addEventListener('popstate',()=>{const sheet=$('#practiceSheet');if(sheet)sheet.remove();else goToSetup();});
window.addEventListener('pagehide',()=>{stopMicrophone();svStop();});
goToSetup();checkForUpdate();
