/* Four practice modes only. Learning records retain their existing storage keys. */
const APP_VERSION="v4.3.7", APP_BUILD="2026-10-02";
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
function stopMicrophone(){ micEpoch++; if(window.srNativePracticeSpeech)window.srNativeRequest("recognizeCancel").catch(()=>{}); vadCancel(); micLiveStop(_micLive); if(qzMR&&qzMR.state!=="inactive")try{qzMR.stop();}catch(_){} qzRecording=false;micStreamRelease(); }
function goToSetup(){
  sessionEpoch++; stopMicrophone(); if(TTS)TTS.cancel(); svStop();
  if(autoDrill&&autoDrill.hintTimer)clearTimeout(autoDrill.hintTimer);
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
  const items=frames.map(f=>{const ex=travelPickItem(f,records);return {_travel:true,_difficulty:typeof alGet==='function'?alGet().speak:1,frame:f,block:{id:f.id,block:f.frame},ex:{en:ex.en,ko:ex.ko,situation:f.purpose},limit:3};});
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
function missBuildItems(list){return list.filter(m=>TRAVEL_BY_ID[m.fid]).map(m=>{const f=TRAVEL_BY_ID[m.fid];return {_travel:true,_miss:true,frame:f,block:{id:f.id,block:f.frame},ex:{en:m.en,ko:m.ko||travelKrOf(m.en)||f.ko,situation:f.purpose},limit:3,_intro:false};});}
function openMissPicker(){
  const ov=openSheet('자주 틀리는 문장'),content=ov.querySelector('#sheetContent');
  const list=missList();
  content.innerHTML=list.length?`<p class="muted">연속 ${MISS_GRADUATE}번 맞히면 목록에서 빠져요.</p>`+list.map(m=>`<div class="miss-row"><b>${escapeHtml(m.en)}</b><span>${escapeHtml(m.ko||travelKrOf(m.en))}</span><small>${m.miss}번 틀림 · 연속 ${m.streak||0}번 정답</small></div>`).join('')+'<button id="missStart" class="primary">틀린 문장 반복하기</button>':'<p class="empty">기본표현을 연습하다 틀린 문장이 여기에 모여요.</p>';
  const start=content.querySelector('#missStart');if(start)start.onclick=()=>{ov.remove();startMissDrill(list.slice(0,30));};
}
function startMissDrill(list){const items=missBuildItems(list);for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}if(items.length)startDrill(items,'자주 틀리는 문장');}
function startDrill(items,title){
  goToSetup();autoDrill={items,idx:0,results:[],title,t0:0,hintTimer:null,typedAt:null};
  curScreen='sprint';setup.hidden=true;setup.style.display='none';$('#sprint').hidden=false;autoDrillRender();
}
function autoDrillRender(recall=false){
  if(!autoDrill)return;if(autoDrill.idx>=autoDrill.items.length)return autoDrillDone();
  stopMicrophone();svStop();if(TTS)TTS.cancel();
  const it=autoDrill.items[autoDrill.idx];it.recall=recall;
  if(it._intro==null){it._intro=!travelStat(it.frame.id).introduced;if(it._intro)travelMarkIntroduced(it.frame.id);}
  if(autoDrill.hintTimer)clearTimeout(autoDrill.hintTimer);
  const host=$('#sprintScroll');host.innerHTML=`<div class="auto-card"><div class="practice-top"><button id="autoExit" class="quiet">‹ 끝내기</button><span>${autoDrill.idx+1} / ${autoDrill.items.length}</span></div><p class="eyebrow">${escapeHtml(autoDrill.title)}</p>${typeof basicDifficultyLabel==='function'?`<p class="difficulty-note">${escapeHtml(basicDifficultyLabel(it._difficulty))}</p>`:''}<h2>${it._intro&&!recall?escapeHtml(it.frame.frame):'상황을 보고 말해보세요'}</h2>${it._intro&&!recall?`<p class="intro">${escapeHtml(it.frame.ko)}<br><b>${escapeHtml(it.ex.en)}</b></p>`:''}<p class="situation">${escapeHtml(it.ex.ko)}</p><p id="autoStat" class="muted">${recall?'방금 본 문장을 가렸어요. 기억에서 꺼내보세요.':'상황을 먼저 읽고, 영어로 말해보세요.'}</p><div class="auto-actions"><button class="primary" id="autoMic">🎤 터치해서 말하기</button><button class="quiet" id="autoType">직접 입력</button><input id="autoInput" class="auto-input" placeholder="영어로 입력 후 Enter" autocomplete="off" hidden><div id="autoHintRow" hidden><button class="quiet" id="autoWord">단어 힌트</button><button class="quiet" id="autoShow">표현 보기</button></div></div></div>`;
  autoDrill.t0=Date.now();autoDrill.typedAt=null;pendingReply=false;
  $('#autoExit').onclick=autoDrillDone;
  $('#autoMic').onclick=async()=>{if(qzRecording){if(window.srNativePracticeSpeech)window.srNativeRequest('recognizeStop').catch(()=>{});else if(qzMR&&qzMR.state!=='inactive')qzMR.stop();return;}if(pendingReply)return;svStop();if(TTS)TTS.cancel();$('#autoMic').textContent='말한 뒤 다시 누르면 끝나요';$('#autoStat').textContent='듣고 있어요…';await micFillCb((text,meta)=>{if(!autoDrill)return;autoDrillFinish(text,meta);},it.ex.en);};
  $('#autoType').onclick=()=>{$('#autoInput').hidden=false;$('#autoInput').focus();};
  $('#autoInput').oninput=()=>{if(!autoDrill.typedAt)autoDrill.typedAt=Date.now();};
  $('#autoInput').onkeydown=e=>{if(e.key==='Enter'&&e.target.value.trim()&&!pendingReply){e.preventDefault();autoDrillFinish(e.target.value.trim(),{speechStartAt:autoDrill.typedAt,typed:true});}};
  $('#autoShow').onclick=()=>{stopMicrophone();it._hintUsed=true;autoDrillShowResult(it,true,false);};
  $('#autoWord').onclick=()=>{it._hintUsed=true;$('#autoStat').textContent=adWordHint(it)||'이 표현은 통째로 기억해보세요.';};
  const epoch=sessionEpoch,index=autoDrill.idx;
  autoDrill.hintTimer=setTimeout(()=>{if(autoDrill&&epoch===sessionEpoch&&autoDrill.idx===index&&$('#autoHintRow'))$('#autoHintRow').hidden=false;},7000+travelReadMs(it));
}
function autoDrillFinish(heard,meta={}){
  if(!autoDrill||pendingReply)return;
  if(!heard){$('#autoStat').textContent=meta.sttErr||'잘 들리지 않았어요. 다시 말하거나 직접 입력해주세요.';$('#autoMic').textContent='🎤 다시 말하기';return;}
  pendingReply=true;stopMicrophone();if(autoDrill.hintTimer)clearTimeout(autoDrill.hintTimer);
  const it=autoDrill.items[autoDrill.idx],g=travelGrade(it,heard),perfect=g.ok&&!it._hintUsed;
  it._lastHeard=heard;it._lastOk=g.ok;
  travelRecord(it.frame.id,g.ok);missRecord(it,g.ok);autoDrill.results.push({ok:g.ok,perfect,en:it.ex.en,heard});
  if(typeof recordPractice==='function'){recordPractice({it,heard,ok:g.ok,perfect,meta,started:autoDrill.t0,mode:autoDrill.title});autoDrill.results[autoDrill.results.length-1].xp=it._earnedXP||0;}
  if(!perfect&&(it._requeues||0)<2){const again={...it,_intro:false,_hintUsed:false,_requeues:(it._requeues||0)+1,_lastHeard:'',_lastOk:false};if(!it._requeues)autoDrill.items.splice(Math.min(autoDrill.items.length,autoDrill.idx+5+Math.floor(Math.random()*3)),0,again);else autoDrill.items.push(again);}
  const message=perfect?'상황에 맞게 말했어요.':g.ok?'표현을 보고 말했어요. 다음엔 상황만 보고 꺼내보세요.':g.meaningOnly?`뜻은 통하지만 이번에는 ${it.frame.frame} 표현으로 연습해보세요.`:g.keyMiss?'표현은 맞았어요. 상황에 맞는 핵심 낱말을 넣어보세요.':`이번에는 ${it.frame.frame} 표현으로 말해보세요.`;
  autoDrillShowResult(it,!perfect,perfect,message+(it._rewardMessage?'\n'+it._rewardMessage:''));
}
function autoDrillShowResult(it,retry,perfect,message='표현을 보고 다시 말해보세요.'){
  if(autoDrill.hintTimer)clearTimeout(autoDrill.hintTimer);pendingReply=true;
  const card=document.querySelector('.auto-card'),old=$('#autoAnswer');if(old)old.remove();
  const answer=document.createElement('div');answer.id='autoAnswer';answer.className='answer';
  answer.innerHTML=`<small>이렇게 말하면 돼요</small><b>${escapeHtml(it.ex.en)}</b>${it._lastOk&&adNorm(it._lastHeard)!==adNorm(it.ex.en)?`<p>내가 말한 표현도 맞아요: ${escapeHtml(it._lastHeard)}</p>`:''}<button id="answerListen" class="quiet">🔊 듣기</button>${it.frame.tip?`<details><summary>언제 쓰는 표현인가요?</summary><div>${it.frame.tip}</div></details>`:''}`;
  card.insertBefore(answer,$('#autoStat'));$('#answerListen').onclick=()=>speakEn(it.ex.en);
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
  if(!autoDrill)return;stopMicrophone();if(autoDrill.hintTimer)clearTimeout(autoDrill.hintTimer);svStop();if(TTS)TTS.cancel();
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
    if(connected){content.querySelector('.ai-connect h3').innerHTML='ChatGPT 로그인은 완료됐어요';content.querySelector('.ai-connect p').textContent='대화를 시작하려면 모델 선택과 연결 테스트를 마쳐주세요.';content.querySelector('#connectChatGPT').textContent='연결 마무리하기 →';content.querySelector('#aiConnectStatus').textContent='설정에서 모델 불러오기 → 모델 선택 → 연결 테스트를 진행해주세요. 다시 로그인할 필요는 없어요.';}
    content.querySelector('#connectChatGPT').onclick=()=>window.srNativeRequest('settings').catch(e=>{content.querySelector('#aiConnectStatus').textContent=e.message;});
  };
  const refresh=s=>{if(ov.isConnected===false)return;if(s.ready)scenes();else connection(!!s.connected);};
  window.srAiEntryRefresh=refresh;
  content.innerHTML='<p class="muted" role="status">ChatGPT 연결을 확인하고 있어요…</p>';
  window.srNativeRequest('status').then(refresh).catch(()=>{if(ov.isConnected!==false)connection();});
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
function speakEn(text){if(!text)return;const epoch=sessionEpoch;svSpeak(text,levelRate()).then(ok=>{if(epoch!==sessionEpoch||ok||!TTS||!SSU)return;TTS.cancel();const u=new SSU(text);u.lang='en-US';u.rate=levelRate();TTS.speak(u);});}
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
    try{const result=await window.srNativeRequest('recognize');cb(result.text||'',{startAt,speechStartAt:null,spoke:!!result.text});}
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
        const device=await micLiveWait(live,900);if(epoch!==micEpoch)return;
        if(device&&device.text)return cb(device.text,meta);
        const raw=new Blob(chunks,{type:actualMime});if(raw.size<400)return cb('',meta);
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
