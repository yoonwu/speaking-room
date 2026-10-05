/* Android capabilities belong to AI conversation; no separate practice modes. */
(()=>{
 const bridge=window.SpeakingRoomNative;if(!bridge)return;
 const pending=new Map(),seen=new Set();let sequence=0,voice=false;
 bridge.onmessage=event=>{const m=JSON.parse(event.data),entry=pending.get(m.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(m.id);m.ok?entry.resolve(m.result):entry.reject(new Error(m.error));};
 window.srNativeRequest=(action,data={})=>new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(new Error('요청 시간이 초과되었습니다.'));},120000);pending.set(id,{resolve,reject,timer});try{bridge.postMessage(JSON.stringify({id,action,data}));}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}});
 const controls=document.getElementById('nativeVoiceControls'),start=document.getElementById('nativeVoiceStart'),stop=document.getElementById('nativeVoiceStop'),status=document.getElementById('nativeVoiceStatus');controls.hidden=false;
 const attempt=async fn=>{try{await fn();}catch(e){status.textContent=e.message;}};
 window.srNativeRefresh=()=>attempt(async()=>{const s=await window.srNativeRequest('status');window.srNativePracticeSpeech=!!s.practiceSpeech;if(window.srAiEntryRefresh)window.srAiEntryRefresh(s);if(voice&&!s.running)setBusy(false);voice=s.running;start.hidden=voice;stop.hidden=!voice;status.textContent=s.ready?'ChatGPT 연결됨':s.connected?'ChatGPT 로그인됨 · 모델 선택과 연결 테스트를 마쳐주세요.':'AI 대화를 사용하려면 ChatGPT 연결 설정을 완료해주세요.';});
 document.getElementById('nativePlanSettings').onclick=()=>attempt(()=>window.srNativeRequest('settings'));
 start.onclick=()=>attempt(async()=>{if(!state.scn||!state.convo.length||state.busy)throw new Error('상대의 첫 말을 받은 뒤 음성 대화를 시작해주세요.');if(TTS)TTS.cancel();svStop();stopMicrophone();await window.srNativeRequest('voice',{instructions:rolePrompt(),history:state.convo.map(t=>({role:t.role,content:t.text}))});voice=true;setBusy(true);start.hidden=true;stop.hidden=false;});
 stop.onclick=()=>attempt(async()=>{await window.srNativeRequest('stop');voice=false;setBusy(false);start.hidden=false;stop.hidden=true;});
 window.srNativeEvents=json=>{for(const e of JSON.parse(json)){if(seen.has(e.id))continue;seen.add(e.id);if(e.kind==='status'){voice=e.running;status.textContent=e.text;start.hidden=voice;stop.hidden=!voice;if(!voice)setBusy(false);continue;}if(curScreen!=='talk'||!state.scn)continue;if(e.kind==='user'){state.convo.push({role:'user',text:e.text});addMeTurn(e.text);}if(e.kind==='assistant'){const text=stripUsedMarker(e.raw).clean;if(!e.help){state.convo.push({role:'assistant',text});if(typeof recordAiPractice==='function')recordAiPractice();}addCoachTurn(text,false);}}return true;};
 const leave=goToSetup;goToSetup=function(...args){if(voice){window.srNativeRequest('stop').catch(()=>{});voice=false;setBusy(false);start.hidden=false;stop.hidden=true;}return leave.apply(this,args);};
})();
