/* Native capabilities attach to the original UI and learning state. No credentials enter JavaScript. */
(() => {
  const bridge = window.SpeakingRoomNative;
  const pending = new Map();
  let sequence = 0, voice = false;
  if (bridge) {
    bridge.onmessage = event => {
      const message = JSON.parse(event.data), entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id);
      message.ok ? entry.resolve(message.result) : entry.reject(new Error(message.error));
    };
    window.srNativeRequest = (action, data = {}) => new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('요청 시간이 초과되었습니다.')); }, action === 'backup' ? 300000 : 120000);
      pending.set(id, {resolve, reject, timer});
      try { bridge.postMessage(JSON.stringify({id, action, data})); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  const style = document.createElement('style');
  style.textContent = '#srNativePanel{width:min(90vw,460px);border:1px solid #cbeadd;border-radius:20px;background:#f4fbf8;color:#3a2d27;padding:22px;max-height:85vh;overflow:auto}#srNativePanel::backdrop{background:#0008}#srNativePanel button{display:block;width:100%;margin:9px 0;padding:13px;border:1px solid #b5e4d2;border-radius:12px;background:white;color:#153b32;font-weight:700}#srNativePanel p{line-height:1.6}#srVoiceButton{position:fixed;right:14px;bottom:100px;z-index:950;padding:10px 14px;border-radius:25px;background:#087f6e;color:white;border:0}';
  document.head.appendChild(style);
  const panel = document.createElement('dialog'); panel.id = 'srNativePanel';
  panel.innerHTML = '<h2>구독 · 음성 연결</h2><p id="srPlanStatus"></p><button id="srPlanSettings">ChatGPT 구독 설정</button><button id="srVoiceStart">현재 대화에서 음성 시작</button><button id="srVoiceReview">지난 대화 반복 · AI 요청 없음</button><button id="srVoiceStop">음성 멈추기</button><p id="srVoiceStatus">기존 스피킹 훈련장에서 상황을 선택하고 대화를 시작한 뒤 음성을 켜세요.</p><hr><p>기존 기록은 같은 동기화 닉네임으로 연결하거나 파일로 가져올 수 있어요.</p><button id="srExportProgress">학습 기록 파일 저장</button><button id="srImportProgress">학습 기록 파일 가져오기</button><input id="srProgressFile" type="file" accept="application/json,.json" hidden><button id="srPanelClose">닫기</button>';
  document.body.appendChild(panel);
  const status = panel.querySelector('#srPlanStatus'), speech = panel.querySelector('#srVoiceStatus');
  const attempt = async fn => { try { await fn(); } catch (error) { speech.textContent = error.message; } };
  window.srNativeRefresh = async () => {
    if (!bridge) { status.textContent = '구독·음성 연결은 통합 안드로이드 앱에서 사용할 수 있어요. 웹에서는 학습 기록을 저장해 가져갈 수 있습니다.'; return; }
    await attempt(async () => { const s = await window.srNativeRequest('status'); status.textContent = s.ready ? 'ChatGPT 구독 연결됨 · 기존 학습의 AI 요청에 적용됩니다.' : '구독 설정에서 로그인 · 모델 선택 · 연결 테스트를 완료해주세요.'; voice=s.running; });
  };
  const show = () => { panel.showModal(); window.srNativeRefresh(); };
  const entry = document.getElementById('nativePlanEntry');
  if (entry) entry.onclick = event => { event.preventDefault(); show(); };
  const floating = document.createElement('button'); floating.id = 'srVoiceButton'; floating.textContent = '🎙 구독·음성'; floating.onclick = show; document.body.appendChild(floating);
  panel.querySelector('#srPanelClose').onclick = () => panel.close();
  panel.querySelector('#srPlanSettings').onclick = () => bridge ? attempt(() => window.srNativeRequest('settings')) : location.assign('android-voice.html');
  panel.querySelector('#srVoiceStart').onclick = () => attempt(async () => {
    if (!bridge) throw new Error('통합 안드로이드 앱에서 열어주세요.');
    if (!state.scn || !state.convo.length || state.busy || state.engine!=='survival' || stage.style.display==='none') throw new Error('먼저 스피킹 훈련장의 실전회화에서 상황을 선택하고 상대의 첫 질문을 받으세요.');
    if(typeof TTS!=='undefined' && TTS) TTS.cancel();
    if(typeof svStop==='function') svStop();
    await window.srNativeRequest('voice', {instructions:rolePrompt(), history:state.convo.map(t=>({role:t.role,content:t.text}))});
    voice=true; setBusy(true); panel.close();
  });
  panel.querySelector('#srVoiceReview').onclick = () => attempt(async()=>{ if(!bridge) throw new Error('통합 안드로이드 앱에서 열어주세요.'); await window.srNativeRequest('review'); voice=true; setBusy(true); panel.close(); });
  panel.querySelector('#srVoiceStop').onclick = () => attempt(async()=>{ if(bridge) await window.srNativeRequest('stop'); voice=false; setBusy(false); speech.textContent='음성을 멈췄습니다.'; });
  const seen = new Set();
  window.srNativeEvents = json => {
    for (const e of JSON.parse(json)) {
      if(seen.has(e.id)) continue; seen.add(e.id);
      if(e.kind==='status') { speech.textContent=e.text; voice=e.running; if(!voice) setBusy(false); continue; }
      if(e.kind==='user') { state.lastViaMic=true; state.lastMicLatencyMs=null; state.convo.push({role:'user',text:e.text}); addMeTurn(e.text); questBump('talk'); }
      if(e.kind==='assistant') {
        const parsed=stripUsedMarker(e.raw); state.convo.push({role:'assistant',text:parsed.clean});
        const automaticSpeech=state.ttsOn; state.ttsOn=false;
        try { addCoachTurn(parsed.clean); } finally { state.ttsOn=automaticSpeech; }
        if(state.engine==='survival' && !e.help) {
          try { if(parsed.ids!==null) { convoRecordUsedBlocks(parsed.ids,e.user); convoRecordVerbTargets(parsed.ids,e.user); } else convoTrackBlocks(e.user); } catch(_) {}
          convoRecordTurnEval(parsed.turnEval,{userText:e.user,coachText:parsed.clean,usedIds:parsed.ids||[]});
        }
      }
    }
    return true;
  };
  // Keep the browser and native wrapper progress portable; exclude developer credentials.
  const progressKey = key => !/^sr_gh_|token|password|secret|api.?key/i.test(key) && !/token|password|secret/i.test(key);
  panel.querySelector('#srExportProgress').onclick = () => attempt(async()=>{
    const records=Object.create(null); for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(progressKey(key)) records[key]=localStorage.getItem(key);}
    const text=JSON.stringify({format:'speaking-room-progress',version:1,records});
    if(bridge) await window.srNativeRequest('backup',{text});
    else { const url=URL.createObjectURL(new Blob([text],{type:'application/json'})); const link=document.createElement('a');link.href=url;link.download='speaking-room-progress.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000); }
    speech.textContent='학습 기록 파일을 저장했습니다.';
  });
  panel.querySelector('#srImportProgress').onclick=()=>panel.querySelector('#srProgressFile').click();
  panel.querySelector('#srProgressFile').onchange=event=>attempt(async()=>{
    if(voice) throw new Error('음성 대화를 멈춘 뒤 기록을 가져와주세요.');
    const file=event.target.files[0];if(!file)return;if(file.size>8000000)throw new Error('기록 파일이 너무 큽니다.');
    const data=JSON.parse(await file.text());if(data.format!=='speaking-room-progress'||data.version!==1||!data.records||typeof data.records!=='object'||Array.isArray(data.records))throw new Error('3초영어 기록 파일이 아닙니다.');
    const entries=Object.entries(data.records);if(entries.some(([key,value])=>!progressKey(key)||typeof value!=='string'))throw new Error('가져올 수 없는 기록이 포함되어 있습니다.');
    if(!confirm('이 기기의 같은 항목을 가져온 학습 기록으로 바꿀까요?'))return;
    const before=new Map(entries.map(([key])=>[key,localStorage.getItem(key)]));
    try { for(const [key,value] of entries)localStorage.setItem(key,value); }
    catch(error){for(const [key,value]of before){try{value===null?localStorage.removeItem(key):localStorage.setItem(key,value);}catch(_){}}throw error;}
    location.reload();
  });
  // Leaving a scenario also stops its microphone session.
  if(bridge && typeof goToSetup==='function') {
    const original=goToSetup;
    goToSetup=function(...args){ if(voice){window.srNativeRequest('stop').catch(()=>{});voice=false;setBusy(false);}return original.apply(this,args); };
  }
})();
