/* Optional, credit-gated practice assessment. No credentials or target-text STT hints. */
const PracticeAI=(()=>{
  const MODE_KEY='speakingroom:pronunciation_mode_v1',USAGE_KEY='speakingroom:grading_usage_v1';
  let epoch=0,statusCache=null,statusAt=0,statusPending=null,realtimeCache=null,realtimeAt=0,realtimePending=null,realtimeCooldown=0;
  const active=new Set(),requests=new Map();
  const profile=()=>typeof learningProfileId==='function'?learningProfileId():'legacy';
  const newId=()=>window.crypto?.randomUUID?window.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const getMode=()=>hGet(MODE_KEY,'accuracy')==='meaning'?'meaning':'accuracy';
  function cancel(){epoch++;for(const c of active)c.abort();active.clear();requests.clear();}
  function setMode(mode){if(mode!=='accuracy'&&mode!=='meaning')throw Error('판정 방식을 다시 선택해주세요.');cancel();hSet(MODE_KEY,mode);}
  const reasonText=reason=>({ai_disabled:'의미 중심 기능을 준비 중이에요. 정확도 중심 연습은 계속 사용할 수 있어요.',api_key_missing:'의미 중심 기능을 준비 중이에요.',credits_unverified:'운영자의 API 크레딧 확인이 필요해요.',credit_scope_mismatch:'운영자의 API 연결 확인이 필요해요.',credits_expired:'의미 중심 기능의 크레딧이 만료됐어요.',credit_check_stale:'운영자의 API 크레딧 재확인이 필요해요.',budget_unconfigured:'의미 중심 기능의 사용 한도 설정이 필요해요.',budget_exhausted:'의미 중심 기능의 이번 달 사용 한도에 도달했어요.',upstream_quota:'의미 중심 기능의 API 크레딧 또는 사용 한도를 확인해야 해요.',rate_limited:'요청이 많아요. 잠시 뒤 다시 말해주세요.',upstream_timeout:'음성 판정 응답이 늦어요. 다시 말해주세요.',storage_unavailable:'의미 중심 기능을 잠시 사용할 수 없어요.'}[reason]||'의미 중심 기능에 연결하지 못했어요. 잠시 뒤 다시 시도해주세요.');
  async function receive(path,options={},timeout=13000,guard=true){
    const generation=epoch,owner=profile(),controller=new AbortController();active.add(controller);
    const task=async()=>{
      const r=await fetch(PROXY_URL+path,{...options,credentials:'omit',signal:controller.signal});
      const raw=await r.text();if(raw.length>100000)throw Error('판정 응답이 올바르지 않아요.');
      if(guard&&(generation!==epoch||owner!==profile()))throw Object.assign(Error('이전 연습 요청을 취소했어요.'),{cancelled:true});
      let data;try{data=JSON.parse(raw);}catch(e){throw Error('판정 응답을 읽지 못했어요. 다시 시도해주세요.');}
      if(!r.ok||data.ok===false){const code=data.error?.code||data.reason||'upstream_error';throw Object.assign(Error(reasonText(code)),{code});}
      return data;
    };
    try{return await speechWait(task(),timeout,'의미 판정 응답이 늦어요. 다시 말해주세요.',()=>controller.abort());}
    finally{controller.abort();active.delete(controller);}
  }
  async function status(force=false){
    if(!force&&statusCache&&Date.now()-statusAt<60000)return statusCache;
    if(statusPending)return statusPending;
    statusPending=receive('/practice-ai/status',{},4000,false).then(s=>{statusCache=s;statusAt=Date.now();return s;}).finally(()=>{statusPending=null;});
    return statusPending;
  }
  async function ensureReady(){const s=await status();if(!s.enabled||!s.creditsVerified)throw Object.assign(Error(reasonText(s.reason)),{code:s.reason||'ai_disabled'});return s;}
  function prepareRealtime(){if(Date.now()<realtimeCooldown)return Promise.resolve({available:false});if(realtimeCache&&Date.now()-realtimeAt<60000)return Promise.resolve(realtimeCache);if(realtimePending)return realtimePending;realtimePending=receive('/practice-realtime/status',{},4000,false).then(s=>{realtimeCache=s;realtimeAt=Date.now();return s;}).finally(()=>{realtimePending=null;});return realtimePending;}
  function disableRealtime(){realtimeCooldown=Date.now()+300000;}
  const realtimeReady=()=>Date.now()>=realtimeCooldown&&realtimeCache?.available===true&&Date.now()-realtimeAt<120000;
  function recordUsage(requestId,kind,usage){
    if(!usage)return;const events=hGet(USAGE_KEY,{})||{},key=kind+':'+requestId;if(events[key])return;
    events[key]={t:Date.now(),kind,estimatedUsd:Math.max(0,Math.min(1,Number(usage.estimatedUsd)||0)),model:String(usage.model||'').slice(0,80),elapsedMs:Math.max(0,Number(usage.elapsedMs)||0),calls:Number.isFinite(usage.calls)?Math.max(0,usage.calls):1};
    const ids=Object.keys(events).sort((a,b)=>events[b].t-events[a].t);for(const id of ids.slice(500))delete events[id];hSet(USAGE_KEY,events);
  }
  function usage(){const month=new Date().toISOString().slice(0,7),events=Object.values(hGet(USAGE_KEY,{})||{}).filter(e=>e&&Number.isFinite(e.t)&&new Date(e.t).toISOString().slice(0,7)===month),count=kind=>events.filter(e=>!kind||e.kind===kind).reduce((n,e)=>n+(Number(e.calls)||0),0);return {calls:count(),transcribe:count('transcribe'),judge:count('judge'),estimatedUsd:events.reduce((n,e)=>n+(Number(e.estimatedUsd)||0),0)};}
  function once(key,fn){if(requests.has(key))return requests.get(key);const task=Promise.resolve().then(fn);requests.set(key,task);if(requests.size>40)requests.delete(requests.keys().next().value);return task;}
  async function transcribe(blob,meta={},requestId=newId()){
    const owner=profile(),generation=epoch;
    return once(owner+':stt:'+requestId,async()=>{
      await ensureReady();if(generation!==epoch||owner!==profile())throw Object.assign(Error('이전 연습 요청을 취소했어요.'),{cancelled:true});
      if(!blob||blob.size<=44||blob.size>1048576)throw Error('녹음된 소리를 확인하지 못했어요. 다시 말해주세요.');
      const data=await receive('/practice-ai/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Practice-Request-Id':requestId},body:blob});
      recordUsage(requestId,'transcribe',data.usage);
      const text=String(data.transcript??data.DisplayText??'').trim();
      // Keep provider bytes as evidence. Never replace Korean/unclear output with the target.
      if(data.retry||!/[a-z]/i.test(text)||/[\uac00-\ud7a3]/.test(text)||STT_HALLUC.test(text))return '';
      meta.aiTranscription={requestId,elapsedMs:Number(data.usage?.elapsedMs)||0};return text;
    });
  }
  function localDecision(it,heard){
    const text=String(heard||'').trim(),expected=String(it.ex.en||'');
    if(!/[a-z]/i.test(text)||/[\uac00-\ud7a3]/.test(text)||STT_HALLUC.test(text))return {decided:true,ok:false,retry:true,reason:'unintelligible'};
    const numbers={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
    const normalize=t=>travelMeaningNorm(t).replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,w=>String(numbers[w]));
    const a=normalize(expected),b=normalize(text),nums=t=>(t.match(/\b\d+\b/g)||[]).filter(n=>n!=='1');
    // Negation, direction, required modifiers and explicit quantities are never guessed away.
    const guardA=a.replace(/\b1\b/g,''),guardB=b.replace(/\b1\b/g,'');
    if(nums(a).join('|')!==nums(b).join('|')||!travelMeaningGuard(guardA,guardB))return {decided:true,ok:false,retry:false,reason:'meaning_changed'};
    const candidates=travelAnswerAlternatives(it);
    if(candidates.some(x=>normalize(x)===b))return {decided:true,ok:true,retry:false,reason:'equivalent',local:true};
    // Clearly equivalent requests with the same content do not need another paid model call.
    const request=t=>t.replace(/^(?:can|could|may) i (?:get|have)\b/,'request').replace(/^(?:i (?:want|need|would like)|id like)\b/,'request').replace(/^(?:can|could) you (?:give|bring)(?: me)?\b/,'request');
    if(request(a).startsWith('request ')&&request(a)===request(b))return {decided:true,ok:true,retry:false,reason:'equivalent',local:true};
    const key=travelKeyOf(it).key||[],content=adWords(text);
    const itemGroups=[['water','coffee','tea','juice','beer','milk'],['towel','fork','spoon','knife','blanket','pillow'],['phone','ticket','passport','wallet','bag']];
    for(const group of itemGroups){const wanted=key.filter(w=>group.includes(w));if(wanted.length&&content.some(w=>group.includes(w)&&!wanted.includes(w))&&!wanted.every(w=>content.includes(w)))return {decided:true,ok:false,retry:false,reason:'meaning_changed'};}
    return {decided:false,ok:false,retry:false,reason:'uncertain'};
  }
  async function judge(it,heard,requestId=newId()){
    const local=localDecision(it,heard);if(local.decided)return local;
    const owner=profile(),generation=epoch;
    return once(owner+':judge:'+requestId,async()=>{
      await ensureReady();if(generation!==epoch||owner!==profile())throw Object.assign(Error('이전 연습 요청을 취소했어요.'),{cancelled:true});
      const data=await receive('/practice-ai/judge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,expected:it.ex.en,transcript:String(heard).trim()})},7000);
      recordUsage(requestId,'judge',data.usage);
      if(typeof data.pass!=='boolean'||typeof data.retry!=='boolean')throw Error('의미 판정 결과를 확인하지 못했어요. 다시 말해주세요.');
      const recheck=localDecision(it,heard);if(data.pass&&recheck.decided&&!recheck.ok)return recheck;
      return {decided:true,ok:data.pass&&!data.retry,retry:data.retry,reason:data.reason||'uncertain',local:false};
    });
  }
  return {getMode,setMode,cancel,status,ensureReady,prepareRealtime,realtimeReady,disableRealtime,transcribe,localDecision,judge,usage,newId,reasonText};
})();
window.PracticeAI=PracticeAI;

function renderPronunciationSettings(host){
  if(!host)return;const mode=PracticeAI.getMode(),u=PracticeAI.usage();
  host.innerHTML=`<div class="prof-h">발음 판정 방식</div><label class="grading-choice"><input type="radio" name="pronunciationMode" value="accuracy" ${mode==='accuracy'?'checked':''}><span><b>정확도 중심</b><small>발음까지 정확하게 연습 · 기존 판정</small></span></label><label class="grading-choice"><input type="radio" name="pronunciationMode" value="meaning" ${mode==='meaning'?'checked':''}><span><b>의미 중심</b><small>발음이 조금 달라도 문장을 이해하면 통과</small></span></label><p class="muted">의미 중심은 녹음을 OpenAI에서 인식하고, 필요한 경우 문장의 뜻을 확인해요. 말하지 않은 답을 추측해 통과시키지 않아요.</p><p id="gradingAvailability" class="muted" role="status"></p><p class="muted">이번 달 이 프로필의 의미 중심 사용: 음성 ${u.transcribe}회 · 뜻 확인 ${u.judge}회 · 예상 $${u.estimatedUsd.toFixed(6)}<br>이 기기의 기록이며 실제 결제·남은 크레딧과는 달라요.</p><button id="gradingStatusRefresh" class="quiet">의미 중심 연결 확인</button>`;
  const out=host.querySelector('#gradingAvailability');
  const check=async()=>{out.textContent='의미 중심 연결을 확인하고 있어요…';try{const s=await PracticeAI.status(true);if(host.isConnected===false)return;out.textContent=s.enabled&&s.creditsVerified?'의미 중심을 사용할 수 있어요. 운영자가 확인한 크레딧과 사용 한도 안에서 요청해요.':PracticeAI.reasonText(s.reason)+' 정확도 중심 연습은 이용할 수 있어요.';}catch(e){if(host.isConnected!==false)out.textContent=e.message;}};
  host.querySelectorAll('[name="pronunciationMode"]').forEach(input=>input.onchange=()=>{if(!input.checked)return;PracticeAI.setMode(input.value);if(input.value==='meaning')check();else out.textContent='기존 음성 인식과 문장 판정으로 연습해요.';if(typeof supportQueueSync==='function')supportQueueSync();});
  host.querySelector('#gradingStatusRefresh').onclick=check;
  if(mode==='meaning')check();else out.textContent='기존 음성 인식과 문장 판정으로 연습해요.';
}
