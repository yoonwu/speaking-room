/* Existing travel expressions, adaptive selection, grading and speech helpers. */
const PROXY_URL = "https://speaking-room.thdghkstlr.workers.dev";

const MODEL = "claude-sonnet-4-6";

const FAST_MODEL = "claude-haiku-4-5-20251001";

const STT_SOFT = true;

async function callClaude(system, messages, model){
  if(window.SpeakingRoomNative){
    if(!window.srNativeRequest) throw new Error("구독 연결 기능을 준비 중입니다. 잠시 후 다시 시도해주세요.");
    const result=await window.srNativeRequest("infer", {instructions:String(system||""), messages});
    return {content:[{type:"text",text:result.text}]};
  }
  // 전역 출력 규칙: 마크다운/구분선 금지 (말풍선이 plain text라 별표가 그대로 보임)
  const NO_MD="\n\n[FORMAT] Plain conversational text only. Do NOT use markdown: no **, no *, no ##, no ---, no bullet lists, no backticks. Write naturally as if texting.";
  const sys = (typeof system==="string" && system.indexOf("ONLY")===-1 && system.indexOf("JSON")===-1)
    ? system+NO_MD : system;
  let payload=JSON.stringify({ model: model||MODEL, max_tokens:2000, system:sys, messages });
  let lastErr=null, triedFallback=false;
  // 최대 2회 시도 (사파리 첫 연결 실패 대비)
  for(let attempt=0; attempt<2; attempt++){
    // 타임아웃 (사파리 무한대기 방지)
    let ctrl=null, timer=null;
    try{ ctrl=new AbortController(); timer=setTimeout(()=>{try{ctrl.abort();}catch(e){}}, 30000); }catch(e){}
    try{
      const opt={ method:"POST", headers:{"Content-Type":"application/json"}, body:payload };
      if(ctrl) opt.signal=ctrl.signal;
      const res = await fetch(PROXY_URL, opt);
      if(timer) clearTimeout(timer);
      if(!res.ok){
        let emsg=""; try{ const eb=await res.json(); emsg=(eb&&eb.error&&eb.error.message)||""; }catch(e){}
        lastErr=new Error("서버 응답 "+res.status+(emsg?" · "+emsg.slice(0,140):""));
        if(res.status>=500||res.status===429){ continue; }
        // 모델 이름이 문제면(모델 교체·오타) 확실히 되는 빠른 모델로 한 번 더 시도한다.
        // 이게 없으면 AI 기능 전체가 조용히 죽고 로컬 단어만 계속 나온다.
        if(res.status>=400 && res.status<500 && /model/i.test(emsg) && !triedFallback){
          triedFallback=true;
          try{ const o=JSON.parse(payload); o.model=FAST_MODEL; payload=JSON.stringify(o); attempt=-1; continue; }catch(e){}
        }
        throw lastErr; }
      return await res.json();
    }catch(e){
      if(timer) clearTimeout(timer);
      if(e && e.name==="AbortError"){ lastErr=new Error("응답 시간 초과"); continue; }
      // 서버가 이유를 알려준 오류는 그대로 전달한다 ("연결 실패: 서버 응답 401 …"처럼 겹쳐 쓰지 않게)
      if(e && /^서버 응답 /.test(String(e.message||""))) throw e;
      lastErr=new Error(e&&e.message? ("연결 실패: "+e.message) : "네트워크 연결 실패");
      // 네트워크 오류면 한 번 더 시도
    }
  }
  throw lastErr || new Error("연결 실패");
}

function extractText(data){
  if(!data || !Array.isArray(data.content)) return "";
  return data.content.filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
}

function parseJSON(text){
  let t = text.replace(/```json/gi,"").replace(/```/g,"").trim();
  const s=t.indexOf("{"), e=t.lastIndexOf("}");
  if(s>=0 && e>=0) t=t.slice(s,e+1);
  return JSON.parse(t);
}

function stripUsedMarker(txt){
  // 응답에서 USED/TURN_EVAL 마커를 떼어내고 {clean, ids, turnEval} 반환
  let s=String(txt||"");
  const m=s.match(/[⟦\[【]\s*USED\s*:\s*([^⟧\]】]*)[⟧\]】]/i);
  let ids=null;
  if(m){ ids=m[1].split(",").map(x=>x.trim()).filter(Boolean); }
  let turnEval=null;
  const em=s.match(/⟦\s*TURN_EVAL\s*:\s*({[\s\S]*?})\s*⟧/i) || s.match(/^\s*TURN_EVAL\s*:\s*({[\s\S]*?})\s*$/im);
  if(em){
    try{ turnEval=parseJSON(em[1]); }catch(e){ turnEval=null; }
  }
  // 마커(및 변형) 제거 + 혹시 모를 잔여 메타 라인 제거
  const clean=s
    .replace(/⟦\s*TURN_EVAL\s*:[\s\S]*?⟧/gi,"")
    .replace(/[⟦\[【]\s*USED\s*:[^⟧\]】]*[⟧\]】]/gi,"")
    .replace(/^\s*TURN_EVAL\s*:.*$/gim,"")
    .replace(/^\s*USED\s*:.*$/gim,"")
    .replace(/\s+$/,"").trim();
  return { clean, ids, turnEval };
}

let micEpoch=0;

const SV_TTS_VOICE="en-US-JennyNeural";

let _svAudio=null;

const _svCache=new Map();

let _svGeneration=0;
function svStop(){ _svGeneration++;try{ if(_svAudio){ _svAudio.onended=null; _svAudio.pause(); _svAudio=null; } }catch(e){} }

let _svDead=false;

async function svSpeak(text, rate, onEnd, voice){
  svStop();const generation=_svGeneration;
  text=String(text||"").trim();
  if(!text || _svDead || /[\uac00-\ud7a3]/.test(text)) return false;
  const vc=voice||SV_TTS_VOICE;                       // 말레이어 등 다른 언어를 읽을 때만 바뀐다
  const r100=Math.max(0.4, Math.min(1.4, Number(rate)||1));
  const key=vc+"|"+r100.toFixed(2)+"|"+text;
  try{
    let url=_svCache.get(key);
    if(!url){
      const res=await fetch(PROXY_URL+"/tts?voice="+encodeURIComponent(vc)+"&rate="+r100.toFixed(2)+"&text="+encodeURIComponent(text));
      if(res.status===404){ _svDead=true; return false; }   // 워커에 /tts 없음 → 이번 세션은 폴백 고정
      if(!res.ok) return false;
      if((res.headers.get("Content-Type")||"").indexOf("audio")<0) return false;
      const blob=await res.blob(); if(!blob || blob.size<200) return false;
      url=URL.createObjectURL(blob); _svCache.set(key,url);
      if(_svCache.size>150){ const k0=_svCache.keys().next().value; try{ URL.revokeObjectURL(_svCache.get(k0)); }catch(e){} _svCache.delete(k0); }
    }
    if(generation!==_svGeneration)return true;
    try{ TTS&&TTS.cancel(); }catch(e){}
    const a=new Audio(url); _svAudio=a;
    if(onEnd) a.onended=()=>setTimeout(onEnd, 250);
    await a.play();   // 자동재생 차단 등 실패 시 catch → 폴백
    return true;
  }catch(e){ return false; }
}

const MIN_REC_MS=900;

const VAD_OPTS={maxMs:15000, silenceMs:600, minSpeechMs:200, thresh:0.012};

function attachVAD(stream, onStop, opts){
  opts=opts||{};
  const maxMs=opts.maxMs||8000, silenceMs=opts.silenceMs||1000, minSpeechMs=opts.minSpeechMs||250, thresh=opts.thresh||0.02;
  // expectWords: 말해야 할 단어 수. '다 말한 것 같으면' 짧은 무음(silenceMs)에 바로 끝내고,
  //   아직 덜 말한 것 같으면 긴 무음(maxSilenceMs)까지 기다린다.
  //   → 빨리 말한 사람은 기다리는 시간이 없고, 단어마다 쉬는 아이는 중간에 안 끊긴다.
  // noSpeechMs: 아예 말이 없으면 끝까지 기다리지 않고 일찍 종료
  const expectWords=opts.expectWords||0, maxSilenceMs=opts.maxSilenceMs||2600, noSpeechMs=opts.noSpeechMs||0;
  const onSpeechStart=typeof opts.onSpeechStart==="function"?opts.onSpeechStart:null;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    const ac=new AC(); const src=ac.createMediaStreamSource(stream);
    const an=ac.createAnalyser(); an.fftSize=512; src.connect(an);
    const buf=new Uint8Array(an.fftSize);
    const t0=Date.now(); let lastLoud=0, spoke=false, started=false, done=false;
    let voicedMs=0, bursts=0, inBurst=false, lastTick=Date.now();
    // 다 말했는지 추정: ① 단어 수만큼 끊어 말했거나 ② 한 번에 쭉 말했는데 총량이 충분하거나
    //                  ③ 몇 덩어리로 나눠 말했는데 총량이 넉넉하거나
    function looksDone(){
      if(expectWords<=0) return true;
      if(bursts>=expectWords) return true;              // 단어 수만큼 끊어 말했다 = 다 말함
      if(bursts<=1 && voicedMs>=expectWords*280) return true;   // 한 번에 쭉 말했다
      if(voicedMs>=expectWords*430) return true;                // 나눠 말했어도 총량이 충분
      return false;
    }
    // rAF는 탭이 뒤로 가거나 화면이 꺼지면 멈춘다 → 벽시계 백스톱으로 반드시 끝나게
    let guard=setTimeout(()=>{ guard=null; fin(); }, maxMs+2000);
    // 말이 끝났다고 판단한 순간 바로 끊으면 마지막 자음(-t, -k, -s)이 잘려 인식이 나빠진다.
    const tailMs = (opts.tailMs!=null) ? opts.tailMs : 250;
    function fin(){ if(done)return; done=true; if(guard){ clearTimeout(guard); guard=null; } try{ac.close();}catch(e){}
      if(tailMs>0) setTimeout(onStop, tailMs); else onStop(); }
    function tick(){
      if(done)return;
      an.getByteTimeDomainData(buf);
      let sum=0; for(let i=0;i<buf.length;i++){ const v=(buf[i]-128)/128; sum+=v*v; }
      const rms=Math.sqrt(sum/buf.length), now=Date.now();
      const dt=Math.min(120, now-lastTick); lastTick=now;
      if(rms>thresh){
        if(!inBurst){ inBurst=true; bursts++; }        // 말 덩어리 개수 (단어를 끊어 말한 횟수)
        lastLoud=now; voicedMs+=dt;                    // 쉬는 시간은 빼고 '말한 시간'만 누적
        if(!started && now-t0>minSpeechMs){ started=true; if(onSpeechStart) onSpeechStart(now); }
        if(now-t0>minSpeechMs) spoke=true;
      } else if(inBurst && (now-lastLoud)>180){
        inBurst=false;                                  // 단어 사이 끊김
      }
      if(spoke && lastLoud){
        const quiet=now-lastLoud;
        // 녹음이 너무 짧으면 STT 가 아무것도 못 돌려준다("안 들렸어요"의 흔한 원인).
        // 말이 끝난 것 같아도 최소 길이는 채우고 끊는다.
        if(now-t0 < MIN_REC_MS) { requestAnimationFrame(tick); return; }
        // 다 말한 것 같으면 곧바로 종료 → 빨리 말한 사람이 기다리지 않음
        if(quiet>silenceMs && looksDone()) return fin();
        // 덜 말한 것 같아도 오래 조용하면 종료 (중간에 멈춘 경우)
        if(quiet>maxSilenceMs) return fin();
      }
      if(!spoke && noSpeechMs && (now-t0)>noSpeechMs){ return fin(); }   // 말이 없으면 그만 기다림
      if(now-t0>maxMs){ return fin(); }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return ()=>{ if(!done){ done=true; if(guard){ clearTimeout(guard); guard=null; } try{ac.close();}catch(e){} } };
  }catch(e){
    const id=setTimeout(onStop, maxMs);
    return ()=>clearTimeout(id);
  }
}

const _vadReg=Object.create(null);

const _vadGen=Object.create(null);

function vadCancel(key){
  key=key||"mic";
  const c=_vadReg[key];
  if(c){ try{ c(); }catch(e){} delete _vadReg[key]; }
}

function vadArmAs(key, stream, onStop, opts){
  vadCancel(key);
  const gen=(_vadGen[key]=(_vadGen[key]||0)+1);
  _vadReg[key]=attachVAD(stream, ()=>{
    if(_vadGen[key]!==gen) return;   // 옛 녹음의 VAD가 뒤늦게 깨어난 것 → 무시
    onStop();
  }, opts);
  return gen;
}

function vadArm(stream, opts){
  return vadArmAs("mic", stream, ()=>{
    if(qzRecording && qzMR && qzMR.state!=="inactive") qzMR.stop();
  }, opts);
}

const MIC_CONSTRAINTS={audio:{
  echoCancellation:true, noiseSuppression:true, autoGainControl:true,
  channelCount:1, sampleRate:16000
}};

let _micStream=null;

let _micIdleTimer=null;

function micStreamRelease(){
  if(_micIdleTimer){ clearTimeout(_micIdleTimer); _micIdleTimer=null; }
  if(_micStream){ try{ _micStream.getTracks().forEach(t=>t.stop()); }catch(e){} _micStream=null; }
}

function micStreamIdle(){
  if(_micIdleTimer) clearTimeout(_micIdleTimer);
  _micIdleTimer=setTimeout(micStreamRelease, 90000);
}

async function micStreamGet(){
  // live 여도 muted 인 트랙은 소리가 하나도 안 담긴다(다른 앱이 장치를 가져간 뒤 등).
  // 이 경우까지 재사용하면 '말해도 안 들렸어요'가 반복된다 → 새로 연다.
  const usable = _micStream && _micStream.active &&
    _micStream.getAudioTracks().some(t=>t.readyState==="live" && !t.muted);
  if(usable){
    if(_micIdleTimer){ clearTimeout(_micIdleTimer); _micIdleTimer=null; }
    return _micStream;
  }
  micStreamRelease();
  _micStream=await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  return _micStream;
}

let _micCooldownUntil=0;

function micCooldownLeft(){ return Math.max(0, _micCooldownUntil-Date.now()); }

function micStartCooldown(){ _micCooldownUntil=Date.now()+400; }

let _micLive=null;

let _micLiveOff=false;

function micLiveStart(){
  if(_micLiveOff) return null;                 // 이 기기에선 못 쓴다고 판정된 상태
  let SR=null; try{ SR=window.SpeechRecognition||window.webkitSpeechRecognition; }catch(e){}
  if(!SR) return null;
  let rec=null; try{ rec=new SR(); }catch(e){ return null; }
  const st={text:"", alts:[], interim:"", done:false, err:"", rec, onInterim:null};
  try{
    rec.lang="en-US"; rec.interimResults=true; rec.continuous=false;
    try{ rec.maxAlternatives=5; }catch(e){}      // 억양이 세면 1등이 틀리고 2등이 맞는 일이 잦다
    rec.onresult=(e)=>{
      let interim="";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const r=e.results[i];
        if(r.isFinal){
          st.text=String((r[0]&&r[0].transcript)||"").trim();
          st.alts=[];
          for(let k=0;k<r.length;k++){ const t=String((r[k]&&r[k].transcript)||"").trim(); if(t&&st.alts.indexOf(t)<0) st.alts.push(t); }
        } else interim+=r[0].transcript;
      }
      st.interim=interim;
      if(typeof st.onInterim==="function"){ try{ st.onInterim(st.text||interim); }catch(e){} }
    };
    rec.onerror=(e)=>{ st.err=String((e&&e.error)||"error"); st.done=true;
      /* 마이크를 못 잡는 기기면 계속 켰다 껐다 하면서 녹음까지 방해한다 — 이번 세션은 끈다 */
      if(/not-allowed|service-not-allowed|audio-capture/.test(st.err)) _micLiveOff=true; };
    rec.onend=()=>{ st.done=true; };
    rec.start();
  }catch(e){ return null; }
  _micLive=st; return st;
}

function micLiveStop(st){ if(st&&st.rec){ try{ st.rec.stop(); }catch(e){} try{ st.rec.abort(); }catch(e){} } if(_micLive===st) _micLive=null; }

async function micLiveWait(st, ms){
  if(!st) return null;
  try{ st.rec.stop(); }catch(e){}
  const t0=Date.now();
  while(!st.done && !st.text && Date.now()-t0<(ms||900)) await new Promise(r=>setTimeout(r,30));
  const out = st.text ? {text:st.text, alts:st.alts.slice()} : null;
  micLiveStop(st);
  return out;
}

let qzMR=null;

let qzRecording=false;

let enVoice=null;

let koVoice=null;

function speakSmart(text){
  if(!TTS||!SSU||!text) return;
  TTS.cancel();
  const s=String(text); const segs=[]; let cur="", curKo=null;
  for(const ch of s){
    const ko=/[\uac00-\ud7a3]/.test(ch);
    const neutral=/[\s0-9.,!?~…·"'()\[\]%:;\-—’“”]/.test(ch);
    if(cur===""){ cur=ch; curKo=ko; }
    else if(neutral){ cur+=ch; }
    else if(ko===curKo){ cur+=ch; }
    else { segs.push([cur,curKo]); cur=ch; curKo=ko; }
  }
  if(cur) segs.push([cur,curKo]);
  let i=0;
  (function go(){
    if(i>=segs.length) return;
    const seg=segs[i][0], ko=segs[i][1]; i++;
    if(!seg.trim()){ go(); return; }
    const u=new SSU(seg);
    if(ko){ if(koVoice) u.voice=koVoice; u.lang="ko-KR"; u.rate=0.98; }
    else { if(enVoice) u.voice=enVoice; u.lang="en-US"; u.rate=(typeof levelRate==="function")?levelRate(false):0.97; }
    u.onend=()=>setTimeout(go,70);
    // 첫 세그먼트만 cancel 여파로 짤릴 수 있어 지연, 이후는 onend 체인이라 안전
    if(i===1) setTimeout(()=>TTS.speak(u), 130); else TTS.speak(u);
  })();
}

function speak(text){ speakSmart(text); }

function getBestMime(){
  const types=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4","audio/aac"];
  return types.find(t=>MediaRecorder.isTypeSupported(t)) || "";
}

function encodeWAV(samples, rate){
  const buf=new ArrayBuffer(44+samples.length*2), v=new DataView(buf);
  const ws=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
  ws(0,"RIFF"); v.setUint32(4,36+samples.length*2,true); ws(8,"WAVE");
  ws(12,"fmt "); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,rate,true); v.setUint32(28,rate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  ws(36,"data"); v.setUint32(40,samples.length*2,true);
  let o=44; for(let i=0;i<samples.length;i++){ let s=Math.max(-1,Math.min(1,samples[i])); v.setInt16(o,s<0?s*0x8000:s*0x7FFF,true); o+=2; }
  return buf;
}

function decodeAudioCompat(ac, arrayBuf){
  return new Promise((resolve,reject)=>{
    let done=false;
    try{
      const p=ac.decodeAudioData(arrayBuf.slice(0),
        (b)=>{ if(!done){done=true;resolve(b);} },
        (e)=>{ if(!done){done=true;reject(e||new Error("decode fail"));} });
      if(p && typeof p.then==="function"){
        p.then(b=>{ if(!done){done=true;resolve(b);} })
         .catch(e=>{ if(!done){done=true;reject(e);} });
      }
    }catch(e){ if(!done){done=true;reject(e);} }
  });
}

async function recordedToWav(blob){
  const arrayBuf=await blob.arrayBuffer();
  const AC=window.AudioContext||window.webkitAudioContext;
  const tmp=new AC();
  // 재생용으로 일시정지된 AudioContext 깨우기 (일부 안드로이드)
  if(tmp.state==="suspended"){ try{ await tmp.resume(); }catch(_){} }
  let decoded=null, lastErr=null;
  // 원본 + webm 재포장 두 가지 시도
  for(const ab of [arrayBuf, arrayBuf]){
    try{ decoded=await decodeAudioCompat(tmp, ab); break; }
    catch(e){ lastErr=e; }
  }
  if(!decoded){ tmp.close && tmp.close(); throw lastErr||new Error("decode fail"); }
  tmp.close && tmp.close();
  const rate=16000;
  const off=new OfflineAudioContext(1, Math.max(1,Math.ceil(decoded.duration*rate)), rate);
  const src=off.createBufferSource(); src.buffer=decoded; src.connect(off.destination); src.start(0);
  const rendered=await off.startRendering();
  const ch=rendered.getChannelData(0);
  /* 작게 녹음되면 Azure 가 그냥 '인식 결과 없음'을 준다.
     최대 진폭을 보고 살짝 키운다. 거의 무음(잡음)까지 키우면 오인식이 늘어나므로
     하한(0.02)과 배율 상한(6배)을 둔다. 이미 충분히 큰 소리는 건드리지 않는다. */
  let peak=0;
  for(let i=0;i<ch.length;i++){ const v=ch[i]<0?-ch[i]:ch[i]; if(v>peak) peak=v; }
  if(peak>0.02 && peak<0.5){
    const gain=Math.min(6, 0.7/peak);
    for(let i=0;i<ch.length;i++) ch[i]*=gain;
  }
  return new Blob([encodeWAV(ch, rate)], {type:"audio/wav"});
}

const STT_HALLUC=/^(thank you|thanks( for watching)?|thank you for watching|bye+|you|okay|ok|uh|um|hmm|please subscribe|subscribe)?[.!?…\s]*$/i;

let _sttSoftOff=0;

let _sttVia="";

const HAN_CHO=["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];

const HAN_JUNG=["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","weo","we","wi","yu","eu","ui","i"];

const HAN_JONG=["","k","k","ks","n","nt","n","t","l","lk","lm","lp","ls","lt","lp","l","m","p","ps","t","t","ng","t","t","k","t","p","t"];

function hanRoman(str){
  let out="";
  for(const ch of String(str||"")){
    const c=ch.charCodeAt(0);
    if(c>=0xAC00 && c<=0xD7A3){
      const n=c-0xAC00;
      out+=HAN_CHO[Math.floor(n/588)]+HAN_JUNG[Math.floor((n%588)/28)]+HAN_JONG[n%28];
      out+=" ";                       // 음절마다 띄어 두고 아래에서 다시 붙인다
    } else out+=ch;
  }
  return out.replace(/\s+/g," ").trim();
}

function phKey(str){
  let t=hanRoman(str).toLowerCase().replace(/[^a-z ]+/g," ").replace(/\s+/g," ").trim();
  const one=(w)=>{
    if(!w) return "";
    let x=w;
    // 철자만 있고 소리는 없는 것들
    x=x.replace(/^kn/,"n").replace(/^wr/,"r").replace(/^ps/,"s");
    x=x.replace(/ough/g,"o").replace(/ight/g,"it").replace(/ght/g,"t").replace(/gh/g,"");
    x=x.replace(/tion|sion/g,"san").replace(/ck/g,"k").replace(/qu/g,"kw");
    // 모음 — 한국 사람도 모음은 구별한다(캣/컷). 철자만 정리한다.
    x=x.replace(/eu/g,"")                                   // 한글이 자음 뒤에 넣는 '으'
       .replace(/ee|ea|ie|ey/g,"i").replace(/oo|ou|ew|ue|ui/g,"u")
       .replace(/oa|ow|oe/g,"o").replace(/ai|ay|ae/g,"a")
       .replace(/au|aw/g,"o").replace(/oi|oy/g,"oi").replace(/eo/g,"o");
    x=x.replace(/ce$/,"s").replace(/ge$/,"s");             // rice·page 의 끝소리
    x=x.replace(/e$/,"").replace(/y$/,"i");                 // 묵음 e, 끝 y
    // 자음 — 한국어에 없는 구분은 하나로 (f/v/b/p, th/t/d, s/z/j/sh/ch, r/l)
    x=x.replace(/ci(?=[aeou])|ti(?=[aeou])/g,"s")
       .replace(/sh|ch/g,"s").replace(/th/g,"t")
       .replace(/ph|f|v|b/g,"p").replace(/z|j/g,"s")
       .replace(/c(?=[eiy])/g,"s").replace(/c|q|k|g/g,"k")
       .replace(/x/g,"ks").replace(/d/g,"t").replace(/l/g,"r");
    x=x.replace(/(.)\1+/g,"$1");
    return x;
  };
  return t.split(" ").map(one).filter(Boolean).join("");
}

function phKeyLoose(str){
  /* 한글은 음절마다 띄어 두는데, 그대로 두면 '체크아웃'이 che|keu|aut 로 쪼개져
     음절을 넘나드는 규칙(eu 삭제 등)이 안 먹는다. 붙여서 한 덩어리로 본다. */
  let t=phKey(hanRoman(str).replace(/\s+/g,""));
  t=t.replace(/sy/g,"s");                 // 한글의 셔·션 = sy
  t=t.replace(/r(?=[^aeiou]|$)/g,"")     // 자음 앞 r 은 한국어가 안 적는다(understand·form)
     .replace(/[hw]/g,"")                // now/나우 처럼 반모음
     .replace(/[aeiou]/g,"a")
     .replace(/(.)\1+/g,"$1");
  while(/[ra]$/.test(t)) t=t.slice(0,-1);   // 끝소리 r 과 한국어가 덧붙인 모음
  return t;
}

function phWordEq(a,b){
  a=String(a||"").toLowerCase(); b=String(b||"").toLowerCase();
  if(a===b) return true;
  if(a.length<3 || b.length<3) return false;
  const x=phKey(a);
  if(x && x===phKey(b)) return true;
  /* 한국식으로 자음 사이에 모음을 넣어 말하면(table→테이블→taburu) 위 키로는 안 맞는다.
     모음을 뭉갠 키로 한 번 더 본다. 짧은 낱말은 우연히 겹쳐서 5글자 이상만. */
  if(a.length>=4 && b.length>=4){ const lx=phKeyLoose(a); return !!lx && lx===phKeyLoose(b); }
  return false;
}

function phCloseHan(roman, ref){
  const x=phKeyLoose(roman), y=phKeyLoose(ref);
  if(!x||!y) return false;
  const L=Math.max(x.length,y.length);
  const words=String(ref||"").trim().split(/\s+/).filter(Boolean).length;
  if(words<=1) return x===y && String(ref||"").replace(/[^a-z]/gi,"").length>=5;
  if(x===y) return L>=4;
  return L>=6 && phDist(x,y)/L <= 0.18;
}

function phDist(a,b){
  const m=a.length, n=b.length;
  if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,j)=>j), cur=new Array(n+1);
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    [prev,cur]=[cur,prev];
  }
  return prev[n];
}

async function sttRecognize(raw, actualMime){
  let body, ctype;
  try{ body=await recordedToWav(raw); ctype="audio/wav"; }
  catch(_){
    // 디코드 실패 기기 → 원본 컨테이너 그대로 전송
    body=raw;
    ctype = /webm/.test(actualMime) ? "audio/webm; codecs=opus"
          : /ogg/.test(actualMime)  ? "audio/ogg; codecs=opus"
          : /mp4|aac/.test(actualMime) ? "audio/mp4"
          : (actualMime||"audio/webm; codecs=opus");
  }
  const send=(path)=>fetch(PROXY_URL+path,{method:"POST",headers:{"Content-Type":ctype},body});
  _sttVia="Azure";
  if(STT_SOFT && Date.now()>_sttSoftOff){
    try{
      const r=await send("/stt2");
      if(r.ok){ _sttVia="관대"; return r; }
      // 501=키 없음, 404=구버전 워커 → 한동안 안 부른다. 그 외(429·5xx)는 다음번에 다시 시도.
      let eb=""; try{ eb=await r.text(); }catch(e){}
      if(r.status===404){ _sttSoftOff=Date.now()+30*60000; _sttVia="Azure(워커가 구버전)"; }
      else if(r.status===501){ _sttSoftOff=Date.now()+30*60000; _sttVia="Azure(OPENAI_API_KEY 없음)"; }
      // 잔액 0 도 429 로 온다. 이건 기다린다고 풀리는 게 아니라 충전해야 하는 것이라 따로 알린다.
      else if(/insufficient_quota|exceeded your current quota|billing/i.test(eb)){ _sttSoftOff=Date.now()+30*60000; _sttVia="Azure(OpenAI 크레딧 없음)"; }
      else if(r.status===401||r.status===403){ _sttSoftOff=Date.now()+30*60000; _sttVia="Azure(OpenAI 키 오류 "+r.status+")"; }
      /* 예전엔 아는 상태코드만 쉬어서, 그 외 실패는 답할 때마다 왕복을 두 번씩 했다.
         한 번 실패하면 5분은 바로 Azure 로 간다 — 체감 속도가 여기서 갈린다. */
      else { _sttSoftOff=Date.now()+5*60000; _sttVia="Azure(관대 인식 "+r.status+")"; }
    }catch(e){ _sttSoftOff=Date.now()+5*60000; _sttVia="Azure(관대 인식 연결실패)"; }
  } else if(STT_SOFT){ _sttVia="Azure(관대 인식 잠시 중단됨)"; }
  else { _sttVia="Azure(관대 인식 꺼짐)"; }
  return send("/stt");
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function hGet(k,def){ try{ const r=localStorage.getItem(k); return r?JSON.parse(r):def; }catch(e){ return def; } }

function hSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

function adNorm(s){
  return String(s||"").toLowerCase()
    .replace(/[’]/g,"'")
    .replace(/\bi'm\b/g,"im").replace(/\bi am\b/g,"im")
    .replace(/\bi'd\b/g,"id").replace(/\bi would\b/g,"id")
    .replace(/\bi'll\b/g,"ill").replace(/\bi will\b/g,"ill")
    .replace(/\bdon't\b/g,"dont").replace(/\bdo not\b/g,"dont")
    .replace(/\bdoesn't\b/g,"doesnt").replace(/\bdoes not\b/g,"doesnt")
    .replace(/\bcan't\b/g,"cant").replace(/\bcannot\b/g,"cant")
    .replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
}

function adWords(s){ return adNorm(s).split(" ").filter(Boolean); }

function adLooseWordEq(a,b){
  if(a===b) return true;
  if(a.length<3||b.length<3) return false;
  return adStem(a)===adStem(b);
}

function adStem(w){
  let s=w;
  // -ing: 자음 중복 복원(getting→get) 포함
  if(/ing$/.test(s) && s.length>5){ s=s.slice(0,-3); if(s.length>=3 && s[s.length-1]===s[s.length-2]) s=s.slice(0,-1); }
  else if(/ed$/.test(s) && s.length>4){ let t=s.slice(0,-2); if(t.length>=3 && t[t.length-1]===t[t.length-2]) t=t.slice(0,-1); s=t; }
  else if(/es$/.test(s) && s.length>4){ s=s.slice(0,-2); }
  else if(/s$/.test(s) && s.length>3 && !/ss$/.test(s)){ s=s.slice(0,-1); }
  return s;
}

const TRAVEL_FRAMES=[
  { id:"travel_can_i_get", frame:"Can I get ~?", tf:"can i get", ko:"~ 주세요 / 받을 수 있을까요?", purpose:"요청", tip:"<b>내가 받을 물건</b>을 달라고 할 때예요.<br>수건 하나 더 → <b>Can I get another towel?</b><br>상대가 해줄 행동은 → Can you ~?", parts:[["Can I get","~ 주실 수 있어요?"],["another towel?","수건 하나 더"]], pnote:"주어는 <b>I</b>. '제가 받을 수 있을까요'라서 받을 물건을 뒤에 붙여요.", re:"\\bcan (i|we) get\\b",
    items:[
      {ko:"호텔 방에 수건이 부족하다. 수건을 하나 더 달라고 해라.", en:"Can I get another towel?"},
      {ko:"식당 테이블에 물이 없다. 물 좀 달라고 해라.", en:"Can I get some water?"},
      {ko:"계산을 마쳤는데 영수증을 안 준다. 영수증을 달라고 해라.", en:"Can I get a receipt?"},
      {ko:"카페 카운터 앞이다. 아이스 커피를 달라고 해라.", en:"Can I get an iced coffee?"},
      {ko:"투어 데스크 앞이다. 두 명 표를 달라고 해라.", en:"Can I get two tickets?"},
      {ko:"음식이 너무 맵다. 밥을 더 달라고 해라.", en:"Can I get more rice?"},
      {ko:"가족이 따로 다닐 예정이다. 방 열쇠를 하나 더 달라고 해라.", en:"Can I get an extra key?"},
      {ko:"Grab을 부른다. 아이가 있으니 카시트를 달라고 해라.", en:"Can I get a child seat?"},
      {ko:"시장에서 물건을 샀는데 담을 게 없다. 봉투를 달라고 해라.", en:"Can I get a bag for this?"},
      {ko:"내일 새벽 비행기다. 6시 모닝콜을 받을 수 있는지 물어라.", en:"Can I get a wake-up call at six?"},
      {ko:"아이가 젓가락을 못 쓴다. 포크를 달라고 해라.", en:"Can I get a fork?"},
      {ko:"길을 자꾸 헤맨다. 프런트에서 지도를 달라고 해라.", en:"Can I get a map?"},
      {ko:"음료가 미지근하다. 얼음을 달라고 해라.", en:"Can I get some ice?"},
      {ko:"배 안이 춥다. 담요를 달라고 해라.", en:"Can I get a blanket?"},
      {ko:"같이 나눠 먹으려 한다. 접시를 하나 더 달라고 해라.", en:"Can I get one more plate?"},
      {ko:"아이가 국물을 먹는다. 숟가락을 달라고 해라.", en:"Can I get a spoon?"},
      {ko:"음식이 흘렀다. 냅킨을 달라고 해라.", en:"Can I get some napkins?"},
      {ko:"남은 음식을 싸 가고 싶다. 포장 용기를 달라고 해라.", en:"Can I get a to-go box?"},
      {ko:"시장에서 여러 개를 샀다. 할인을 받을 수 있는지 물어라.", en:"Can I get a discount?"},
      {ko:"밥을 다 먹었다. 계산서를 달라고 해라.", en:"Can I get the check?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"카페에서 큰 사이즈로 달라고 해라.", en:"Can I get a large size?"}
      ,
      {ko:"음료에 빨대를 달라고 해라.", en:"Can I get a straw?"},
      {ko:"메모할 종이 한 장을 달라고 해라.", en:"Can I get a piece of paper?"}
      ,
      {ko:"컵이 지저분하다. 깨끗한 컵을 달라고 해라.", en:"Can I get a clean cup?"},
      {ko:"음식이 싱겁다. 소금을 달라고 해라.", en:"Can I get some salt?"},
      {ko:"커피가 쓰다. 설탕을 달라고 해라.", en:"Can I get some sugar?"},
      {ko:"따뜻한 물을 달라고 해라.", en:"Can I get some hot water?"}
    ]},
  { id:"travel_can_you", frame:"Can you ~?", tf:"can you", ko:"~해 주실 수 있어요?", purpose:"행동 요청", tip:"<b>상대가 해줄 행동</b>을 부탁할 때예요.<br>천천히 말해 주세요 → <b>Can you speak more slowly?</b><br>물건을 달라고 하면 → Can I get ~?", parts:[["Can you","~ 해 주실 수 있어요?"],["speak more slowly?","조금 더 천천히 말해"]], pnote:"주어는 <b>you</b>. '당신이 해줄 수 있나요'라서 상대가 할 행동을 뒤에 붙여요.", re:"\\bcan you\\b",
    items:[
      {ko:"Grab에 탔다. 기사에게 공항으로 가달라고 해라.", en:"Can you take me to the airport?"},
      {ko:"화장실에 다녀와야 한다. 짐을 좀 봐달라고 부탁해라.", en:"Can you watch my bags for a minute?"},
      {ko:"밤늦게 이동해야 한다. 프런트에 택시를 불러달라고 해라.", en:"Can you call a taxi for me?"},
      {ko:"길을 물었는데 말로는 모르겠다. 지도에서 짚어달라고 해라.", en:"Can you show me on the map?"},
      {ko:"가족이 다 모였다. 지나가는 사람에게 사진 좀 찍어달라고 해라.", en:"Can you take a photo of us?"},
      {ko:"방이 너무 덥다. 에어컨을 고쳐달라고 해라.", en:"Can you fix the air conditioner?"},
      {ko:"짐이 무겁다. 방까지 올려달라고 부탁해라.", en:"Can you bring my bags to the room?"},
      {ko:"가게에 잠깐 들를 것이다. 기사에게 5분만 기다려달라고 해라.", en:"Can you wait here for five minutes?"},
      {ko:"기사에게 보여줄 주소가 필요하다. 적어달라고 해라.", en:"Can you write down the address?"},
      {ko:"아이가 먹을 음식이다. 덜 맵게 해달라고 부탁해라.", en:"Can you make it less spicy?"},
      {ko:"방이 아직 덥다. 에어컨을 세게 틀어달라고 해라.", en:"Can you turn up the air conditioner?"},
      {ko:"예약이 됐는지 모르겠다. 확인해달라고 해라.", en:"Can you check my booking?"},
      {ko:"입구가 멀다. 기사에게 입구 앞에 내려달라고 해라.", en:"Can you drop us at the entrance?"},
      {ko:"현지어로만 말한다. 영어로 말해달라고 해라.", en:"Can you speak in English?"},
      {ko:"입국 서류를 못 쓰겠다. 도와달라고 해라.", en:"Can you help me with this form?"},
      {ko:"선물용으로 샀다. 포장해 달라고 해라.", en:"Can you wrap this as a gift?"},
      {ko:"계산하는 동안 물건이 많다. 잠깐 들어달라고 해라.", en:"Can you hold this for me?"},
      {ko:"둘이 따로 계산하려 한다. 계산서를 나눠 달라고 해라.", en:"Can you split the bill?"},
      {ko:"식은 음식이 나왔다. 데워달라고 해라.", en:"Can you heat this up?"},
      {ko:"깨질 물건이다. 상자에 넣어달라고 해라.", en:"Can you put it in a box?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"손에 짐이 가득하다. 문을 열어 달라고 해라.", en:"Can you open the door?"},
      {ko:"바람이 들어온다. 창문을 닫아 달라고 해라.", en:"Can you close the window?"}
      ,
      {ko:"어둡다. 불을 켜 달라고 해라.", en:"Can you turn on the light?"},
      {ko:"잠깐만 기다려 달라고 해라.", en:"Can you wait a moment?"},
      {ko:"짐이 무겁다. 이것 좀 들어 달라고 해라.", en:"Can you carry this for me?"},
      {ko:"잠깐 나갔다 온다. 자리를 맡아 달라고 해라.", en:"Can you save my seat?"},
      {ko:"이름을 못 알아들었다. 철자를 불러 달라고 해라.", en:"Can you spell your name?"}
      ,
      {ko:"사진을 같이 찍었다. 나에게 보내 달라고 해라.", en:"Can you send me the photo?"}
    ]},
  { id:"travel_can_i_we", frame:"Can I / Can we ~?", tf:"can i / can we", ko:"~해도 될까요?", purpose:"허락", re:"\\bcan (i|we)\\b(?!\\s+(get|pay|leave|change)\\b)",
    items:[
      {ko:"식당에 자리가 여러 개다. 창가에 앉아도 되는지 물어라.", en:"Can we sit by the window?"},
      {ko:"박물관에 들어왔다. 사진을 찍어도 되는지 물어라.", en:"Can I take pictures here?"},
      {ko:"비행기가 저녁이다. 늦게 체크아웃해도 되는지 물어라.", en:"Can we check out late?"},
      {ko:"카페에서 음료만 샀다. 화장실을 써도 되는지 물어라.", en:"Can I use the restroom?"},
      {ko:"옷 가게에서 사이즈가 걱정된다. 입어봐도 되는지 물어라.", en:"Can I try this on?"},
      {ko:"체크아웃은 했지만 비행기가 늦다. 수영장을 써도 되는지 물어라.", en:"Can we use the pool after checkout?"},
      {ko:"투어를 예약하려는데 아이가 있다. 데려가도 되는지 물어라.", en:"Can we bring our kids?"},
      {ko:"실내가 너무 덥다. 밖에 앉아도 되는지 물어라.", en:"Can we sit outside?"},
      {ko:"배터리가 거의 없다. 여기서 충전해도 되는지 물어라.", en:"Can I charge my phone here?"},
      {ko:"오늘 투어는 마감이라고 한다. 다음 것에 껴도 되는지 물어라.", en:"Can we join the next tour?"},
      {ko:"유모차를 끌고 있다. 안에 들어가도 되는지 물어라.", en:"Can we come in with a stroller?"},
      {ko:"밖에서 산 음식이 있다. 안에 들고 들어가도 되는지 물어라.", en:"Can I bring food inside?"},
      {ko:"마감이라고 한다. 조금 더 있어도 되는지 물어라.", en:"Can we stay a bit longer?"},
      {ko:"차 세울 데를 찾았다. 여기 세워도 되는지 물어라.", en:"Can I park here?"},
      {ko:"바다에 사람이 없다. 여기서 수영해도 되는지 물어라.", en:"Can we swim here?"},
      {ko:"시식대가 있다. 맛봐도 되는지 물어라.", en:"Can I taste this?"},
      {ko:"메뉴를 다 골랐다. 지금 주문해도 되는지 물어라.", en:"Can we order now?"},
      {ko:"가게가 곧 닫는다. 내일 다시 와도 되는지 물어라.", en:"Can I come back tomorrow?"},
      {ko:"양이 많아 보인다. 하나를 나눠 먹어도 되는지 물어라.", en:"Can we share one dish?"},
      {ko:"산 옷이 안 맞는다. 반품해도 되는지 물어라.", en:"Can I return this?"},
      {ko:"식당 마감 시간이 조금 지났다. 그래도 아직 주문해도 되는지 물어라.", en:"Can I still order?"},
      {ko:"체크인 시간이 많이 지났다. 그래도 지금 체크인해도 되는지 물어라.", en:"Can I still check in?"},
      {ko:"투어 출발 시간이 거의 다 됐다. 그래도 아직 껴도 되는지 물어라.", en:"Can we still join the tour?"},
      {ko:"체크아웃 시간이 지났다. 그래도 방을 조금 더 써도 되는지 물어라.", en:"Can we still use the room?"},
      {ko:"배표 판매 마감이 가깝다. 그래도 오늘 표를 사도 되는지 물어라.", en:"Can I still buy a ticket for today?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"빈 의자가 있다. 여기 앉아도 되는지 물어라.", en:"Can I sit here?"},
      {ko:"방이 답답하다. 창문을 열어도 되는지 물어라.", en:"Can I open the window?"},
      {ko:"일이 길어진다. 잠깐 쉬어도 되는지 물어라.", en:"Can we take a break?"}
      ,
      {ko:"음식을 사 왔다. 여기서 먹어도 되는지 물어라.", en:"Can we eat here?"}
      ,
      {ko:"상대가 물건을 들고 있다. 한번 봐도 되는지 물어라.", en:"Can I see it?"},
      {ko:"상대가 어디 간다고 한다. 같이 가도 되는지 물어라.", en:"Can I come with you?"},
      {ko:"다 모였다. 지금 시작해도 되는지 물어라.", en:"Can we start now?"},
      {ko:"약속 장소에 먼저 왔다. 여기서 기다려도 되는지 물어라.", en:"Can we wait here?"}
    ]},
  { id:"travel_do_you_have", frame:"Do you have ~?", tf:"do you have", ko:"(당신에게) ~ 있어요?", purpose:"보유 여부", tip:"<b>상대가 가지고 있는지</b>예요.<br>더 작은 사이즈 있어요 → <b>Do you have a smaller size?</b><br>근처에 있는지는 → Is there ~?", parts:[["Do you have","~ 있어요?"],["a smaller size?","더 작은 사이즈"]], pnote:"주어는 <b>you</b>. '당신이 가지고 있나요?'라는 뜻이에요.", re:"\\bdo you have\\b",
    items:[
      {ko:"아이가 매운 걸 못 먹는다. 안 매운 메뉴가 있는지 물어라.", en:"Do you have anything not spicy?"},
      {ko:"예약 없이 호텔에 들어왔다. 빈방이 있는지 물어라.", en:"Do you have a room available?"},
      {ko:"입어보니 옷이 작다. 더 큰 사이즈가 있는지 물어라.", en:"Do you have a bigger size?"},
      {ko:"우유를 못 먹는다. 카페에 두유가 있는지 물어라.", en:"Do you have soy milk?"},
      {ko:"내일 호핑투어를 하고 싶다. 자리가 있는지 물어라.", en:"Do you have space for tomorrow?"},
      {ko:"콘센트 모양이 다르다. 프런트에 어댑터가 있는지 물어라.", en:"Do you have an adapter?"},
      {ko:"메뉴를 못 읽겠다. 영어 메뉴가 있는지 물어라.", en:"Do you have an English menu?"},
      {ko:"아이가 어리다. 유아용 의자가 있는지 물어라.", en:"Do you have a high chair?"},
      {ko:"섬에 가는데 선크림을 안 챙겼다. 선크림이 있는지 물어라.", en:"Do you have sunscreen?"},
      {ko:"공항까지 이동해야 한다. 호텔 셔틀이 있는지 물어라.", en:"Do you have a shuttle to the airport?"},
      {ko:"아기가 있다. 아기 침대가 있는지 물어라.", en:"Do you have a crib?"},
      {ko:"투어 가는 동안 배낭을 두고 싶다. 보관함이 있는지 물어라.", en:"Do you have a locker?"},
      {ko:"식당에 네 명이 왔다. 네 명 자리가 있는지 물어라.", en:"Do you have a table for four?"},
      {ko:"배를 탄다. 아이용 구명조끼가 있는지 물어라.", en:"Do you have life jackets for kids?"},
      {ko:"방값이 생각보다 비싸다. 더 싼 방이 있는지 물어라.", en:"Do you have a cheaper room?"},
      {ko:"색이 마음에 안 든다. 파란색이 있는지 물어라.", en:"Do you have this in blue?"},
      {ko:"옷이 크다. 작은 사이즈가 있는지 물어라.", en:"Do you have a smaller size?"},
      {ko:"고기를 안 먹는 사람이 있다. 채식 메뉴가 있는지 물어라.", en:"Do you have a vegetarian dish?"},
      {ko:"아이가 먹을 게 없다. 아이 메뉴가 있는지 물어라.", en:"Do you have a kids menu?"},
      {ko:"진열장에 하나뿐이다. 재고가 있는지 물어라.", en:"Do you have this in stock?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"목이 마르다. 물이 있는지 물어라.", en:"Do you have water?"}
      ,
      {ko:"적을 게 있다. 펜이 있는지 물어라.", en:"Do you have a pen?"},
      {ko:"물건이 많다. 봉투가 있는지 물어라.", en:"Do you have a bag?"},
      {ko:"이 색은 마음에 안 든다. 다른 색이 있는지 물어라.", en:"Do you have another color?"},
      {ko:"예산이 빠듯하다. 더 싼 게 있는지 물어라.", en:"Do you have anything cheaper?"},
      {ko:"혼자 왔다. 한 자리가 있는지 물어라.", en:"Do you have a seat for one?"},
      {ko:"비가 온다. 우산이 있는지 물어라.", en:"Do you have an umbrella?"},
      {ko:"폰 배터리가 없다. 충전기가 있는지 물어라.", en:"Do you have a charger?"},
      {ko:"큰 돈밖에 없다. 잔돈이 있는지 물어라.", en:"Do you have change for this?"}
    ]},
  { id:"travel_where_is", frame:"Where is ~?", tf:"where is", ko:"~ 어디예요?", purpose:"장소 찾기", re:"\\bwhere (is|are)\\b",
    items:[
      {ko:"비행기에서 내렸다. 짐 찾는 곳이 어디인지 물어라.", en:"Where is baggage claim?"},
      {ko:"급하다. 화장실이 어디인지 물어라.", en:"Where is the restroom?"},
      {ko:"아침 시간이다. 조식 먹는 곳이 어디인지 물어라.", en:"Where is the breakfast room?"},
      {ko:"Grab을 불렀다. 픽업 장소가 어디인지 물어라.", en:"Where is the pickup area?"},
      {ko:"현금이 필요하다. 환전소가 어디인지 물어라.", en:"Where is the money exchange?"},
      {ko:"버스 정류장이 근처라는데 안 보인다. 정류장이 어디인지 물어라.", en:"Where is the bus stop?"},
      {ko:"탑승 시간이 다 됐다. 우리 게이트가 어디인지 물어라.", en:"Where is our gate?"},
      {ko:"아이가 열이 난다. 약국이 어디인지 물어라.", en:"Where is the pharmacy?"},
      {ko:"짐을 다 찾았다. 택시 승강장이 어디인지 물어라.", en:"Where is the taxi stand?"},
      {ko:"짐을 잠깐 넣어두고 싶다. 물품보관함이 어디인지 물어라.", en:"Where are the lockers?"},
      {ko:"짐이 무거워 계단은 힘들다. 엘리베이터가 어디인지 물어라.", en:"Where is the elevator?"},
      {ko:"현금이 떨어졌다. ATM이 어디인지 물어라.", en:"Where is the ATM?"},
      {ko:"건물을 한 바퀴 돌았다. 입구가 어디인지 물어라.", en:"Where is the entrance?"},
      {ko:"밤에 물을 사야 한다. 편의점이 어디인지 물어라.", en:"Where is the convenience store?"},
      {ko:"호텔 셔틀을 탄다. 셔틀 정류장이 어디인지 물어라.", en:"Where is the shuttle stop?"},
      {ko:"옷을 입어보려 한다. 탈의실이 어디인지 물어라.", en:"Where is the fitting room?"},
      {ko:"계산하려는데 카운터가 안 보인다. 계산대가 어디인지 물어라.", en:"Where is the cashier?"},
      {ko:"몰에서 밥을 먹으려 한다. 푸드코트가 어디인지 물어라.", en:"Where is the food court?"},
      {ko:"물과 과일을 사야 한다. 마트가 어디인지 물어라.", en:"Where is the supermarket?"},
      {ko:"공항에서 시간이 남는다. 면세점이 어디인지 물어라.", en:"Where is the duty free shop?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"표에 자리 번호가 있다. 내 자리가 어디인지 물어라.", en:"Where is my seat?"},
      {ko:"엘리베이터가 고장났다. 계단이 어디인지 물어라.", en:"Where are the stairs?"},
      {ko:"차를 세워야 한다. 주차장이 어디인지 물어라.", en:"Where is the parking lot?"},
      {ko:"건물에서 나가야 한다. 출구가 어디인지 물어라.", en:"Where is the exit?"},
      {ko:"뭘 물어볼 데가 필요하다. 안내 데스크가 어디인지 물어라.", en:"Where is the information desk?"},
      {ko:"버릴 게 있다. 쓰레기통이 어디인지 물어라.", en:"Where is the trash can?"},
      {ko:"물을 마시고 싶다. 정수기가 어디인지 물어라.", en:"Where is the water fountain?"},
      {ko:"지하철을 타야 한다. 가장 가까운 역이 어디인지 물어라.", en:"Where is the nearest station?"},
      {ko:"가방을 어디 뒀는지 모르겠다. 어디 있는지 물어라.", en:"Where is my bag?"}
    ]},
  { id:"travel_how_do_i_get_to", frame:"How do I get to ~?", tf:"how do i get to", ko:"~ 어떻게 가요?", purpose:"가는 방법", tip:"<b>장소 가는 길</b>만 이걸 써요.<br>호텔 어떻게 가요 → <b>How do I get to the hotel?</b><br>그 밖의 방법(쓰는 법·내는 법)은 → How do I ~?", parts:[["How do I get to","어떻게 가요"],["the hotel?","호텔에"]], pnote:"뒤에는 <b>장소</b>만 붙어요. 사용법을 물으면 get to 를 빼고 How do I 로 시작해요.", re:"\\bhow (do|can) (i|we) get to\\b",
    items:[
      {ko:"공항에 내렸다. 호텔까지 어떻게 가는지 물어라.", en:"How do I get to the hotel?"},
      {ko:"호텔 프런트다. 시내까지 가는 방법을 물어라.", en:"How do I get to downtown?"},
      {ko:"섬 가는 배를 타야 한다. 선착장까지 가는 방법을 물어라.", en:"How do I get to the ferry terminal?"},
      {ko:"저녁에 야시장에 가고 싶다. 가는 방법을 물어라.", en:"How do I get to the night market?"},
      {ko:"내일 아침 비행기다. 공항까지 가는 방법을 물어라.", en:"How do I get to the airport?"},
      {ko:"바다를 보러 가고 싶다. 해변까지 가는 방법을 물어라.", en:"How do I get to the beach?"},
      {ko:"추천받은 식당이 있다. 거기까지 가는 방법을 물어라.", en:"How do I get to that restaurant?"},
      {ko:"비가 온다. 실내 쇼핑몰까지 가는 방법을 물어라.", en:"How do I get to the mall?"},
      {ko:"아이가 아프다. 병원까지 가는 방법을 물어라.", en:"How do I get to the hospital?"},
      {ko:"노을을 보러 가려 한다. 전망 좋은 곳까지 가는 방법을 물어라.", en:"How do I get to the sunset point?"},
      {ko:"섬에 가고 싶다. 섬까지 어떻게 가는지 물어라.", en:"How do I get to the island?"},
      {ko:"공원에 가려 한다. 거기까지 어떻게 가는지 물어라.", en:"How do I get to the park?"}
      ,
      {ko:"시외버스를 타야 한다. 터미널까지 어떻게 가는지 물어라.", en:"How do I get to the bus terminal?"},
      {ko:"구시가지를 걷고 싶다. 거기까지 어떻게 가는지 물어라.", en:"How do I get to the old town?"},
      {ko:"해산물 시장에 가고 싶다. 거기까지 어떻게 가는지 물어라.", en:"How do I get to the seafood market?"},
      {ko:"쇼핑 거리에 가려 한다. 거기까지 어떻게 가는지 물어라.", en:"How do I get to the shopping street?"}
      ,
      {ko:"바닷가 산책로에 가고 싶다. 거기까지 어떻게 가는지 물어라.", en:"How do I get to the waterfront?"},
      {ko:"아이들이 동물원에 가고 싶어 한다. 거기까지 어떻게 가는지 물어라.", en:"How do I get to the zoo?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"지하철을 타야 한다. 역까지 가는 방법을 물어라.", en:"How do I get to the station?"}
      
      ,
      {ko:"돈을 찾아야 한다. 은행 가는 방법을 물어라.", en:"How do I get to the bank?"},
      {ko:"소포를 부쳐야 한다. 우체국 가는 방법을 물어라.", en:"How do I get to the post office?"}
      
      ,
      {ko:"약속이 카페다. 카페 가는 방법을 물어라.", en:"How do I get to the cafe?"}
      ,
      {ko:"차를 세워야 한다. 주차장 가는 방법을 물어라.", en:"How do I get to the parking lot?"}
    ]},
  { id:"travel_how_long", frame:"How long does it take?", tf:"how long does it take", ko:"(시작 전) 전체 얼마나 걸려요?", purpose:"소요 시간", tip:"<b>전체로 걸리는 시간</b>이에요.<br>타기 전 · 시키기 전 · 맡기기 전 → <b>How long does it take?</b><br>이미 기다리는 중이면 → How much longer?", parts:[["How long","얼마나"],["does it take?","걸려요?"]], pnote:"주어는 <b>it</b>. 앞은 <b>얼마나</b>라는 말이에요.<br>더 붙이고 싶으면 뒤에: to get to the hotel? · by bus?", re:"\\bhow long does it take\\b",
    items:[
      {ko:"택시를 탔다. 호텔까지 얼마나 걸리는지 물어라.", en:"How long does it take to get to the hotel?"},
      {ko:"배를 타기 전이다. 섬까지 얼마나 걸리는지 물어라.", en:"How long does it take to get to the island?"},
      {ko:"직원이 조금만 기다리라고 한다. 얼마나 걸리는지 물어라.", en:"How long does it take?"},
      {ko:"택시를 안 타고 걸어가려 한다. 얼마나 걸리는지 물어라.", en:"How long does it take on foot?"},
      {ko:"투어를 예약하려 한다. 전체가 얼마나 걸리는지 물어라.", en:"How long does it take in total?"},
      {ko:"체크인 줄이 길다. 얼마나 걸리는지 물어라.", en:"How long does it take to check in?"},
      {ko:"옷이 다 젖었다. 세탁이 얼마나 걸리는지 물어라.", en:"How long does it take for laundry?"},
      {ko:"걸을지 택시를 탈지 고민이다. 택시로 얼마나 걸리는지 물어라.", en:"How long does it take by taxi?"},
      {ko:"가이드가 다음 장소를 말했다. 거기까지 얼마나 걸리는지 물어라.", en:"How long does it take to get there?"},
      {ko:"에어컨을 고쳐준다고 한다. 얼마나 걸리는지 물어라.", en:"How long does it take to fix it?"},
      {ko:"버스로 갈지 고민이다. 버스로 얼마나 걸리는지 물어라.", en:"How long does it take by bus?"},
      {ko:"짐이 아직 안 나왔다. 얼마나 걸리는지 물어라.", en:"How long does it take to get my bags?"},
      {ko:"왕복인지 편도인지 헷갈린다. 편도로 얼마나 걸리는지 물어라.", en:"How long does it take one way?"},
      {ko:"공항에 가야 한다. 공항까지 얼마나 걸리는지 물어라.", en:"How long does it take to get to the airport?"},
      {ko:"방 청소를 부탁했다. 얼마나 걸리는지 물어라.", en:"How long does it take to clean the room?"},
      {ko:"주문한 요리가 오래 걸린다고 한다. 얼마나 걸리는지 물어라.", en:"How long does it take to cook?"},
      {ko:"식당 앞에 줄이 있다. 자리가 나기까지 얼마나 걸리는지 물어라.", en:"How long does it take to get a table?"},
      {ko:"선물 포장을 부탁했다. 얼마나 걸리는지 물어라.", en:"How long does it take to wrap it?"},
      {ko:"반품을 했다. 환불까지 얼마나 걸리는지 물어라.", en:"How long does it take to get a refund?"},
      {ko:"짐을 부치고 나왔다. 보안검색이 얼마나 걸리는지 물어라.", en:"How long does it take to get through security?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      
      {ko:"걸어서 역까지 가려 한다. 얼마나 걸리는지 물어라.", en:"How long does it take to walk to the station?"}
      ,
      {ko:"빨래를 널었다. 마르는 데 얼마나 걸리는지 물어라.", en:"How long does it take to dry?"},
      {ko:"배터리가 없다. 충전이 얼마나 걸리는지 물어라.", en:"How long does it take to charge?"}
      ,
      {ko:"곧 나가야 한다. 준비하는 데 얼마나 걸리는지 물어라.", en:"How long does it take to get ready?"},
      {ko:"기차로 갈까 고민이다. 기차로 얼마나 걸리는지 물어라.", en:"How long does it take by train?"},
      {ko:"차로 갈까 고민이다. 차로 얼마나 걸리는지 물어라.", en:"How long does it take by car?"}
    ]},
  { id:"travel_what_time_does", frame:"What time does ~ start/leave?", tf:"what time does", ko:"~ 몇 시에 시작해요/출발해요?", purpose:"시작·출발 시간", re:"\\bwhat time does\\b",
    items:[
      {ko:"내일 투어를 예약했다. 몇 시에 시작하는지 물어라.", en:"What time does the tour start?"},
      {ko:"섬에 가려 한다. 배가 몇 시에 출발하는지 물어라.", en:"What time does the boat leave?"},
      {ko:"내일 아침 일정이 있다. 조식이 몇 시에 시작하는지 물어라.", en:"What time does breakfast start?"},
      {ko:"가게 앞인데 아직 닫혀 있다. 몇 시에 여는지 물어라.", en:"What time does the shop open?"},
      {ko:"늦게까지 놀 예정이다. 막차가 몇 시인지 물어라.", en:"What time does the last bus leave?"},
      {ko:"저녁에 수영하려 한다. 수영장이 몇 시에 닫는지 물어라.", en:"What time does the pool close?"},
      {ko:"공연을 보러 왔다. 몇 시에 시작하는지 물어라.", en:"What time does the show start?"},
      {ko:"야시장에 가려 한다. 몇 시에 닫는지 물어라.", en:"What time does the market close?"},
      {ko:"배를 놓쳤다. 다음 배가 몇 시에 뜨는지 물어라.", en:"What time does the next boat leave?"},
      {ko:"예정보다 일찍 도착했다. 체크인이 몇 시부터인지 물어라.", en:"What time does check-in start?"},
      {ko:"저녁을 먹으러 왔는데 아직 안 연 것 같다. 몇 시에 여는지 물어라.", en:"What time does the restaurant open?"},
      {ko:"박물관에 늦게 왔다. 몇 시에 닫는지 물어라.", en:"What time does the museum close?"}
      ,
      {ko:"공항 셔틀을 탄다. 몇 시에 출발하는지 물어라.", en:"What time does the shuttle leave?"},
      {ko:"저녁 약속이 있다. 투어가 몇 시에 끝나는지 물어라.", en:"What time does the tour end?"},
      {ko:"아침에 쇼핑을 하려 한다. 몰이 몇 시에 여는지 물어라.", en:"What time does the mall open?"},
      {ko:"늦게 저녁을 먹으려 한다. 주방이 몇 시에 닫는지 물어라.", en:"What time does the kitchen close?"},
      {ko:"세일한다는 안내를 봤다. 몇 시에 시작하는지 물어라.", en:"What time does the sale start?"},
      {ko:"뷔페를 먹으려 한다. 몇 시에 여는지 물어라.", en:"What time does the buffet open?"},
      {ko:"오늘 늦게 갈 예정이다. 가게가 몇 시에 닫는지 물어라.", en:"What time does the store close today?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"돈을 찾아야 한다. 은행이 몇 시에 여는지 물어라.", en:"What time does the bank open?"}
      ,
      {ko:"영화를 보러 왔다. 몇 시에 시작하는지 물어라.", en:"What time does the movie start?"}
      ,
      {ko:"기차를 타야 한다. 몇 시에 출발하는지 물어라.", en:"What time does the train leave?"},
      {ko:"늦었다. 막차가 몇 시에 떠나는지 물어라.", en:"What time does the last train leave?"}
      ,
      {ko:"산책을 가려 한다. 공원이 몇 시에 닫는지 물어라.", en:"What time does the park close?"}
      
    ]},
  { id:"travel_what_time_need", frame:"What time do we need to ~?", tf:"what time do we need to", ko:"몇 시까지 ~해야 해요?", purpose:"마감 시각", re:"\\bwhat time do (we|i) need to\\b",
    items:[
      {ko:"투어 픽업이 있다. 몇 시까지 로비에 있어야 하는지 물어라.", en:"What time do we need to be in the lobby?"},
      {ko:"내일 떠난다. 몇 시까지 체크아웃해야 하는지 물어라.", en:"What time do we need to check out?"},
      {ko:"비행기 시간이 걱정된다. 몇 시까지 공항에 가야 하는지 물어라.", en:"What time do we need to be at the airport?"},
      {ko:"배를 타러 간다. 몇 시까지 배에 타야 하는지 물어라.", en:"What time do we need to get on the boat?"},
      {ko:"투어 중간에 쉬는 시간이 있다. 몇 시까지 돌아와야 하는지 물어라.", en:"What time do we need to come back?"},
      {ko:"아침에 픽업이 온다. 몇 시까지 준비해야 하는지 물어라.", en:"What time do we need to be ready?"},
      {ko:"늦게 체크아웃하려 한다. 몇 시까지 방을 비워야 하는지 물어라.", en:"What time do we need to leave the room?"},
      {ko:"공연을 예약했다. 몇 시까지 도착해야 하는지 물어라.", en:"What time do we need to arrive?"},
      {ko:"차를 빌렸다. 몇 시까지 반납해야 하는지 물어라.", en:"What time do we need to return the car?"},
      {ko:"배 시간이 다 됐다. 몇 시까지 선착장에 가야 하는지 물어라.", en:"What time do we need to be at the pier?"},
      {ko:"주방 마감이 있다고 한다. 몇 시까지 주문해야 하는지 물어라.", en:"What time do we need to order?"},
      {ko:"투어 집합이 있다. 몇 시까지 집합 장소에 가야 하는지 물어라.", en:"What time do we need to be at the meeting point?"},
      {ko:"공항까지 시간이 걸린다. 몇 시까지 호텔에서 나가야 하는지 물어라.", en:"What time do we need to leave the hotel?"}
      ,
      {ko:"섬에서 자유시간을 준다. 몇 시까지 배로 돌아와야 하는지 물어라.", en:"What time do we need to be back on the boat?"},
      {ko:"식당 예약 시간이 있다. 몇 시까지 앉아야 하는지 물어라.", en:"What time do we need to be seated?"},
      {ko:"수선을 맡겼다. 몇 시까지 찾아가야 하는지 물어라.", en:"What time do we need to pick it up?"},
      {ko:"공항에 간다. 몇 시까지 체크인해야 하는지 물어라.", en:"What time do we need to check in for the flight?"},
      {ko:"가이드가 자유시간을 준다. 몇 시까지 쇼핑을 끝내야 하는지 물어라.", en:"What time do we need to finish shopping?"},
      {ko:"수건을 빌렸다. 몇 시까지 반납해야 하는지 물어라.", en:"What time do we need to return the towels?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"약속이 있다. 몇 시에 나가야 하는지 물어라.", en:"What time do we need to leave?"},
      {ko:"장소를 정했다. 몇 시까지 가 있어야 하는지 물어라.", en:"What time do we need to be there?"},
      {ko:"같이 가기로 했다. 몇 시에 만나야 하는지 물어라.", en:"What time do we need to meet?"}
      
      ,
      {ko:"아침 일정이 있다. 몇 시에 일어나야 하는지 물어라.", en:"What time do we need to get up?"},
      {ko:"일을 시작해야 한다. 몇 시에 시작해야 하는지 물어라.", en:"What time do we need to start?"},
      {ko:"마감이 있다. 몇 시까지 끝내야 하는지 물어라.", en:"What time do we need to finish?"}
      
    ]},
  { id:"travel_do_i_need_to", frame:"Do I need to ~?", tf:"do i need to", ko:"~해야 하나요?", purpose:"필요 여부", re:"^(?!.*what time).*\\bdo (i|we) need to\\b",
    items:[
      {ko:"인기 있는 투어라고 한다. 미리 예약해야 하는지 물어라.", en:"Do I need to book in advance?"},
      {ko:"투어를 신청했다. 지금 돈을 내야 하는지 물어라.", en:"Do I need to pay now?"},
      {ko:"내일 투어에 뭘 챙길지 모르겠다. 여권이 필요한지 물어라.", en:"Do I need to bring my passport?"},
      {ko:"호핑투어에 간다. 수영복을 챙겨야 하는지 물어라.", en:"Do I need to bring a swimsuit?"},
      {ko:"가게 입구에 신발이 여러 켤레 있다. 벗어야 하는지 물어라.", en:"Do I need to take off my shoes?"},
      {ko:"사람들이 서 있다. 줄을 서야 하는지 물어라.", en:"Do I need to wait in line?"},
      {ko:"표를 폰으로 받았다. 미리 출력해야 하는지 물어라.", en:"Do I need to print the ticket?"},
      {ko:"버스를 타려 한다. 자리를 미리 예약해야 하는지 물어라.", en:"Do I need to reserve a seat?"},
      {ko:"섬에 간다. 수건을 챙겨야 하는지 물어라.", en:"Do we need to bring towels?"},
      {ko:"입구를 이미 지났다. 표를 또 보여줘야 하는지 물어라.", en:"Do I need to show my ticket again?"},
      {ko:"한 번에 가는지 모르겠다. 버스를 갈아타야 하는지 물어라.", en:"Do I need to change buses?"},
      {ko:"카드만 들고 나왔다. 현금이 필요한지 물어라.", en:"Do I need to bring cash?"},
      {ko:"배에 탄다. 구명조끼를 입어야 하는지 물어라.", en:"Do I need to wear a life jacket?"},
      {ko:"짐만 맡기고 나가려 한다. 먼저 체크아웃해야 하는지 물어라.", en:"Do I need to check out first?"},
      {ko:"계산을 마쳤다. 팁을 줘야 하는지 물어라.", en:"Do we need to tip?"},
      {ko:"인기 있는 식당이다. 자리를 예약해야 하는지 물어라.", en:"Do I need to book a table?"},
      {ko:"환불을 할 수도 있다. 영수증을 갖고 있어야 하는지 물어라.", en:"Do I need to keep the receipt?"},
      {ko:"물건을 맡겨 두려 한다. 보증금을 내야 하는지 물어라.", en:"Do I need to pay a deposit?"},
      {ko:"직원이 오지 않는다. 카운터에서 주문해야 하는지 물어라.", en:"Do we need to order at the counter?"},
      {ko:"과일을 봉지에 담았다. 무게를 재야 하는지 물어라.", en:"Do I need to weigh this?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"방문하려 한다. 미리 전화해야 하는지 물어라.", en:"Do I need to call first?"},
      {ko:"서비스를 쓰려 한다. 회원가입을 해야 하는지 물어라.", en:"Do I need to sign up?"},
      {ko:"본인 확인이 있다고 한다. 신분증을 가져가야 하는지 물어라.", en:"Do I need to bring my ID?"},
      {ko:"오후에 비 예보가 있다. 우산을 가져가야 하는지 물어라.", en:"Do I need to bring an umbrella?"}
      ,
      {ko:"기본 요금만 냈다. 추가로 더 내야 하는지 물어라.", en:"Do I need to pay extra?"},
      {ko:"지금은 사람이 많다. 나중에 다시 와야 하는지 물어라.", en:"Do I need to come back later?"}
      ,
      {ko:"서류를 받았다. 여기에 서명해야 하는지 물어라.", en:"Do I need to sign here?"},
      {ko:"예약이 됐다는데 불안하다. 다시 확인해야 하는지 물어라.", en:"Do I need to confirm?"}
    ]},
  { id:"travel_is_included", frame:"Is ~ included?", tf:"included", ko:"~ 포함인가요?", purpose:"포함 여부", re:"\\b(is|are)\\b[^.?]*\\bincluded\\b",
    items:[
      {ko:"호핑투어를 예약한다. 스노클 장비가 포함인지 물어라.", en:"Is snorkeling gear included?"},
      {ko:"숙박비만 봤다. 아침이 포함인지 물어라.", en:"Is breakfast included?"},
      {ko:"하루짜리 투어다. 점심이 포함인지 물어라.", en:"Is lunch included?"},
      {ko:"호텔에서 멀다. 픽업이 포함인지 물어라.", en:"Is pickup included?"},
      {ko:"가격표에 숫자만 적혀 있다. 세금이 포함인지 물어라.", en:"Is tax included?"},
      {ko:"투어에 공원을 간다고 한다. 입장료가 포함인지 물어라.", en:"Is the entrance fee included?"},
      {ko:"배 위에서 마실 게 필요하다. 생수가 포함인지 물어라.", en:"Is water included?"},
      {ko:"세트 메뉴를 시켰다. 음료가 포함인지 물어라.", en:"Is the drink included?"},
      {ko:"섬 투어를 예약한다. 수건이 포함인지 물어라.", en:"Are towels included?"},
      {ko:"계산서를 받았다. 팁이 포함인지 물어라.", en:"Is the tip included?"},
      {ko:"섬까지 배를 타고 간다고 한다. 배삯이 포함인지 물어라.", en:"Is the boat ride included?"},
      {ko:"투어를 예약한다. 가이드가 포함인지 물어라.", en:"Is a guide included?"},
      {ko:"계산서에 숫자가 여러 개다. 봉사료가 포함인지 물어라.", en:"Is the service charge included?"},
      {ko:"차를 빌렸다. 주차비가 포함인지 물어라.", en:"Is parking included?"},
      {ko:"아이들 몫이 걱정된다. 아이 음료가 포함인지 물어라.", en:"Are drinks included for kids?"},
      {ko:"메인 요리를 시켰다. 밥이 포함인지 물어라.", en:"Is rice included?"}
      
      ,
      {ko:"큰 물건을 샀다. 배송이 포함인지 물어라.", en:"Is delivery included?"},
      {ko:"세트를 시켰다. 후식이 포함인지 물어라.", en:"Is the dessert included?"},
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"아침 세트를 시켰다. 커피가 포함인지 물어라.", en:"Is coffee included?"},
      {ko:"음료를 시켰다. 리필이 포함인지 물어라.", en:"Are refills included?"},
      {ko:"촬영이 있는 수업이다. 사진이 포함인지 물어라.", en:"Are photos included?"},
      {ko:"렌트 요금을 들었다. 보험이 포함인지 물어라.", en:"Is insurance included?"},
      {ko:"숙소 요금을 들었다. 청소비가 포함인지 물어라.", en:"Is cleaning included?"}
      
      
      
    ]},
  { id:"travel_how_much", frame:"How much is ~?", tf:"how much is", ko:"~ 얼마예요?", purpose:"가격", re:"\\bhow much (is|are)\\b",
    items:[
      {ko:"택시를 타기 전이다. 요금이 얼마인지 물어라.", en:"How much is the taxi?"},
      {ko:"방을 알아보는 중이다. 하룻밤에 얼마인지 물어라.", en:"How much is it per night?"},
      {ko:"마음에 드는 셔츠가 있다. 얼마인지 물어라.", en:"How much is this shirt?"},
      {ko:"투어를 예약하려 한다. 1인당 얼마인지 물어라.", en:"How much is it per person?"},
      {ko:"아이도 같이 간다. 아이는 얼마인지 물어라.", en:"How much is it for a child?"},
      {ko:"체크인할 때 보증금을 받는다고 한다. 얼마인지 물어라.", en:"How much is the deposit?"},
      {ko:"공항 픽업을 신청하려 한다. 얼마인지 물어라.", en:"How much is the airport pickup?"},
      {ko:"섬에 가는 배표를 사려 한다. 얼마인지 물어라.", en:"How much is the ferry ticket?"},
      {ko:"택시를 잡았다. 공항까지 얼마인지 물어라.", en:"How much is it to the airport?"},
      {ko:"하루 더 있고 싶다. 하루 더 묵으면 얼마인지 물어라.", en:"How much is one more night?"},
      {ko:"공원 입구다. 입장료가 얼마인지 물어라.", en:"How much is the entrance fee?"},
      {ko:"조식이 숙박비에 안 들어 있다고 한다. 얼마인지 물어라.", en:"How much is breakfast?"},
      {ko:"이틀 묵으려 한다. 이틀에 얼마인지 물어라.", en:"How much is it for two nights?"},
      {ko:"세탁을 맡기려 한다. 요금이 얼마인지 물어라.", en:"How much is the laundry?"},
      {ko:"시장에서 여러 개를 골랐다. 다 해서 얼마인지 물어라.", en:"How much are these?"},
      {ko:"과일을 사려 한다. 1kg에 얼마인지 물어라.", en:"How much is this per kilo?"},
      {ko:"단품과 세트가 있다. 세트가 얼마인지 물어라.", en:"How much is the set menu?"},
      {ko:"큰 물건을 샀다. 배송비가 얼마인지 물어라.", en:"How much is delivery?"},
      {ko:"할인이 된다고 한다. 할인하면 얼마인지 물어라.", en:"How much is it with the discount?"},
      {ko:"제일 작은 걸 사려 한다. 그게 얼마인지 물어라.", en:"How much is the smallest one?"},
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"낱개로 사려 한다. 한 개에 얼마인지 물어라.", en:"How much is one?"},
      {ko:"카페에 들어왔다. 커피가 얼마인지 물어라.", en:"How much is a coffee?"},
      {ko:"여러 개를 담았다. 다 해서 얼마인지 물어라.", en:"How much is the total?"}
      
      
      ,
      {ko:"차를 세우려 한다. 주차비가 얼마인지 물어라.", en:"How much is parking?"},
      {ko:"신발을 골랐다. 얼마인지 물어라.", en:"How much are these shoes?"},
      {ko:"비가 온다. 우산이 얼마인지 물어라.", en:"How much is an umbrella?"}
    ]},
  { id:"travel_pay_by_card", frame:"Can I pay by card?", tf:"can i pay by card", ko:"카드로 결제되나요?", purpose:"카드 결제",
    tip:"<b>뭘 사든 할 말은 이 한 문장이에요.</b><br>음식이든 표든 기름이든 바꿀 필요 없어요 — <b>Can I pay by card?</b><br>상대가 카드기를 보면 바로 알아들어요.<br>현금으로 낼 때만 다른 말을 써요 → I'd like to pay in cash.",
    parts:[["Can I pay","내도 될까요"],["by card?","카드로"]],
    pnote:"<b>by card</b> 에는 <b>the 를 안 붙여요</b> — by card (○) by the card (✕). 수단을 말할 때는 the 없이 써요.",
    re:"\\bcan (i|we) pay\\b.{0,40}\\bby card\\b",
    items:[
      {ko:"식당에서 계산하려 한다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"야시장에서 물건을 골랐다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"투어 데스크에서 결제하려 한다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"택시에서 내리기 전이다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"호텔에서 보증금을 요구한다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"현금이 모자란다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"편의점에서 물과 간식을 샀다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"약국에서 약을 샀다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"선착장에서 배표를 사려 한다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"기념품 가게에서 계산하려 한다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"카페에서 커피를 시켰다. 카드가 되는지 물어라.", en:"Can I pay by card?"},
      {ko:"마사지 가게에서 계산하려 한다. 카드가 되는지 물어라.", en:"Can I pay by card?"}
    ]},
  { id:"travel_have_reservation", frame:"I have a reservation.", tf:"i have a reservation", ko:"예약했어요.", purpose:"예약 알리기", re:"\\b(i|we) have a reservation\\b",
    items:[
      {ko:"호텔에 도착했다. 체크인 카운터에서 예약했다고 말해라.", en:"I have a reservation."},
      {ko:"식당 입구에서 직원이 인원을 묻는다. 두 명 예약했다고 말해라.", en:"I have a reservation for two."}
      ,
      {ko:"직원이 이름을 묻는다. 김으로 예약했다고 말해라.", en:"I have a reservation under Kim."},
      {ko:"늦게 도착했다. 오늘 밤으로 예약했다고 말해라.", en:"I have a reservation for tonight."},
      {ko:"식당이 꽉 찼다. 7시로 예약했다고 말해라.", en:"I have a reservation at seven."},
      {ko:"렌터카 데스크 앞이다. 차를 예약했다고 말해라.", en:"I have a reservation for a car."},
      {ko:"프런트에서 며칠 묵는지 묻는다. 3박 예약했다고 말해라.", en:"I have a reservation for three nights."},
      {ko:"선착장 창구 앞이다. 배를 예약했다고 말해라.", en:"I have a reservation for the boat."},
      {ko:"식당에 가족 넷이 왔다. 네 명 예약했다고 말해라.", en:"We have a reservation for four."},
      {ko:"공항에 도착했다. 픽업을 예약했다고 말해라.", en:"I have a reservation for the airport pickup."},
      {ko:"프런트에서 방 종류를 묻는다. 가족실로 예약했다고 말해라.", en:"I have a reservation for a family room."},
      {ko:"내일 투어를 확인하러 왔다. 내일로 예약했다고 말해라.", en:"I have a reservation for tomorrow."}
      ,
      {ko:"선착장 데스크 앞이다. 섬 투어를 예약했다고 말해라.", en:"We have a reservation for the island tour."},
      {ko:"식당 입구다. 점심으로 예약했다고 말해라.", en:"I have a reservation for lunch."},
      {ko:"일행이 여섯이다. 여섯 명으로 예약했다고 말해라.", en:"I have a reservation for six people."},
      {ko:"뷔페 입구에 줄이 있다. 뷔페를 예약했다고 말해라.", en:"I have a reservation for the buffet."},
      {ko:"창가 자리로 잡아 뒀다. 창가 자리로 예약했다고 말해라.", en:"I have a reservation for a table by the window."},
      {ko:"마사지 가게 앞이다. 마사지를 예약했다고 말해라.", en:"We have a reservation for the massage."}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      
      {ko:"아내 이름으로 예약했다고 말해라.", en:"I have a reservation under my wife's name."},
      {ko:"여덟 시 저녁을 예약했다고 말해라.", en:"I have a reservation for dinner at eight."}
      ,
      {ko:"내일 밤으로 예약했다고 말해라.", en:"We have a reservation for tomorrow night."},
      {ko:"공연을 보러 왔다. 예약했다고 말해라.", en:"I have a reservation for the show."}
      
      
    ]},
  { id:"travel_can_i_leave", frame:"Can I leave ~ here?", tf:"can i leave", ko:"~ 여기 맡겨도 될까요?", purpose:"짐 맡기기", re:"\\bcan (i|we) leave\\b",
    items:[
      {ko:"체크아웃했는데 저녁 비행기다. 짐을 여기 맡겨도 되는지 물어라.", en:"Can I leave my bags here?"},
      {ko:"투어 가는 동안 배낭이 짐이 된다. 배낭을 맡겨도 되는지 물어라.", en:"Can I leave my backpack here?"},
      {ko:"잠깐 나갔다 올 건데 캐리어가 무겁다. 여기 맡겨도 되는지 물어라.", en:"Can I leave my suitcase here?"},
      {ko:"물놀이를 하러 간다. 신발을 여기 두고 가도 되는지 물어라.", en:"Can I leave my shoes here?"},
      {ko:"방을 뺐지만 저녁까지 시간이 있다. 짐을 여기 맡겨도 되는지 물어라.", en:"Can I leave my bags here until evening?"}
      ,
      {ko:"비싼 물건이 있다. 프런트에 맡겨도 되는지 물어라.", en:"Can I leave my valuables here?"},
      {ko:"유모차를 끌고 왔는데 안에 못 들어간다. 여기 둬도 되는지 물어라.", en:"Can I leave my stroller here?"},
      {ko:"온 가족 가방이 많다. 프런트에 맡겨도 되는지 물어라.", en:"Can we leave our bags at the front desk?"},
      {ko:"찾는 사람이 자리에 없다. 메모를 남겨도 되는지 물어라.", en:"Can I leave a message for him?"}
      ,
      {ko:"수영하고 나왔다. 젖은 수건을 여기 둬도 되는지 물어라.", en:"Can I leave my wet towel here?"},
      {ko:"주차 자리를 찾았다. 차를 여기 둬도 되는지 물어라.", en:"Can we leave the car here?"}
      ,
      {ko:"섬에 내린다. 장비를 배에 두고 가도 되는지 물어라.", en:"Can I leave my snorkel gear on the boat?"},
      {ko:"쇼핑백이 많다. 여기 맡겨도 되는지 물어라.", en:"Can I leave my shopping bags here?"},
      {ko:"비가 왔다. 우산을 입구에 둬도 되는지 물어라.", en:"Can I leave my umbrella at the door?"},
      {ko:"더 둘러보려 한다. 이걸 맡겨 두고 나중에 찾아가도 되는지 물어라.", en:"Can I leave this and pick it up later?"},
      {ko:"화장실에 다녀와야 한다. 그동안 짐을 자리에 둬도 되는지 물어라.", en:"Can I leave my things at the table?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"실내가 덥다. 겉옷을 두고 가도 되는지 물어라.", en:"Can I leave my jacket here?"},
      {ko:"상자가 크다. 여기 두고 가도 되는지 물어라.", en:"Can I leave this box here?"},
      {ko:"담당자가 없다. 이름과 번호를 남겨도 되는지 물어라.", en:"Can I leave my name and number?"}
      
      
      
    ]},
  { id:"travel_problem_with", frame:"There's a problem with ~.", tf:"there is a problem with", ko:"~에 문제가 있어요.", purpose:"문제 알리기", re:"\\bthere ?s a problem with\\b",
    items:[
      {ko:"방 에어컨이 안 된다. 프런트에 알려라.", en:"There's a problem with the air conditioner."},
      {ko:"방에서 와이파이가 안 잡힌다. 프런트에 알려라.", en:"There's a problem with the wifi."},
      {ko:"샤워기에서 찬물만 나온다. 프런트에 알려라.", en:"There's a problem with the shower."},
      {ko:"예약 내용이 신청한 것과 다르다. 프런트에 알려라.", en:"There's a problem with my reservation."},
      {ko:"계산서에 안 시킨 게 올라가 있다. 직원에게 알려라.", en:"There's a problem with the bill."},
      {ko:"카드키를 대도 문이 안 열린다. 프런트에 알려라.", en:"There's a problem with my key."},
      {ko:"시킨 것과 다른 음식이 나왔다. 직원에게 알려라.", en:"There's a problem with my order."},
      {ko:"변기 물이 안 내려간다. 프런트에 알려라.", en:"There's a problem with the toilet."},
      {ko:"카드 결제가 안 됐다고 뜬다. 직원에게 알려라.", en:"There's a problem with my payment."},
      {ko:"픽업 차가 시간이 지나도 안 온다. 투어 데스크에 알려라.", en:"There's a problem with the pickup."},
      {ko:"TV가 안 켜진다. 프런트에 알려라.", en:"There's a problem with the TV."},
      {ko:"방 불이 안 들어온다. 프런트에 알려라.", en:"There's a problem with the light."},
      {ko:"문이 잘 안 잠긴다. 프런트에 알려라.", en:"There's a problem with the door."},
      {ko:"더운물이 안 나온다. 프런트에 알려라.", en:"There's a problem with the hot water."},
      {ko:"좌석이 부서져 있다. 직원에게 알려라.", en:"There's a problem with the seat."},
      {ko:"음식에서 이상한 게 나왔다. 직원에게 알려라.", en:"There's a problem with the food."},
      {ko:"산 옷에 구멍이 있다. 가게에 알려라.", en:"There's a problem with this shirt."},
      {ko:"거스름돈이 모자란다. 직원에게 알려라.", en:"There's a problem with the change."},
      {ko:"영수증 금액이 이상하다. 직원에게 알려라.", en:"There's a problem with the receipt."}
      
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"휴대폰이 자꾸 꺼진다. 문제가 있다고 말해라.", en:"There's a problem with my phone."},
      {ko:"앱이 안 열린다. 문제가 있다고 말해라.", en:"There's a problem with the app."},
      {ko:"카드가 안 긁힌다. 문제가 있다고 말해라.", en:"There's a problem with my card."},
      {ko:"물건이 안 왔다. 배송에 문제가 있다고 말해라.", en:"There's a problem with the delivery."}
      
      
      
      ,
      {ko:"창문이 안 닫힌다. 문제가 있다고 말해라.", en:"There's a problem with the window."}
    ]},
  { id:"travel_cant_find", frame:"I can't find ~.", tf:"i cannot find", ko:"~를 못 찾겠어요.", purpose:"못 찾음", re:"\\b(i|we) cant find\\b",
    items:[
      {ko:"Grab을 불렀는데 기사가 어디 있는지 모르겠다. 못 찾겠다고 말해라.", en:"I can't find my driver."},
      {ko:"탑승 시간이 다 됐다. 게이트를 못 찾겠다고 말해라.", en:"I can't find my gate."},
      {ko:"가방을 다 뒤졌는데 여권이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my passport."},
      {ko:"주소를 들고 왔는데 호텔이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find the hotel."},
      {ko:"다른 사람 짐은 다 나왔다. 내 짐을 못 찾겠다고 말해라.", en:"I can't find my luggage."},
      {ko:"예약 확인 메일을 보여줘야 한다. 메일을 못 찾겠다고 말해라.", en:"I can't find my booking email."},
      {ko:"사람이 많아 가족을 놓쳤다. 못 찾겠다고 말해라.", en:"I can't find my family."},
      {ko:"방 앞에 왔는데 카드키가 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my room key."},
      {ko:"버스 정류장이 여기라는데 안 보인다. 못 찾겠다고 말해라.", en:"I can't find the bus stop."},
      {ko:"공연장에 들어왔다. 내 자리를 못 찾겠다고 말해라.", en:"I can't find my seat."},
      {ko:"개찰구 앞인데 표가 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my ticket."},
      {ko:"전화를 하려는데 핸드폰이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my phone."},
      {ko:"층을 올라가야 하는데 엘리베이터가 안 보인다. 못 찾겠다고 말해라.", en:"I can't find the elevator."},
      {ko:"시장에서 아들이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my son."},
      {ko:"건물 안에서 길을 잃었다. 출구를 못 찾겠다고 말해라.", en:"I can't find the exit."},
      {ko:"환불하려는데 영수증이 없다. 못 찾겠다고 말해라.", en:"I can't find my receipt."},
      {ko:"가격표가 안 보인다. 못 찾겠다고 말해라.", en:"I can't find the price tag."},
      {ko:"진열대를 다 봤는데 내 사이즈가 없다. 못 찾겠다고 말해라.", en:"I can't find my size."},
      {ko:"식당에서 화장실이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find the restroom."},
      {ko:"계산하고 나니 봉투가 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my shopping bag."}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"안경이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my glasses."},
      {ko:"지갑이 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my wallet."}
      ,
      {ko:"비가 오는데 우산이 없다. 못 찾겠다고 말해라.", en:"I can't find my umbrella."},
      {ko:"방이 어둡다. 전등 스위치를 못 찾겠다고 말해라.", en:"I can't find the light switch."},
      {ko:"충전기가 안 보인다. 못 찾겠다고 말해라.", en:"I can't find my charger."},
      {ko:"주문하려는데 메뉴판이 없다. 못 찾겠다고 말해라.", en:"I can't find the menu."}
      
    ]},
  { id:"travel_think_i_left", frame:"I think I left ~.", tf:"i think i left", ko:"~를 두고 온 것 같아요.", purpose:"두고 옴", re:"\\b(i|we) think (i|we) left\\b",
    items:[
      {ko:"택시에서 내렸는데 핸드폰이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my phone in the taxi."},
      {ko:"체크아웃하고 나오니 충전기가 없다. 두고 온 것 같다고 말해라.", en:"I think I left my charger in the room."},
      {ko:"식당에서 나오니 우산이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my umbrella at the restaurant."},
      {ko:"배에서 내렸는데 가방이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my bag on the boat."},
      {ko:"카페에서 나오니 선글라스가 없다. 두고 온 것 같다고 말해라.", en:"I think I left my sunglasses at the cafe."},
      {ko:"버스에서 내렸는데 카메라가 없다. 두고 온 것 같다고 말해라.", en:"I think I left my camera on the bus."},
      {ko:"보안검색을 지나고 나니 지갑이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my wallet at security."},
      {ko:"호텔을 나서고 보니 겉옷이 없다. 방에 두고 온 것 같다고 말해라.", en:"I think I left my jacket in the room."},
      {ko:"체크인할 때 여권을 맡겼는데 안 돌려받았다. 프런트에 두고 온 것 같다고 말해라.", en:"I think I left my passport at the front desk."},
      {ko:"식당에서 나오니 핸드폰이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my phone at the restaurant."},
      {ko:"해변에서 나오니 모자가 없다. 두고 온 것 같다고 말해라.", en:"I think I left my hat on the beach."},
      {ko:"택시를 타고 나서 보니 가방이 없다. 방에 두고 온 것 같다고 말해라.", en:"I think I left my bag in the room."},
      {ko:"창구를 지나고 나니 표가 없다. 두고 온 것 같다고 말해라.", en:"I think I left my ticket at the counter."},
      {ko:"사원에서 나오니 신발이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my shoes at the temple."},
      {ko:"투어 버스에서 내리니 물병이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my water bottle on the tour bus."},
      {ko:"계산하고 나오니 카드가 없다. 가게에 두고 온 것 같다고 말해라.", en:"I think I left my card at the shop."},
      {ko:"식당에서 나오니 가방이 없다. 자리에 두고 온 것 같다고 말해라.", en:"I think I left my bag at the table."}
      ,
      {ko:"옷을 갈아입고 나오니 안경이 없다. 탈의실에 두고 온 것 같다고 말해라.", en:"I think I left my glasses in the fitting room."},
      {ko:"푸드코트에서 나오니 핸드폰이 없다. 두고 온 것 같다고 말해라.", en:"I think I left my phone at the food court."}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      
      {ko:"내린 뒤 휴대폰이 없다. 차에 두고 온 것 같다고 말해라.", en:"I think I left my phone in the car."},
      {ko:"나오고 보니 가방이 없다. 카페에 두고 온 것 같다고 말해라.", en:"I think I left my bag at the cafe."}
      
      ,
      {ko:"나오면서 불을 안 끈 것 같다고 말해라.", en:"I think I left the light on."},
      {ko:"카드가 안 보인다. 기계에 두고 온 것 같다고 말해라.", en:"I think I left my card in the machine."}
      ,
      {ko:"우산이 없다. 기차에 두고 온 것 같다고 말해라.", en:"I think I left my umbrella on the train."}
    ]},
  { id:"travel_does_that_mean", frame:"Does that mean ~?", tf:"does that mean", ko:"그럼 ~라는 뜻이에요?", purpose:"의미 확인", tip:"상대 말을 듣고 <b>결론을 확인</b>하는 거예요.<br>주방 닫았다고 하면 → <b>Does that mean I can't order?</b><br>단어 뜻을 묻는 건 → What does ~ mean?", parts:[["Does that mean","그럼 ~라는 거예요?"],["I can't order?","제가 주문을 못 한다는"]], pnote:"<b>that</b>은 방금 상대가 한 말이에요. 뒤에는 내가 이해한 결론을 붙여요.", re:"\\bdoes that mean\\b",
    items:[
      {ko:"마감시간이 지났다고 한다. 그럼 주문을 못 한다는 뜻이냐고 되물어라.", en:"Does that mean I can't order?"},
      {ko:"날씨가 안 좋다고 한다. 그럼 투어가 취소라는 뜻이냐고 되물어라.", en:"Does that mean the tour is canceled?"},
      {ko:"추가 요금이 있다고 한다. 그럼 돈을 더 내야 한다는 뜻이냐고 되물어라.", en:"Does that mean I have to pay more?"},
      {ko:"배가 늦는다고 한다. 그럼 더 기다려야 한다는 뜻이냐고 되물어라.", en:"Does that mean we have to wait?"},
      {ko:"카드가 안 된다고 한다. 그럼 현금만 된다는 뜻이냐고 되물어라.", en:"Does that mean it's cash only?"},
      {ko:"픽업이 없다고 한다. 그럼 우리가 직접 가야 한다는 뜻이냐고 되물어라.", en:"Does that mean we go there ourselves?"},
      {ko:"방이 없다고 한다. 그럼 다른 호텔을 찾아야 한다는 뜻이냐고 되물어라.", en:"Does that mean we need another hotel?"},
      {ko:"파도가 높다고 한다. 그럼 오늘 수영을 못 한다는 뜻이냐고 되물어라.", en:"Does that mean we can't swim today?"},
      {ko:"조식 시간이 끝났다고 한다. 그럼 아침을 못 먹는다는 뜻이냐고 되물어라.", en:"Does that mean breakfast is over?"},
      {ko:"예약이 취소됐다고 한다. 그럼 다시 예약해야 한다는 뜻이냐고 되물어라.", en:"Does that mean I have to book again?"},
      {ko:"방 청소가 안 끝났다고 한다. 그럼 아직 체크인을 못 한다는 뜻이냐고 되물어라.", en:"Does that mean we can't check in yet?"},
      {ko:"성수기라고 한다. 그럼 값이 올라간다는 뜻이냐고 되물어라.", en:"Does that mean the price goes up?"},
      {ko:"길이 많이 막힌다고 한다. 그럼 배를 놓친다는 뜻이냐고 되물어라.", en:"Does that mean we miss the boat?"},
      {ko:"이건 안 된다고 한다. 그럼 기내에 못 들고 탄다는 뜻이냐고 되물어라.", en:"Does that mean I can't take this on the plane?"},
      {ko:"침대가 하나뿐이라고 한다. 그럼 다른 방이 필요하다는 뜻이냐고 되물어라.", en:"Does that mean we need a different room?"},
      {ko:"그건 지금 없다고 한다. 그럼 이게 다 팔렸다는 뜻이냐고 되물어라.", en:"Does that mean this one is sold out?"}
      ,
      {ko:"세일 상품이라고 한다. 그럼 반품이 안 된다는 뜻이냐고 되물어라.", en:"Does that mean I can't return it?"},
      {ko:"지금은 주문이 안 된다고 한다. 그럼 주방이 닫혔다는 뜻이냐고 되물어라.", en:"Does that mean the kitchen is closed?"},
      {ko:"세일이 어제까지였다고 한다. 그럼 할인이 끝났다는 뜻이냐고 되물어라.", en:"Does that mean the discount is over?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"돈을 안 받는다고 한다. 그럼 공짜라는 뜻인지 되물어라.", en:"Does that mean it's free?"}
      ,
      {ko:"서류가 하나 빠졌다고 한다. 그럼 다시 와야 한다는 뜻인지 되물어라.", en:"Does that mean I have to come back?"},
      {ko:"불이 꺼져 있다. 그럼 오늘 문을 닫았다는 뜻인지 되물어라.", en:"Does that mean it's closed today?"},
      {ko:"길이 막혔다고 한다. 그럼 못 간다는 뜻인지 되물어라.", en:"Does that mean we can't go?"}
      
      ,
      {ko:"화면에 아무것도 안 뜬다고 한다. 그럼 고장이라는 뜻인지 되물어라.", en:"Does that mean it's not working?"},
      {ko:"아직 절반도 못 했다고 한다. 그럼 시간이 더 필요하다는 뜻인지 되물어라.", en:"Does that mean we need more time?"},
      {ko:"이미 시작했다고 한다. 그럼 우리가 늦은 거냐고 되물어라.", en:"Does that mean we're late?"}
    ]},
  { id:"travel_say_again_slowly", frame:"Could you say that again, more slowly?", tf:"could you say that again", ko:"다시 천천히 말해 주실래요?", purpose:"다시 요청",
    tip:"<b>뭘 못 들었든 할 말은 이 한 문장이에요.</b><br>주소든 가격이든 시간이든 바꿀 필요 없어요 — <b>Could you say that again, more slowly?</b><br>못 알아들은 게 뭔지 굳이 말 안 해도 상대가 다시 천천히 말해줘요.<br>짧게는 <b>Sorry?</b> 나 <b>One more time, please.</b> 도 통해요.",
    parts:[["Could you say that again,","다시 말해 주실래요"],["more slowly?","좀 더 천천히"]],
    pnote:"<b>Could you ~?</b> 는 Can you 보다 정중해요. 처음 보는 사람한테는 Could 를 쓰면 부드러워요.<br><b>more slowly</b> 는 '더 천천히'예요 — slowly 만 써도 통해요.",
    re:"\\bcould you say\\b.{0,40}\\bagain\\b",
    items:[
      {ko:"직원이 너무 빨리 말했다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"공항 안내 방송을 놓쳤다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"가이드가 빠르게 설명하고 지나갔다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"전화 목소리가 너무 빨랐다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"길을 물었는데 설명이 너무 빨랐다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"가격을 말했는데 숫자를 못 들었다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"기사가 요금을 말했는데 못 알아들었다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"투어 집합 장소를 말해줬는데 못 들었다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"버스 기사가 내릴 곳을 빠르게 말했다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"조식 시간을 말해줬는데 못 들었다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"계산대에서 금액을 빠르게 말했다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"},
      {ko:"체크인 규정을 빠르게 설명하고 넘어갔다. 천천히 다시 말해달라고 해라.", en:"Could you say that again, more slowly?"}
    ]},
  { id:"travel_what_recommend", frame:"What do you recommend?", tf:"what do you recommend", ko:"뭐가 좋아요?", purpose:"추천 요청", re:"\\bwhat do you recommend\\b",
    items:[
      {ko:"식당인데 메뉴가 너무 많다. 뭐가 맛있는지 추천을 부탁해라.", en:"What do you recommend?"},
      {ko:"투어 종류가 많다. 가족한테 뭐가 좋은지 추천을 부탁해라.", en:"What do you recommend for a family?"},
      {ko:"카페에 처음 왔다. 뭘 마실지 추천을 부탁해라.", en:"What do you recommend to drink?"},
      {ko:"회사에 줄 선물을 사야 한다. 선물용으로 추천을 부탁해라.", en:"What do you recommend for a gift?"},
      {ko:"해변이 여러 곳이다. 스노클링은 어디가 좋은지 추천을 부탁해라.", en:"What do you recommend for snorkeling?"},
      {ko:"첫 방문이다. 어디를 먼저 보면 좋을지 추천을 부탁해라.", en:"What do you recommend for a first visit?"},
      {ko:"매운 걸 못 먹는다. 안 매운 걸로 추천을 부탁해라.", en:"What do you recommend that's not spicy?"},
      {ko:"아이들이 먹을 걸 골라야 한다. 뭐가 좋은지 추천을 부탁해라.", en:"What do you recommend for kids?"},
      {ko:"숙소 근처에서 저녁을 먹으려 한다. 추천을 부탁해라.", en:"What do you recommend around here?"},
      {ko:"하루가 통째로 비었다. 내일 뭘 하면 좋을지 추천을 부탁해라.", en:"What do you recommend for tomorrow?"},
      {ko:"아침에 뭘 먹을지 모르겠다. 추천을 부탁해라.", en:"What do you recommend for breakfast?"},
      {ko:"비가 온다. 오늘 뭘 하면 좋을지 추천을 부탁해라.", en:"What do you recommend for a rainy day?"},
      {ko:"해산물을 먹고 싶다. 어디가 좋은지 추천을 부탁해라.", en:"What do you recommend for seafood?"},
      {ko:"노을을 보고 싶다. 어디가 좋은지 추천을 부탁해라.", en:"What do you recommend for sunset?"},
      {ko:"반나절이 비었다. 뭘 하면 좋을지 추천을 부탁해라.", en:"What do you recommend for a half day?"},
      {ko:"메뉴판을 봐도 뭘 시킬지 모르겠다. 추천을 부탁해라.", en:"What do you recommend on the menu?"},
      {ko:"둘이 나눠 먹으려 한다. 뭘 시킬지 추천을 부탁해라.", en:"What do you recommend for two people?"},
      {ko:"기념품을 사려 한다. 뭐가 좋은지 추천을 부탁해라.", en:"What do you recommend for souvenirs?"},
      {ko:"현지 음식을 먹고 싶다. 뭐가 좋은지 추천을 부탁해라.", en:"What do you recommend that's local?"}
      
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"점심 메뉴를 못 고르겠다. 추천을 부탁해라.", en:"What do you recommend for lunch?"}
      
      
      
      
      
      ,
      {ko:"예산이 적다. 저렴한 쪽으로 추천받아라.", en:"What do you recommend on a budget?"},
      {ko:"식사를 마쳤다. 디저트를 추천받아라.", en:"What do you recommend for dessert?"}
    ]},
  { id:"travel_can_we_change", frame:"Can we change ~?", tf:"can we change", ko:"~ 바꿀 수 있을까요?", purpose:"변경", re:"\\bcan (we|i) change\\b",
    items:[
      {ko:"일정이 바뀌었다. 투어 날짜를 바꿀 수 있는지 물어라.", en:"Can we change the date?"},
      {ko:"옆방 소리가 다 들린다. 방을 바꿀 수 있는지 물어라.", en:"Can we change rooms?"},
      {ko:"저녁 일정이 밀렸다. 식당 예약 시간을 바꿀 수 있는지 물어라.", en:"Can we change the time?"},
      {ko:"식당에서 가족이 떨어져 앉았다. 자리를 바꿀 수 있는지 물어라.", en:"Can we change seats?"},
      {ko:"호텔 말고 공항에서 타고 싶다. 픽업 장소를 바꿀 수 있는지 물어라.", en:"Can we change the pickup place?"},
      {ko:"한 명이 더 가게 됐다. 인원을 바꿀 수 있는지 물어라.", en:"Can we change the number of people?"},
      {ko:"아직 음식이 안 나왔다. 주문을 바꿀 수 있는지 물어라.", en:"Can we change our order?"},
      {ko:"방이 너무 좁다. 큰 방으로 바꿀 수 있는지 물어라.", en:"Can we change to a bigger room?"},
      {ko:"현금이 필요하다. 여기서 돈을 바꿀 수 있는지 물어라.", en:"Can I change some money here?"},
      {ko:"돌아가는 날이 바뀌었다. 비행기를 바꿀 수 있는지 물어라.", en:"Can I change my flight?"},
      {ko:"밤에 도로 소음이 심하다. 조용한 방으로 바꿀 수 있는지 물어라.", en:"Can we change to a quieter room?"},
      {ko:"다른 투어가 더 좋아 보인다. 투어를 바꿀 수 있는지 물어라.", en:"Can we change the tour?"},
      {ko:"가족과 떨어져 앉았다. 비행기 자리를 바꿀 수 있는지 물어라.", en:"Can I change my seat on the plane?"},
      {ko:"비행기가 늦다. 체크아웃 시간을 바꿀 수 있는지 물어라.", en:"Can we change the check-out time?"},
      {ko:"옷이 작다. 큰 걸로 바꿀 수 있는지 물어라.", en:"Can I change this shirt for a bigger one?"},
      {ko:"자리가 에어컨 바로 아래다. 자리를 바꿀 수 있는지 물어라.", en:"Can we change tables?"},
      {ko:"색이 마음에 안 든다. 다른 색으로 바꿀 수 있는지 물어라.", en:"Can I change this for another color?"},
      {ko:"세트에 딸린 음료가 싫다. 음료를 바꿀 수 있는지 물어라.", en:"Can we change the drink?"}
      ,
      {ko:"단품보다 세트가 나아 보인다. 세트로 바꿀 수 있는지 물어라.", en:"Can we change to a set menu?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"사정이 생겼다. 계획을 바꿀 수 있는지 물어라.", en:"Can we change the plan?"}
      
      
      
      
      
      ,
      {ko:"일정이 안 맞는다. 표를 바꿀 수 있는지 물어라.", en:"Can I change my ticket?"}
      ,
      {ko:"너무 크다. 더 작은 것으로 바꿀 수 있는지 물어라.", en:"Can I change this to a smaller one?"}
    ]},
  { id:"travel_is_this_right", frame:"Is this the right ~?", tf:"is this the right", ko:"이거 맞나요?", purpose:"맞는지 확인", re:"\\bis this the right\\b",
    items:[
      {ko:"공항 가는 버스인지 확실하지 않다. 이 버스가 맞는지 기사에게 물어라.", en:"Is this the right bus?"},
      {ko:"게이트 앞에 왔는데 표시가 헷갈린다. 이 게이트가 맞는지 물어라.", en:"Is this the right gate?"},
      {ko:"체크인 줄이 여러 개다. 이 줄이 맞는지 물어라.", en:"Is this the right line?"},
      {ko:"내릴 정류장인지 확실하지 않다. 여기서 내리는 게 맞는지 물어라.", en:"Is this the right stop?"},
      {ko:"부두가 여러 개다. 배 타는 곳이 맞는지 물어라.", en:"Is this the right pier?"},
      {ko:"지도대로 왔는데 확실하지 않다. 이 건물이 맞는지 물어라.", en:"Is this the right building?"},
      {ko:"갈림길에 섰다. 이 길이 맞는지 물어라.", en:"Is this the right way?"},
      {ko:"창구가 여러 개다. 이 창구가 맞는지 물어라.", en:"Is this the right counter?"},
      {ko:"배가 여러 대 대어 있다. 우리 배가 맞는지 물어라.", en:"Is this the right boat?"},
      {ko:"옷을 골랐다. 이 사이즈가 맞는지 물어라.", en:"Is this the right size?"},
      {ko:"카드키가 안 열린다. 이 방이 맞는지 물어라.", en:"Is this the right room?"},
      {ko:"표에 적힌 자리를 찾았다. 이 자리가 맞는지 물어라.", en:"Is this the right seat?"},
      {ko:"기사에게 주소를 보여줬다. 이 주소가 맞는지 물어라.", en:"Is this the right address?"},
      {ko:"환전을 했다. 받은 금액이 맞는지 물어라.", en:"Is this the right amount?"},
      {ko:"입구가 여러 개다. 이 입구가 맞는지 물어라.", en:"Is this the right entrance?"},
      {ko:"가격표와 계산 금액이 다르다. 이 값이 맞는지 물어라.", en:"Is this the right price?"},
      {ko:"거스름돈을 받았다. 이게 맞는지 물어라.", en:"Is this the right change?"},
      {ko:"예약한 자리인지 확실하지 않다. 이 테이블이 맞는지 물어라.", en:"Is this the right table?"},
      {ko:"몰에서 층을 잘못 온 것 같다. 이 층이 맞는지 물어라.", en:"Is this the right floor?"},
      {ko:"같은 이름 가게가 여러 개다. 이 가게가 맞는지 물어라.", en:"Is this the right shop?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"열쇠가 여러 개다. 이게 맞는 열쇠인지 확인해라.", en:"Is this the right key?"},
      {ko:"서류가 여러 장이다. 이게 맞는 양식인지 확인해라.", en:"Is this the right form?"}
      ,
      {ko:"번호를 적었다. 이게 맞는 번호인지 확인해라.", en:"Is this the right number?"}
      ,
      {ko:"두 가지 색이 있다. 이게 맞는 색인지 확인해라.", en:"Is this the right color?"}
      ,
      {ko:"기차가 들어왔다. 이게 맞는 기차인지 확인해라.", en:"Is this the right train?"}
      
    ]},
  { id:"travel_where_meet", frame:"Where do we meet?", tf:"where do we meet", ko:"어디서 모여요?", purpose:"집결 장소", re:"\\bwhere do (we|i) meet\\b",
    items:[
      {ko:"투어를 예약했다. 어디서 만나는지 물어라.", en:"Where do we meet?"},
      {ko:"현지에서 가이드와 만난다고 한다. 어디서 만나는지 물어라.", en:"Where do we meet the guide?"},
      {ko:"픽업을 신청했다. 기사를 어디서 만나는지 물어라.", en:"Where do we meet the driver?"},
      {ko:"내일 아침 일찍 출발한다. 어디서 모이는지 물어라.", en:"Where do we meet tomorrow morning?"},
      {ko:"점심은 각자 먹는다고 한다. 다시 어디서 모이는지 물어라.", en:"Where do we meet after lunch?"},
      {ko:"스노클링을 하러 간다. 끝나고 어디서 모이는지 물어라.", en:"Where do we meet after snorkeling?"},
      {ko:"일행과 따로 다니기로 했다. 나중에 어디서 만날지 정해라.", en:"Where do we meet later?"},
      {ko:"일행과 떨어졌다. 어디서 다시 모이는지 물어라.", en:"Where do we meet the group?"},
      {ko:"공항에서 픽업을 받기로 했다. 어디서 만나는지 물어라.", en:"Where do we meet at the airport?"},
      {ko:"투어가 끝나면 각자 간다고 한다. 끝나고 어디서 만나는지 물어라.", en:"Where do we meet after the tour?"},
      {ko:"호텔에서 픽업한다고 한다. 호텔 어디서 만나는지 물어라.", en:"Where do we meet in the hotel?"},
      {ko:"배가 다른 곳에서 뜬다고 한다. 배를 어디서 만나는지 물어라.", en:"Where do we meet the boat?"},
      {ko:"사람이 많은 곳에 간다. 헤어지면 어디서 만날지 정해라.", en:"Where do we meet if we get separated?"},
      {ko:"저녁은 같이 먹기로 했다. 어디서 만나는지 물어라.", en:"Where do we meet for dinner?"},
      {ko:"각자 쇼핑하기로 했다. 끝나고 어디서 만나는지 물어라.", en:"Where do we meet after shopping?"},
      {ko:"점심을 같이 먹기로 했다. 어디서 만나는지 물어라.", en:"Where do we meet for lunch?"},
      {ko:"몰이 아주 크다. 어디서 만날지 정해라.", en:"Where do we meet at the mall?"},
      {ko:"택시를 불렀다. 어디서 만나는지 물어라.", en:"Where do we meet the taxi?"}
      
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      
      
      
      {ko:"커피 한잔하기로 했다. 어디서 만나는지 물어라.", en:"Where do we meet for coffee?"}
      ,
      {ko:"역에서 보기로 했다. 역 어디서 만나는지 물어라.", en:"Where do we meet at the station?"}
      
    ]},
  { id:"travel_what_should_i_do", frame:"What should I/we do?", tf:"what should i do", ko:"어떻게 해야 하나요?", purpose:"대처 방법", re:"\\bwhat should (i|we) do\\b",
    items:[
      {ko:"짐이 안 나왔다. 어떻게 해야 하는지 물어라.", en:"What should I do?"},
      {ko:"비가 와서 투어가 취소됐다. 이제 어떻게 할지 물어라.", en:"What should we do now?"},
      {ko:"표를 잃어버렸다. 어떻게 해야 하는지 물어라.", en:"What should I do about my ticket?"},
      {ko:"배가 늦는다. 기다리는 동안 뭘 할지 물어라.", en:"What should we do while we wait?"},
      {ko:"투어 일정과 픽업 시간이 겹쳤다. 일정을 어떻게 해야 할지 물어라.", en:"What should we do about the schedule?"},
      {ko:"카드가 안 된다. 그럼 어떻게 해야 하는지 물어라.", en:"What should I do then?"},
      {ko:"여권을 잃어버렸다. 먼저 뭘 해야 하는지 물어라.", en:"What should I do first?"},
      {ko:"야외 투어를 예약했다. 비가 오면 어떻게 하는지 물어라.", en:"What should I do if it rains?"},
      {ko:"체크인 시간 전에 도착했다. 짐을 어떻게 해야 하는지 물어라.", en:"What should we do with our luggage?"},
      {ko:"계산서에 모르는 요금이 붙었다. 어떻게 해야 하는지 물어라.", en:"What should I do about the extra charge?"},
      {ko:"투어가 늦게 끝난다. 저녁을 어떻게 해야 할지 물어라.", en:"What should we do about dinner?"},
      {ko:"체크아웃하는데 프런트가 비었다. 열쇠를 어떻게 해야 하는지 물어라.", en:"What should I do with the key?"},
      {ko:"날씨가 안 좋다. 배가 취소되면 어떻게 해야 하는지 물어라.", en:"What should we do if the boat is canceled?"},
      {ko:"비행기를 놓쳤다. 어떻게 해야 하는지 물어라.", en:"What should I do about my flight?"},
      {ko:"서류를 다 썼다. 이걸 어떻게 해야 하는지 물어라.", en:"What should I do with this form?"},
      {ko:"환불을 받고 싶다. 어떻게 해야 하는지 물어라.", en:"What should I do to get a refund?"},
      {ko:"대기가 아주 길다. 어떻게 해야 할지 물어라.", en:"What should we do about the wait?"},
      {ko:"푸드코트에서 다 먹었다. 쟁반을 어떻게 해야 하는지 물어라.", en:"What should I do with the tray?"},
      {ko:"사이즈가 걱정된다. 안 맞으면 어떻게 해야 하는지 물어라.", en:"What should I do if it doesn't fit?"},
      {ko:"음식이 많이 남았다. 어떻게 해야 할지 물어라.", en:"What should we do with the leftovers?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"한 가지를 끝냈다. 다음에 뭘 해야 하는지 물어라.", en:"What should I do next?"}
      
      
      ,
      {ko:"길이 막힌다. 늦으면 어떻게 해야 하는지 물어라.", en:"What should I do if I'm late?"},
      {ko:"옆집이 시끄럽다. 어떻게 해야 하는지 물어라.", en:"What should we do about the noise?"},
      {ko:"물건이 약해 보인다. 고장 나면 어떻게 해야 하는지 물어라.", en:"What should I do if it breaks?"}
    ]},
  { id:"travel_id_like_to", frame:"I'd like to ~.", tf:"id like to", ko:"~하고 싶어요.", purpose:"의사 표현", re:"\\b(id|we ?d) like to\\b",
    items:[
      {ko:"호텔에 도착했다. 직원에게 지금 체크인하고 싶다고 말해라.", en:"I'd like to check in."},
      {ko:"내일 섬 투어를 하려 한다. 예약하고 싶다고 말해라.", en:"I'd like to book an island tour for tomorrow."},
      {ko:"스노클링 투어를 알아보고 있다. 내일 것으로 예약하고 싶다고 말해라.", en:"I'd like to book a snorkeling tour for tomorrow."},
      {ko:"예약이 제대로 됐는지 불안하다. 예약을 확인하고 싶다고 말해라.", en:"I'd like to confirm my booking."},
      {ko:"방을 정하기 전이다. 방을 먼저 보고 싶다고 말해라.", en:"I'd like to see the room first."},
      {ko:"하루 더 머물기로 했다. 숙박을 연장하고 싶다고 말해라.", en:"I'd like to extend my stay."},
      {ko:"체크아웃 시간이 너무 이르다. 늦게 체크아웃하고 싶다고 말해라.", en:"I'd like to check out later."},
      {ko:"렌터카 업체에 왔다. 차를 하루 빌리고 싶다고 말해라.", en:"I'd like to rent a car for a day."},
      {ko:"스노클링 장비가 없다. 장비를 빌리고 싶다고 말해라.", en:"I'd like to rent snorkeling gear."},
      {ko:"배표 파는 곳이다. 내일 멩알룸 가는 배를 예약하고 싶다고 말해라.", en:"I'd like to book a boat to Mengalum for tomorrow."},
      {ko:"식당에 전화를 걸었다. 오늘 저녁 자리를 예약하고 싶다고 말해라.", en:"I'd like to reserve a table for tonight."},
      {ko:"호텔 프런트에 있다. 공항 가는 택시를 예약하고 싶다고 말해라.", en:"I'd like to book a taxi to the airport."},
      {ko:"계산할 차례다. 현금으로 내고 싶다고 말해라.", en:"I'd like to pay in cash."},
      {ko:"투어를 안 가기로 했다. 예약을 취소하고 싶다고 말해라.", en:"I'd like to cancel my reservation."},
      {ko:"말이 안 통해 문제가 안 풀린다. 책임자와 이야기하고 싶다고 말해라.", en:"I'd like to speak to the manager."}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"병원에 전화했다. 진료를 예약하고 싶다고 말해라.", en:"I'd like to make an appointment."}
      ,
      {ko:"카페에서 커피 두 잔을 주문하고 싶다고 말해라.", en:"I'd like to order two coffees."},
      {ko:"옷이 맞는지 모르겠다. 입어보고 싶다고 말해라.", en:"I'd like to try this on."},
      {ko:"산 물건이 마음에 안 든다. 반품하고 싶다고 말해라.", en:"I'd like to return this."},
      {ko:"모르는 게 있다. 질문하고 싶다고 말해라.", en:"I'd like to ask a question."}
      
      
    ]},
  { id:"travel_is_there", frame:"Is there ~?", tf:"is there", ko:"(근처에) ~ 있나요?", purpose:"존재 확인", tip:"그 <b>장소·시설이 있는지</b>예요.<br>근처에 ATM 있나요 → <b>Is there an ATM?</b><br>상대가 물건을 가졌는지는 → Do you have ~?", parts:[["Is there","~ 있나요?"],["an ATM nearby?","근처에 ATM이"]], pnote:"여기서 <b>there</b>는 '거기'가 아니라 <b>있다</b>예요. 진짜 주어는 뒤의 an ATM.", re:"\\bis there\\b",
    items:[
      {ko:"현금이 필요하다. 이 근처에 ATM이 있는지 확인해라.", en:"Is there an ATM nearby?"},
      {ko:"아이가 아프다. 근처에 병원이 있는지 확인해라.", en:"Is there a clinic nearby?"},
      {ko:"약을 사야 한다. 주변에 약국이 있는지 확인해라.", en:"Is there a pharmacy nearby?"},
      {ko:"빨래가 쌓였다. 근처에 코인세탁소가 있는지 확인해라.", en:"Is there a laundromat nearby?"},
      {ko:"아이 둘을 데리고 간다. 어린이 할인이 있는지 확인해라.", en:"Is there a discount for kids?"},
      {ko:"투어 가격을 설명받았다. 스노클 장비에 추가요금이 붙는지 확인해라.", en:"Is there an extra charge for snorkeling gear?"},
      {ko:"늦게 체크아웃하려 한다. 추가요금이 붙는지 확인해라.", en:"Is there an extra charge for late checkout?"},
      {ko:"호텔에서 공항으로 가야 한다. 공항 셔틀 서비스가 있는지 확인해라.", en:"Is there a shuttle to the airport?"},
      {ko:"체크아웃 후 몇 시간이 뜬다. 짐을 맡겨둘 곳이 있는지 확인해라.", en:"Is there a place to leave our bags?"},
      {ko:"오늘 오후에 섬에 들어가고 싶다. 오후 배편이 있는지 확인해라.", en:"Is there a ferry this afternoon?"},
      {ko:"객실 시설을 확인하는 중이다. 방에서 쓰는 와이파이가 있는지 확인해라.", en:"Is there wifi in the room?"},
      {ko:"식당에 들어가기 전이다. 복장 규정이 있는지 확인해라.", en:"Is there a dress code?"},
      {ko:"투어 상품을 알아보고 있다. 호텔 픽업 서비스가 있는지 확인해라.", en:"Is there a hotel pickup service?"},
      {ko:"식당 결제 조건을 알아보고 있다. 최소 주문금액 규정이 있는지 확인해라.", en:"Is there a minimum charge?"},
      {ko:"아이와 수영장에 가려 한다. 어린이 구역이 따로 있는지 확인해라.", en:"Is there a kids' area in the pool?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"상대의 표정이 안 좋다. 무슨 문제가 있는지 물어라.", en:"Is there a problem?"},
      {ko:"값이 비싸다. 더 싼 방법이 있는지 물어라.", en:"Is there a cheaper way?"},
      {ko:"역까지 가야 한다. 버스가 있는지 물어라.", en:"Is there a bus to the station?"},
      {ko:"혼자 왔다. 한 자리가 있는지 물어라.", en:"Is there a seat for one?"},
      {ko:"차를 가져왔다. 여기 주차가 되는지 물어라.", en:"Is there parking here?"}
      
      
      ,
      {ko:"뭘 좀 사야 한다. 근처에 가게가 있는지 물어라.", en:"Is there a store nearby?"}
    ]},
  { id:"travel_how_much_longer", frame:"How much longer ~?", tf:"how much longer", ko:"(진행 중) 얼마나 더요?", purpose:"남은 시간",
    tip:"<b>이미 시작된 일</b>의 남은 시간이에요.<br>아직 시작 전이라 전체 시간을 물으면 → How long does it take?<br><br><b style=\"color:#189E79\">주력은 ②번이에요.</b> <b>How much longer will it take?</b> — 뭔가 진행 중이면 거의 다 통해요.<br>음식 · 청소 · 수속 · 이동 · 수리 전부 ②번.<br><br><b style=\"color:#C0653A\">단, 아직 시작도 안 한 일에는 ②를 못 써요.</b><br>탑승 전에 'will it take?' 하면 <b>'뭐가 얼마나 걸린다는 거지?'</b> 하고 되물어요. 탑승이 진행 중이 아니니까요. 그땐 ④ until.<br><br><b>②와 ③의 차이</b><br>· <b>take</b> = 끝나면 결과가 나오는 <b>일</b> (청소 · 조리 · 수속)<br>· <b>last</b> = 계속 이어지는 <b>행사 · 현상</b> (투어 · 비 · 공연)<br>몇 시에 끝나는지가 궁금하면 → What time does the tour end?",
    /* 네 갈래. 재는 대상이 다르다.
       ② take 와 ③ last 를 가른 이유 — 투어가 진행 중일 때 'will the tour take?' 보다
       'will the tour last?' 가 자연스럽다. take 는 끝나면 결과가 나오는 일,
       last 는 그냥 이어지는 것이다. */
    branches:[
      ["do","내 기다림을 강조","do I/we have to wait?"],
      ["take","진행 중인 일이 끝나기까지","will it take?"],
      ["last","진행 중인 행사·현상이 얼마나 더","will it last?"],
      ["until","아직 시작 안 한 시점까지","until ~?"]
    ],
    parts:[["How much longer","얼마나 더"],["will it take?","걸려요?"]],
    pnote:"<b>How much longer</b> 에는 주어가 없어요 — '얼마나 더'라는 말 덩어리라, 주어는 뒤에 붙는 말에 있어요.<br>① do <b>I</b> have to wait? ② will <b>it</b> take? ③ will <b>the tour</b> last? ④ until <b>boarding</b>?",
    re:"\\bhow much longer\\b",
    items:[
      /* ① do — 내 기다림을 강조. 기다리는 대상이 분명할 때만 쓸 수 있다 */
      {ko:"수하물 벨트 앞이다. 짐이 안 나와 계속 서 있다. 내가 얼마나 더 기다려야 하는지 물어라.", en:"How much longer do I have to wait for my bags?", br:"do", alt:["How much longer will it take?"]},
      {ko:"식당 대기 명단에 이름을 올렸다. 자리가 안 난다. 얼마나 더 기다려야 하는지 물어라.", en:"How much longer do we have to wait for a table?", br:"do", alt:["How much longer will it be?"]},
      {ko:"픽업 차가 약속 시간이 지나도 안 온다. 얼마나 더 기다려야 하는지 물어라.", en:"How much longer do we have to wait for the pickup?", br:"do", alt:["How much longer will it be?"]},
      {ko:"방이 준비가 안 돼 로비에서 기다리는 중이다. 얼마나 더 기다려야 하는지 물어라.", en:"How much longer do we have to wait for the room?", br:"do", alt:["How much longer will it take?"]},
      {ko:"Grab 기사를 한참 기다렸는데 안 온다. 얼마나 더 기다려야 하는지 물어라.", en:"How much longer do I have to wait for the driver?", br:"do", alt:["How much longer will it be?"]},
      /* ② will ~ take — 진행 중인 '일'이 끝나기까지. 여행 실전의 주력이다 */
      {ko:"방 청소가 지금 진행 중이라고 한다. 끝나는 데 얼마나 더 걸리는지 물어라.", en:"How much longer will it take?", br:"take", alt:["How much longer until the room is ready?"]},
      {ko:"음식을 시켰고 지금 만드는 중이다. 나오는 데 얼마나 더 걸리는지 물어라.", en:"How much longer will the food take?", br:"take", alt:["How much longer until the food comes?"]},
      {ko:"체크인 수속이 시작됐는데 오래 걸린다. 끝나는 데 얼마나 더 걸리는지 물어라.", en:"How much longer will check-in take?", br:"take", alt:["How much longer will it take?"]},
      {ko:"택시를 타고 이동하는 중이다. 도착까지 얼마나 더 걸리는지 물어라.", en:"How much longer will it take?", br:"take", alt:["How much longer until we get there?","How much longer will it take to get there?"]},
      {ko:"세탁을 맡겼는데 아직 안 됐다. 되는 데 얼마나 더 걸리는지 물어라.", en:"How much longer will the laundry take?", br:"take", alt:["How much longer until it's ready?"]},
      /* ③ will ~ last — 진행 중인 '행사·현상'이 얼마나 더 이어지는지 */
      {ko:"투어가 이미 진행 중이다. 앞으로 얼마나 더 이어지는지 물어라.", en:"How much longer will the tour last?", br:"last", alt:["How much longer will the tour take?"]},
      {ko:"비가 아까부터 계속 온다. 앞으로 얼마나 더 올지 물어라.", en:"How much longer will the rain last?", br:"last", alt:["How much longer until the rain stops?"]},
      {ko:"공연이 시작된 지 한참 됐다. 앞으로 얼마나 더 하는지 물어라.", en:"How much longer will the show last?", br:"last", alt:["How much longer until it ends?"]},
      {ko:"세일 기간 중이다. 세일이 앞으로 얼마나 더 가는지 물어라.", en:"How much longer will the sale last?", br:"last", alt:["How much longer until the sale ends?"]},
      {ko:"차가 꽉 막혀 있다. 이 정체가 얼마나 더 갈지 물어라.", en:"How much longer will the traffic last?", br:"last", alt:["How much longer will it take?"]},
      /* ④ until — 아직 시작도 안 한 시점까지 남은 시간. 여기에 will it take? 를 쓰면 어색하다 */
      {ko:"게이트 앞이다. 탑승은 아직 시작 전이다. 탑승까지 얼마나 더 남았는지 물어라.", en:"How much longer until boarding?", br:"until", alt:["How much longer until boarding starts?","How much longer do we have to wait?"]},
      {ko:"배가 고프다. 저녁 시간까지 얼마나 더 남았는지 물어라.", en:"How much longer until dinner?", br:"until", alt:["How much longer will it be?"]},
      {ko:"투어 집합 장소에 미리 와 있다. 투어 시작까지 얼마나 더 남았는지 물어라.", en:"How much longer until the tour starts?", br:"until", alt:["How much longer do we have to wait?"]},
      {ko:"입장 줄에 서 있다. 아직 문을 안 열었다. 들어갈 수 있을 때까지 얼마나 더 남았는지 물어라.", en:"How much longer until we can go in?", br:"until", alt:["How much longer until entry starts?"]},
      {ko:"배에 탔는데 아직 출발 전이다. 출발까지 얼마나 더 남았는지 물어라.", en:"How much longer until we leave?", br:"until", alt:["How much longer do we have to wait to leave?"]}
    ]},
  { id:"travel_whats_difference", frame:"What's the difference between ~ and ~?", tf:"what s the difference between", ko:"~와 ~는 뭐가 달라요?", purpose:"차이 묻기", re:"\\bwhat ?(s|is)? ?the difference between\\b",
    items:[
      {ko:"비슷한 투어가 두 개 있다. 어느 게 좋은지 말고 두 상품이 뭐가 다른지 물어라.", en:"What's the difference between these two tours?"},
      {ko:"섬까지 페리와 스피드보트가 있다. 두 배가 뭐가 다른지 물어라.", en:"What's the difference between the ferry and the speedboat?"},
      {ko:"일반 패키지와 프리미엄 패키지가 있다. 두 등급이 뭐가 다른지 물어라.", en:"What's the difference between the standard and premium packages?"},
      {ko:"같은 투어에 반나절과 하루 일정이 있다. 두 일정이 뭐가 다른지 물어라.", en:"What's the difference between the half-day and full-day tours?"},
      {ko:"일반 객실과 바다 전망 객실이 있다. 두 방이 뭐가 다른지 물어라.", en:"What's the difference between a standard room and a sea-view room?"},
      {ko:"트윈룸과 더블룸 중에 골라야 한다. 추천 말고 두 방이 뭐가 다른지 물어라.", en:"What's the difference between a twin room and a double room?"},
      {ko:"같은 방인데 요금이 두 가지다. 두 요금 조건이 뭐가 다른지 물어라.", en:"What's the difference between these two room rates?"},
      {ko:"편도표와 왕복표가 있다. 두 표가 뭐가 다른지 물어라.", en:"What's the difference between a one-way ticket and a round-trip ticket?"},
      {ko:"스노클링과 다이빙을 설명해준다. 추천 말고 두 활동이 뭐가 다른지 물어라.", en:"What's the difference between snorkeling and diving?"},
      {ko:"같은 투어에 오전 일정과 오후 일정이 있다. 두 일정이 뭐가 다른지 물어라.", en:"What's the difference between the morning and afternoon tours?"}
      ,
      {ko:"표 두 장이 값이 다르다. 두 표가 뭐가 다른지 물어라.", en:"What's the difference between these two tickets?"},
      {ko:"메뉴에 비슷한 요리가 두 개 있다. 두 요리가 뭐가 다른지 물어라.", en:"What's the difference between these two dishes?"},
      {ko:"호텔 예약 옵션 두 개의 값이 다르다. 두 옵션이 뭐가 다른지 물어라.", en:"What's the difference between these two options?"},
      {ko:"보트에 좌석이 두 종류다. 두 자리가 뭐가 다른지 물어라.", en:"What's the difference between these two seats?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"구형과 신형이 같이 있다. 차이를 물어라.", en:"What's the difference between the old one and the new one?"},
      {ko:"큰 사이즈와 작은 사이즈가 있다. 차이를 물어라.", en:"What's the difference between the big size and the small size?"},
      {ko:"값이 다른 두 개가 있다. 차이를 물어라.", en:"What's the difference between these two prices?"}
      ,
      {ko:"따뜻한 것과 차가운 것이 있다. 차이를 물어라.", en:"What's the difference between hot and iced?"},
      {ko:"색이 두 가지다. 차이를 물어라.", en:"What's the difference between these two colors?"}
      
      ,
      {ko:"사이즈가 두 개 남았다. 차이를 물어라.", en:"What's the difference between these two sizes?"}
    ]},
  { id:"travel_what_does_mean", frame:"What does ~ mean?", tf:"what does mean", ko:"~가 무슨 뜻이에요?", purpose:"표현 뜻 묻기", tip:"<b>영어 단어·표시</b>의 뜻을 묻는 거예요.<br>간판에 cash only → <b>What does cash only mean?</b><br>상대 말의 결론을 되묻는 건 → Does that mean ~?", parts:[["What does","무슨"],["cash only","← 모르는 말을 가운데"],["mean?","뜻이에요?"]], pnote:"모르는 말을 <b>가운데</b> 끼워 넣어요. 앞뒤(What does … mean?)는 항상 그대로.", re:"\\bwhat does\\b.*\\bmean\\b",
    items:[
      {ko:"예약 화면에서 'non-refundable'이라는 말을 봤다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"non-refundable\" mean?"},
      {ko:"투어 설명에 'shared transfer'라고 적혀 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"shared transfer\" mean?"},
      {ko:"계산서에 'service charge'라는 항목이 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"service charge\" mean?"},
      {ko:"직원이 'deposit'이라는 단어를 썼는데 모르겠다. 그 단어가 무슨 뜻인지 물어라.", en:"What does \"deposit\" mean?"},
      {ko:"호텔 안내문에 'complimentary'라는 단어가 있다. 그 단어가 무슨 뜻인지 물어라.", en:"What does \"complimentary\" mean?"},
      {ko:"예약 화면에 'fully booked'라고 떠 있다. 그 문구가 무슨 뜻인지 물어라.", en:"What does \"fully booked\" mean?"},
      {ko:"공항 전광판에 'last call'이라고 나온다. 그 안내가 무슨 뜻인지 물어라.", en:"What does \"last call\" mean?"},
      {ko:"카페 메뉴에 'free refill'이라고 적혀 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"free refill\" mean?"},
      {ko:"표 옵션에 'round trip'이라고 쓰여 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"round trip\" mean?"},
      {ko:"표 옵션에서 'one way'라는 말을 봤다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"one way\" mean?"},
      {ko:"식당 입구에 'cash only'라고 적혀 있다. 그 문구가 무슨 뜻인지 물어라.", en:"What does \"cash only\" mean?"},
      {ko:"호텔 밖에 'no vacancy'라고 쓰여 있다. 그 문구가 무슨 뜻인지 물어라.", en:"What does \"no vacancy\" mean?"},
      {ko:"투어 안내에 'meeting point'라는 말이 있다. 장소를 묻지 말고 그 표현이 무슨 뜻인지 물어라.", en:"What does \"meeting point\" mean?"},
      {ko:"예약 조건에 'free cancellation'이라고 적혀 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"free cancellation\" mean?"},
      {ko:"메뉴 아래에 'minimum spend'라는 말이 있다. 금액을 묻지 말고 그 표현이 무슨 뜻인지 물어라.", en:"What does \"minimum spend\" mean?"}
    ,
      /* + 자주 쓰는 낱말로 10개 더 (여행 밖 상황) */
      {ko:"안내판에 'sold out'이라고 적혀 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"sold out\" mean?"},
      {ko:"기계에 'out of order'라고 붙어 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"out of order\" mean?"},
      {ko:"안내문에 'free of charge'라고 쓰여 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"free of charge\" mean?"},
      {ko:"문에 'no entry'라고 적혀 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"no entry\" mean?"},
      {ko:"가게에 'closed for today'라고 붙어 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"closed for today\" mean?"},
      {ko:"상품 설명에 'in stock'이라고 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"in stock\" mean?"},
      {ko:"가격표에 'on sale'이라고 적혀 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"on sale\" mean?"},
      {ko:"메뉴판에 'take out'이라고 쓰여 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"take out\" mean?"},
      {ko:"안내에 'self service'라고 적혀 있다. 그 표현이 무슨 뜻인지 물어라.", en:"What does \"self service\" mean?"},
      {ko:"테이블에 'reserved'라고 놓여 있다. 그 말이 무슨 뜻인지 물어라.", en:"What does \"reserved\" mean?"}
    ]}
,
  { id:"travel_how_do_i", frame:"How do I ~?", tf:"how do i", ko:"~ 어떻게 해요?", purpose:"방법 묻기",
    tip:"<b>하는 방법</b>을 물어요 — 쓰는 법 · 사는 법 · 내는 법.<br>이거 어떻게 써요 → <b>How do I use this?</b><br><b>How can I ~?</b> 도 같은 뜻이라 둘 다 정답이에요.<br>장소 가는 길은 → How do I get to ~?",
    parts:[["How do I","어떻게 해요"],["use this?","이걸 쓰는지"]],
    pnote:"주어는 <b>I</b>. 뒤에는 <b>하고 싶은 동작</b>이 붙어요 — use this · buy a ticket · pay.",
    re:"\\bhow (do|can) (i|we)\\b(?!\\s+get to\\b)",
    items:[
      {ko:"자판기 앞에 섰다. 표 사는 방법을 물어라.", en:"How do I buy a ticket?"},
      {ko:"버스에 탔다. 요금 내는 방법을 물어라.", en:"How do I pay for the bus?"},
      {ko:"방이 덥다. 에어컨 켜는 방법을 물어라.", en:"How do I turn on the air conditioner?"},
      {ko:"인터넷을 쓰고 싶다. 와이파이 연결하는 방법을 물어라.", en:"How do I connect to the Wi-Fi?"},
      {ko:"귀중품을 넣으려 한다. 금고 쓰는 방법을 물어라.", en:"How do I use the safe?"},
      {ko:"장비를 처음 써본다. 스노클 쓰는 방법을 물어라.", en:"How do I use this snorkel?"},
      {ko:"빨래를 해야 한다. 세탁기 쓰는 방법을 물어라.", en:"How do I use the washing machine?"},
      {ko:"처음 보는 기계다. 쓰는 방법을 물어라.", en:"How do I use this machine?"},
      {ko:"산 물건이 마음에 안 든다. 환불받는 방법을 물어라.", en:"How can I get a refund?"},
      {ko:"일정이 바뀌었다. 예약 취소하는 방법을 물어라.", en:"How can I cancel my booking?"},
      {ko:"짐을 부쳐야 한다. 부치는 방법을 물어라.", en:"How do I check in my bags?"},
      {ko:"현지 유심을 샀다. 설정하는 방법을 물어라.", en:"How do I set up this SIM card?"},
      {ko:"카드키가 안 먹는다. 문 여는 방법을 물어라.", en:"How do I open the door?"}
      ,
      {ko:"차가 필요하다. 택시 부르는 방법을 물어라.", en:"How do I call a taxi?"},
      {ko:"앱으로 차를 부르려 한다. 그랩 부르는 방법을 물어라.", en:"How do I order a Grab?"}
      ,
      {ko:"계산하려는데 방식을 모르겠다. 내는 방법을 물어라.", en:"How do I pay?"},
      {ko:"카운터에서 시켜야 하는지 모르겠다. 주문하는 방법을 물어라.", en:"How do I order?"},
      {ko:"인터넷으로 예약하려 한다. 방법을 물어라.", en:"How do I book online?"},
      {ko:"빌린 카메라가 낯설다. 사진 찍는 방법을 물어라.", en:"How do I take a photo with this?"}
      ,
      {ko:"객실 티비를 못 켜겠다. 켜는 방법을 물어라.", en:"How do I turn on the TV?"},
      {ko:"자려는데 불이 안 꺼진다. 끄는 방법을 물어라.", en:"How do I turn off the light?"},
      {ko:"답답하다. 창문 여는 방법을 물어라.", en:"How do I open the window?"},
      {ko:"배터리가 없다. 충전하는 방법을 물어라.", en:"How do I charge this?"}
      ,
      {ko:"나중에 연락해야 한다. 연락하는 방법을 물어라.", en:"How can I contact you?"},
      {ko:"혼자서는 안 된다. 도움받는 방법을 물어라.", en:"How can I get help?"},
      {ko:"앱을 처음 깔았다. 쓰는 방법을 물어라.", en:"How do I use this app?"},
      {ko:"셀프 반납기계 앞이다. 책 반납하는 방법을 물어라.", en:"How do I return this book?"},
      {ko:"물이 안 뜨겁다. 온수 나오게 하는 방법을 물어라.", en:"How do I turn on the hot water?"},
      {ko:"샤워기가 낯설다. 쓰는 방법을 물어라.", en:"How do I use the shower?"},
      {ko:"나갈 때 문을 잠가야 한다. 잠그는 방법을 물어라.", en:"How do I lock the door?"},
      {ko:"변기 물 내리는 버튼이 안 보인다. 내리는 방법을 물어라.", en:"How do I flush the toilet?"},
      {ko:"영수증이 필요하다. 받는 방법을 물어라.", en:"How do I get a receipt?"},
      {ko:"QR 코드로 결제하란다. 찍는 방법을 물어라.", en:"How do I scan the QR code?"},
      {ko:"지갑을 안 가져왔다. 폰으로 내는 방법을 물어라.", en:"How do I pay with my phone?"},
      {ko:"여럿이 먹었다. 따로 계산하는 방법을 물어라.", en:"How do I split the bill?"},
      {ko:"교통카드 잔액이 없다. 충전하는 방법을 물어라.", en:"How do I top up this card?"},
      {ko:"호텔을 나가려 한다. 체크아웃하는 방법을 물어라.", en:"How do I check out?"},
      {ko:"하루 더 묵고 싶다. 연장하는 방법을 물어라.", en:"How can I extend my stay?"},
      {ko:"짐이 안 나왔다. 분실 신고하는 방법을 물어라.", en:"How do I report a lost bag?"},
      {ko:"탑승구를 못 찾겠다. 찾는 방법을 물어라.", en:"How do I find my gate?"},
      {ko:"식당에 자리가 없다. 예약하는 방법을 물어라.", en:"How do I reserve a table?"},
      {ko:"자리가 불편하다. 자리 바꾸는 방법을 물어라.", en:"How can I change my seat?"},
      {ko:"조금 깎고 싶다. 할인받는 방법을 물어라.", en:"How can I get a discount?"},
      {ko:"서류를 뽑아야 한다. 출력하는 방법을 물어라.", en:"How do I print this?"},
      {ko:"소리가 너무 작다. 키우는 방법을 물어라.", en:"How do I turn up the volume?"},
      {ko:"회원 가입을 해야 한다. 가입하는 방법을 물어라.", en:"How do I sign up?"}
    ]}
,
  { id:"travel_can_i_ask", frame:"Can I ask ~?", tf:"can i ask", ko:"~ 물어봐도 돼요?", purpose:"물어보기 전 한마디",
    tip:"<b>묻기 전에 먼저 까는 말</b>이에요.<br>낯선 사람한테 바로 질문하면 부담스러운데, 이 한마디를 앞에 붙이면 훨씬 부드러워요.<br>Excuse me, <b>can I ask you something?</b> 로 시작하면 거의 다 들어줘요.",
    parts:[["Can I ask","물어봐도 돼요"],["you something?","뭐 좀"]],
    pnote:"주어는 <b>I</b>. 뒤에는 <b>물어볼 것</b>이 붙어요 — you something · a question · for directions.",
    re:"\\bcan (i|we) ask\\b",
    items:[
      {ko:"길에서 낯선 사람에게 말을 걸려 한다. 뭐 좀 물어봐도 되는지 물어라.", en:"Can I ask you something?"},
      {ko:"직원에게 질문이 하나 있다. 질문해도 되는지 물어라.", en:"Can I ask a question?"},
      {ko:"길을 잃었다. 길을 물어봐도 되는지 물어라.", en:"Can I ask for directions?"},
      {ko:"혼자서는 안 되겠다. 도움을 청해도 되는지 물어라.", en:"Can I ask for help?"},
      {ko:"가격표가 안 보인다. 가격을 물어봐도 되는지 물어라.", en:"Can I ask the price?"},
      {ko:"가이드와 인사했다. 이름을 물어봐도 되는지 물어라.", en:"Can I ask your name?"},
      {ko:"설명을 다 들었는데 하나가 더 궁금하다. 하나만 더 물어도 되는지 물어라.", en:"Can I ask one more thing?"},
      {ko:"뭘 시킬지 모르겠다. 추천을 물어봐도 되는지 물어라.", en:"Can I ask for a recommendation?"},
      {ko:"이유가 궁금하다. 왜 그런지 물어봐도 되는지 물어라.", en:"Can I ask why?"},
      {ko:"이 사람은 모르는 눈치다. 다른 사람한테 물어봐도 되는지 물어라.", en:"Can I ask someone else?"}
    ]}
];

const TRAVEL_KEY="speakingroom:travelrepeat";

const TRAVEL_KR={
  "Are drinks included for kids?":"아이들 음료도 포함이에요?",
  "Are photos included?":"사진 포함이에요?",
  "Are refills included?":"리필 포함이에요?",
  "Are towels included?":"수건 포함이에요?",
  "Are you my Grab driver?":"제 그랩 기사님이세요?",
  "Can I ask a question?":"질문 하나 해도 될까요?",
  "Can I ask for a recommendation?":"추천 좀 부탁드려도 될까요?",
  "Can I ask for directions?":"길 좀 여쭤봐도 될까요?",
  "Can I ask for help?":"도움 좀 청해도 될까요?",
  "Can I ask one more thing?":"하나만 더 여쭤봐도 될까요?",
  "Can I ask someone else?":"다른 분께 여쭤봐도 될까요?",
  "Can I ask the price?":"가격 좀 여쭤봐도 될까요?",
  "Can I ask why?":"이유를 여쭤봐도 될까요?",
  "Can I ask you something?":"뭐 좀 여쭤봐도 될까요?",
  "Can I ask your name?":"성함 여쭤봐도 될까요?",
  "Can I bring food inside?":"음식 가지고 들어가도 될까요?",
  "Can I change my flight?":"비행기 편 바꿀 수 있어요?",
  "Can I change my seat on the plane?":"비행기 좌석 바꿀 수 있어요?",
  "Can I change my ticket?":"표 바꿀 수 있어요?",
  "Can I change some money here?":"여기서 환전할 수 있어요?",
  "Can I change this for another color?":"이거 다른 색으로 바꿀 수 있어요?",
  "Can I change this shirt for a bigger one?":"이 셔츠 더 큰 걸로 바꿀 수 있어요?",
  "Can I change this to a smaller one?":"이거 더 작은 걸로 바꿀 수 있어요?",
  "Can I charge my phone here?":"여기서 휴대폰 충전해도 될까요?",
  "Can I check in now?":"지금 체크인해도 될까요?",
  "Can I come back tomorrow?":"내일 다시 와도 될까요?",
  "Can I come with you?":"같이 가도 될까요?",
  "Can I get a bag for this?":"이거 담을 봉투 하나 주실래요?",
  "Can I get a blanket?":"담요 하나 주실래요?",
  "Can I get a child seat?":"유아용 카시트 하나 주실래요?",
  "Can I get a clean cup?":"깨끗한 컵으로 주실래요?",
  "Can I get a discount?":"할인 좀 해주실래요?",
  "Can I get a fork?":"포크 하나 주실래요?",
  "Can I get a large size?":"큰 사이즈로 주실래요?",
  "Can I get a map?":"지도 한 장 주실래요?",
  "Can I get a piece of paper?":"종이 한 장 주실래요?",
  "Can I get a receipt?":"영수증 주실래요?",
  "Can I get a spoon?":"숟가락 하나 주실래요?",
  "Can I get a straw?":"빨대 하나 주실래요?",
  "Can I get a to-go box?":"포장 용기 하나 주실래요?",
  "Can I get a wake-up call at six?":"6시에 모닝콜 해주실래요?",
  "Can I get a window seat?":"창가 자리로 주실래요?",
  "Can I get an extra key?":"열쇠 하나 더 주실래요?",
  "Can I get an iced coffee?":"아이스커피 하나 주세요.",
  "Can I get another towel?":"수건 하나 더 주실래요?",
  "Can I get more rice?":"밥 좀 더 주실래요?",
  "Can I get one more plate?":"접시 하나 더 주실래요?",
  "Can I get some hot water?":"뜨거운 물 좀 주실래요?",
  "Can I get some ice?":"얼음 좀 주실래요?",
  "Can I get some napkins?":"냅킨 좀 주실래요?",
  "Can I get some salt?":"소금 좀 주실래요?",
  "Can I get some sugar?":"설탕 좀 주실래요?",
  "Can I get some water, please?":"물 좀 주세요.",
  "Can I get some water?":"물 좀 주실래요?",
  "Can I get the bill, please?":"계산서 주세요.",
  "Can I get the check?":"계산서 주실래요?",
  "Can I get two tickets, please?":"표 두 장 주세요.",
  "Can I get two tickets?":"표 두 장 주세요.",
  "Can I leave a message for him?":"그분께 메시지 좀 남겨도 될까요?",
  "Can I leave my backpack here?":"여기 배낭 좀 맡겨도 될까요?",
  "Can I leave my bags here until evening?":"저녁까지 여기 가방 좀 맡겨도 될까요?",
  "Can I leave my bags here?":"여기 가방 좀 맡겨도 될까요?",
  "Can I leave my gear here for a bit?":"여기 장비 잠깐 둬도 될까요?",
  "Can I leave my jacket here?":"여기 겉옷 좀 맡겨도 될까요?",
  "Can I leave my luggage here until this evening?":"오늘 저녁까지 여기 짐 좀 맡겨도 될까요?",
  "Can I leave my name and number?":"이름이랑 번호 남겨도 될까요?",
  "Can I leave my shoes here?":"여기 신발 벗어둬도 될까요?",
  "Can I leave my shopping bags here?":"여기 쇼핑백 좀 맡겨도 될까요?",
  "Can I leave my snorkel gear on the boat?":"스노클 장비 배에 두고 가도 될까요?",
  "Can I leave my stroller here?":"여기 유모차 좀 두고 가도 될까요?",
  "Can I leave my suitcase here for a while?":"여기 캐리어 잠깐 맡겨도 될까요?",
  "Can I leave my suitcase here?":"여기 캐리어 좀 맡겨도 될까요?",
  "Can I leave my things at the table?":"제 물건 자리에 두고 가도 될까요?",
  "Can I leave my umbrella at the door?":"우산 문 앞에 둬도 될까요?",
  "Can I leave my valuables here?":"여기 귀중품 좀 맡겨도 될까요?",
  "Can I leave my wet towel here?":"젖은 수건 여기 둬도 될까요?",
  "Can I leave this and pick it up later?":"이거 맡겨두고 나중에 찾아가도 될까요?",
  "Can I leave this box here?":"여기 이 상자 좀 둬도 될까요?",
  "Can I open the window?":"창문 열어도 될까요?",
  "Can I park here?":"여기 주차해도 될까요?",
  "Can I pay by card here?":"여기 카드로 결제돼요?",
  "Can I pay by card?":"카드로 결제돼요?",
  "Can I pay for the tour by card?":"투어 카드로 결제돼요?",
  "Can I pay the deposit by card?":"보증금 카드로 결제돼요?",
  "Can I pay the taxi fare by card?":"택시 요금 카드로 결제돼요?",
  "Can I return this?":"이거 반품해도 될까요?",
  "Can I see it?":"그거 좀 볼 수 있을까요?",
  "Can I sit here?":"여기 앉아도 될까요?",
  "Can I still buy a ticket for today?":"오늘 표 아직 살 수 있어요?",
  "Can I still check in?":"지금도 체크인돼요?",
  "Can I still order?":"지금도 주문돼요?",
  "Can I take a photo here?":"여기서 사진 찍어도 될까요?",
  "Can I take pictures here?":"여기서 사진 찍어도 될까요?",
  "Can I taste this?":"이거 맛봐도 될까요?",
  "Can I try this on?":"이거 입어봐도 될까요?",
  "Can I use the bathroom?":"화장실 좀 써도 될까요?",
  "Can I use the restroom?":"화장실 좀 써도 될까요?",
  "Can we bring our kids?":"아이들 데려와도 될까요?",
  "Can we change our order?":"주문 바꿀 수 있어요?",
  "Can we change our seats?":"자리 바꿀 수 있어요?",
  "Can we change rooms?":"방 바꿀 수 있어요?",
  "Can we change seats?":"자리 바꿀 수 있어요?",
  "Can we change tables?":"테이블 바꿀 수 있어요?",
  "Can we change the check-out time?":"체크아웃 시간 바꿀 수 있어요?",
  "Can we change the date?":"날짜 바꿀 수 있어요?",
  "Can we change the drink?":"음료 바꿀 수 있어요?",
  "Can we change the number of people?":"인원 바꿀 수 있어요?",
  "Can we change the pickup place?":"픽업 장소 바꿀 수 있어요?",
  "Can we change the pickup time?":"픽업 시간 바꿀 수 있어요?",
  "Can we change the plan?":"계획 바꿀 수 있어요?",
  "Can we change the reservation?":"예약 바꿀 수 있어요?",
  "Can we change the room?":"방 바꿀 수 있어요?",
  "Can we change the time?":"시간 바꿀 수 있어요?",
  "Can we change the tour?":"투어 바꿀 수 있어요?",
  "Can we change to a bigger room?":"더 큰 방으로 바꿀 수 있어요?",
  "Can we change to a quieter room?":"더 조용한 방으로 바꿀 수 있어요?",
  "Can we change to a set menu?":"세트 메뉴로 바꿀 수 있어요?",
  "Can we check out late?":"늦게 체크아웃해도 될까요?",
  "Can we come in with a stroller?":"유모차 가지고 들어가도 될까요?",
  "Can we eat here?":"여기서 먹어도 될까요?",
  "Can we join the next tour?":"다음 투어에 참여해도 될까요?",
  "Can we leave our bags at the front desk?":"프런트에 가방 좀 맡겨도 될까요?",
  "Can we leave the car here?":"여기 차 세워둬도 될까요?",
  "Can we order now?":"지금 주문해도 될까요?",
  "Can we share one dish?":"한 접시 나눠 먹어도 될까요?",
  "Can we sit by the window?":"창가에 앉아도 될까요?",
  "Can we sit here?":"여기 앉아도 될까요?",
  "Can we sit outside?":"밖에 앉아도 될까요?",
  "Can we start now?":"지금 시작해도 될까요?",
  "Can we stay a bit longer?":"조금 더 있어도 될까요?",
  "Can we still join the tour?":"지금도 투어 참여할 수 있어요?",
  "Can we still use the room?":"방 아직 써도 돼요?",
  "Can we swim here?":"여기서 수영해도 될까요?",
  "Can we take a break?":"좀 쉬어도 될까요?",
  "Can we use the pool after checkout?":"체크아웃하고 나서 수영장 써도 될까요?",
  "Can we wait here?":"여기서 기다려도 될까요?",
  "Can you bring my bags to the room?":"제 짐 방으로 올려주실래요?",
  "Can you call a taxi for me?":"택시 좀 불러주실래요?",
  "Can you carry this for me?":"이것 좀 들어다 주실래요?",
  "Can you check my booking?":"제 예약 좀 확인해주실래요?",
  "Can you close the window?":"창문 좀 닫아주실래요?",
  "Can you drop us at the entrance?":"입구에서 내려주실래요?",
  "Can you fix the air conditioner?":"에어컨 좀 고쳐주실래요?",
  "Can you give me a better price?":"좀 더 싸게 해주실래요?",
  "Can you give me a discount for two?":"두 개 사면 깎아주실래요?",
  "Can you give me a discount?":"좀 깎아주실래요?",
  "Can you heat this up?":"이것 좀 데워주실래요?",
  "Can you help me with this bag?":"이 가방 좀 도와주실래요?",
  "Can you help me with this form?":"이 서류 작성 좀 도와주실래요?",
  "Can you hold this for me?":"이것 좀 잠깐 들고 계실래요?",
  "Can you make it a bit cheaper?":"조금만 더 싸게 해주실래요?",
  "Can you make it cheaper?":"좀 싸게 해주실래요?",
  "Can you make it less spicy?":"덜 맵게 해주실래요?",
  "Can you open the door?":"문 좀 열어주실래요?",
  "Can you put it in a box?":"상자에 담아주실래요?",
  "Can you save my seat?":"제 자리 좀 맡아주실래요?",
  "Can you send me the photo?":"그 사진 저한테 보내주실래요?",
  "Can you show me on the map?":"지도에서 보여주실래요?",
  "Can you speak in English?":"영어로 말해주실래요?",
  "Can you speak more slowly?":"좀 천천히 말씀해 주실래요?",
  "Can you spell your name?":"이름 철자 좀 불러주실래요?",
  "Can you split the bill?":"계산 따로 해주실래요?",
  "Can you stop here, please?":"여기서 세워주실래요?",
  "Can you take a photo of us?":"저희 사진 좀 찍어주실래요?",
  "Can you take me to the airport?":"공항까지 데려다주실래요?",
  "Can you turn on the light?":"불 좀 켜주실래요?",
  "Can you turn up the air conditioner?":"에어컨 좀 세게 틀어주실래요?",
  "Can you turn up the aircon?":"에어컨 좀 세게 틀어주실래요?",
  "Can you wait a moment?":"잠깐만 기다려주실래요?",
  "Can you wait here for five minutes?":"여기서 5분만 기다려주실래요?",
  "Can you watch my bags for a minute?":"제 짐 잠깐만 봐주실래요?",
  "Can you wrap this as a gift?":"이거 선물 포장 해주실래요?",
  "Can you write down the address?":"주소 좀 적어주실래요?",
  "Could you say that again, more slowly?":"다시 천천히 말씀해 주실래요?",
  "Could you say that last part again, more slowly?":"마지막 부분 다시 천천히 말씀해 주실래요?",
  "Could you say the name again, more slowly?":"이름 다시 천천히 말씀해 주실래요?",
  "Could you say the pickup time again, more slowly?":"픽업 시간 다시 천천히 말씀해 주실래요?",
  "Could you say the room number again, more slowly?":"방 번호 다시 천천히 말씀해 주실래요?",
  "Could you take a photo of us?":"저희 사진 좀 찍어주실래요?",
  "Do I need to book a table?":"자리 예약해야 해요?",
  "Do I need to book in advance?":"미리 예약해야 해요?",
  "Do I need to bring a swimsuit?":"수영복 가져가야 해요?",
  "Do I need to bring an umbrella?":"우산 가져가야 해요?",
  "Do I need to bring cash?":"현금 가져가야 해요?",
  "Do I need to bring my ID?":"신분증 가져가야 해요?",
  "Do I need to bring my passport?":"여권 가져가야 해요?",
  "Do I need to call first?":"먼저 전화해야 해요?",
  "Do I need to change buses?":"버스 갈아타야 해요?",
  "Do I need to check out first?":"체크아웃 먼저 해야 해요?",
  "Do I need to come back later?":"나중에 다시 와야 해요?",
  "Do I need to confirm?":"확정해야 해요?",
  "Do I need to keep the receipt?":"영수증 가지고 있어야 해요?",
  "Do I need to pay a deposit?":"보증금 내야 해요?",
  "Do I need to pay extra?":"추가 요금 내야 해요?",
  "Do I need to pay now?":"지금 결제해야 해요?",
  "Do I need to print the ticket?":"표 출력해 가야 해요?",
  "Do I need to reserve a seat?":"좌석 예약해야 해요?",
  "Do I need to show my ticket again?":"표 또 보여줘야 해요?",
  "Do I need to sign here?":"여기 서명해야 해요?",
  "Do I need to sign up?":"가입해야 해요?",
  "Do I need to take off my shoes?":"신발 벗어야 해요?",
  "Do I need to wait in line?":"줄 서서 기다려야 해요?",
  "Do I need to wear a life jacket?":"구명조끼 입어야 해요?",
  "Do I need to weigh this?":"이거 무게 재야 해요?",
  "Do we need to bring towels?":"수건 가져가야 해요?",
  "Do we need to order at the counter?":"카운터에서 주문해야 해요?",
  "Do we need to tip?":"팁 줘야 해요?",
  "Do you have Wi-Fi?":"와이파이 있어요?",
  "Do you have a bag?":"봉투 있어요?",
  "Do you have a bigger size?":"더 큰 사이즈 있어요?",
  "Do you have a charger?":"충전기 있어요?",
  "Do you have a cheaper room?":"더 싼 방 있어요?",
  "Do you have a crib?":"아기 침대 있어요?",
  "Do you have a high chair?":"유아용 의자 있어요?",
  "Do you have a kids menu?":"어린이 메뉴 있어요?",
  "Do you have a locker?":"물품 보관함 있어요?",
  "Do you have a pen?":"펜 있어요?",
  "Do you have a room available?":"빈 방 있어요?",
  "Do you have a seat for one?":"한 명 자리 있어요?",
  "Do you have a shuttle to the airport?":"공항 가는 셔틀 있어요?",
  "Do you have a smaller size?":"더 작은 사이즈 있어요?",
  "Do you have a table for four?":"네 명 자리 있어요?",
  "Do you have a vegetarian dish?":"채식 메뉴 있어요?",
  "Do you have an English menu?":"영어 메뉴판 있어요?",
  "Do you have an adapter?":"어댑터 있어요?",
  "Do you have an umbrella?":"우산 있어요?",
  "Do you have another color?":"다른 색 있어요?",
  "Do you have any vegetarian options?":"채식 메뉴 있어요?",
  "Do you have anything cheaper?":"더 싼 거 있어요?",
  "Do you have anything not spicy?":"안 매운 거 있어요?",
  "Do you have change for fifty?":"50짜리 잔돈 있어요?",
  "Do you have change for this?":"이거 잔돈으로 바꿔주실 수 있어요?",
  "Do you have life jackets for kids?":"아이용 구명조끼 있어요?",
  "Do you have soy milk?":"두유 있어요?",
  "Do you have space for tomorrow?":"내일 자리 있어요?",
  "Do you have sunscreen?":"선크림 있어요?",
  "Do you have this in blue?":"이거 파란색 있어요?",
  "Do you have this in stock?":"이거 재고 있어요?",
  "Do you have water?":"물 있어요?",
  "Does that mean I can't order?":"그럼 주문 안 된다는 말씀이세요?",
  "Does that mean I can't return it?":"그럼 반품이 안 된다는 말씀이세요?",
  "Does that mean I can't take this on the plane?":"그럼 이거 비행기에 못 가지고 탄다는 말씀이세요?",
  "Does that mean I have to book again?":"그럼 다시 예약해야 한다는 말씀이세요?",
  "Does that mean I have to come back?":"그럼 다시 와야 한다는 말씀이세요?",
  "Does that mean I have to pay more?":"그럼 돈을 더 내야 한다는 말씀이세요?",
  "Does that mean I need to pay extra?":"그럼 추가 요금을 내야 한다는 말씀이세요?",
  "Does that mean breakfast is over?":"그럼 조식이 끝났다는 말씀이세요?",
  "Does that mean breakfast isn't included?":"그럼 조식이 포함이 아니라는 말씀이세요?",
  "Does that mean it's cash only?":"그럼 현금만 된다는 말씀이세요?",
  "Does that mean it's closed today?":"그럼 오늘은 문을 닫았다는 말씀이세요?",
  "Does that mean it's free?":"그럼 공짜라는 말씀이세요?",
  "Does that mean it's not working?":"그럼 작동이 안 된다는 말씀이세요?",
  "Does that mean the discount is over?":"그럼 할인이 끝났다는 말씀이세요?",
  "Does that mean the kitchen is closed?":"그럼 주방이 닫았다는 말씀이세요?",
  "Does that mean the price goes up?":"그럼 가격이 올라간다는 말씀이세요?",
  "Does that mean the tour is canceled?":"그럼 투어가 취소됐다는 말씀이세요?",
  "Does that mean this one is sold out?":"그럼 이건 다 팔렸다는 말씀이세요?",
  "Does that mean we can't check in yet?":"그럼 아직 체크인 안 된다는 말씀이세요?",
  "Does that mean we can't go?":"그럼 못 간다는 말씀이세요?",
  "Does that mean we can't swim today?":"그럼 오늘 수영 못 한다는 말씀이세요?",
  "Does that mean we go there ourselves?":"그럼 저희가 알아서 가야 한다는 말씀이세요?",
  "Does that mean we have to wait?":"그럼 기다려야 한다는 말씀이세요?",
  "Does that mean we miss the boat?":"그럼 배를 놓친다는 말씀이세요?",
  "Does that mean we need a different room?":"그럼 다른 방을 써야 한다는 말씀이세요?",
  "Does that mean we need another hotel?":"그럼 다른 호텔을 잡아야 한다는 말씀이세요?",
  "Does that mean we need more time?":"그럼 시간이 더 필요하다는 말씀이세요?",
  "Does that mean we're late?":"그럼 저희가 늦었다는 말씀이세요?",
  "Excuse me.":"실례합니다.",
  "Good afternoon.":"안녕하세요. (오후 인사)",
  "Good morning.":"안녕하세요. (아침 인사)",
  "Hello.":"안녕하세요.",
  "Hi.":"안녕하세요.",
  "How can I cancel my booking?":"예약 어떻게 취소해요?",
  "How can I change my seat?":"자리 어떻게 바꿔요?",
  "How can I contact you?":"어떻게 연락드리면 돼요?",
  "How can I extend my stay?":"숙박 어떻게 연장해요?",
  "How can I get a discount?":"할인 어떻게 받아요?",
  "How can I get a refund?":"환불 어떻게 받아요?",
  "How can I get help?":"도움 어떻게 받아요?",
  "How do I book online?":"인터넷으로 어떻게 예약해요?",
  "How do I buy a ticket?":"표 어떻게 사요?",
  "How do I call a taxi?":"택시 어떻게 불러요?",
  "How do I charge this?":"이거 어떻게 충전해요?",
  "How do I check in my bags?":"짐 어떻게 부쳐요?",
  "How do I check out?":"체크아웃 어떻게 해요?",
  "How do I connect to the Wi-Fi?":"와이파이 어떻게 연결해요?",
  "How do I find my gate?":"제 탑승구 어떻게 찾아요?",
  "How do I flush the toilet?":"변기 물 어떻게 내려요?",
  "How do I get a receipt?":"영수증 어떻게 받아요?",
  "How do I get to downtown?":"시내에 어떻게 가요?",
  "How do I get to that restaurant?":"그 식당에 어떻게 가요?",
  "How do I get to the airport?":"공항에 어떻게 가요?",
  "How do I get to the bank?":"은행에 어떻게 가요?",
  "How do I get to the beach?":"해변에 어떻게 가요?",
  "How do I get to the bus terminal?":"버스 터미널에 어떻게 가요?",
  "How do I get to the cafe?":"그 카페에 어떻게 가요?",
  "How do I get to the city center?":"시내 중심가에 어떻게 가요?",
  "How do I get to the ferry terminal?":"여객선 터미널에 어떻게 가요?",
  "How do I get to the hospital?":"병원에 어떻게 가요?",
  "How do I get to the hotel?":"호텔에 어떻게 가요?",
  "How do I get to the island?":"그 섬에 어떻게 가요?",
  "How do I get to the jetty?":"선착장에 어떻게 가요?",
  "How do I get to the mall?":"쇼핑몰에 어떻게 가요?",
  "How do I get to the night market?":"야시장에 어떻게 가요?",
  "How do I get to the old town?":"구시가지에 어떻게 가요?",
  "How do I get to the park?":"공원에 어떻게 가요?",
  "How do I get to the parking lot?":"주차장에 어떻게 가요?",
  "How do I get to the post office?":"우체국에 어떻게 가요?",
  "How do I get to the seafood market?":"수산시장에 어떻게 가요?",
  "How do I get to the shopping street?":"쇼핑 거리에 어떻게 가요?",
  "How do I get to the station?":"역에 어떻게 가요?",
  "How do I get to the sunset point?":"일몰 명소에 어떻게 가요?",
  "How do I get to the waterfront?":"해안가에 어떻게 가요?",
  "How do I get to the zoo?":"동물원에 어떻게 가요?",
  "How do I lock the door?":"문 어떻게 잠가요?",
  "How do I open the door?":"문 어떻게 열어요?",
  "How do I open the window?":"창문 어떻게 열어요?",
  "How do I order a Grab?":"그랩 어떻게 불러요?",
  "How do I order?":"어떻게 주문해요?",
  "How do I pay for the bus?":"버스 요금 어떻게 내요?",
  "How do I pay with my phone?":"휴대폰으로 어떻게 결제해요?",
  "How do I pay?":"어떻게 결제해요?",
  "How do I print this?":"이거 어떻게 출력해요?",
  "How do I report a lost bag?":"짐 분실 신고 어떻게 해요?",
  "How do I reserve a table?":"자리 어떻게 예약해요?",
  "How do I return this book?":"이 책 어떻게 반납해요?",
  "How do I scan the QR code?":"QR 코드 어떻게 찍어요?",
  "How do I set up this SIM card?":"이 유심 어떻게 설정해요?",
  "How do I sign up?":"어떻게 가입해요?",
  "How do I split the bill?":"계산 어떻게 따로 해요?",
  "How do I take a photo with this?":"이걸로 사진 어떻게 찍어요?",
  "How do I top up this card?":"이 카드 어떻게 충전해요?",
  "How do I turn off the light?":"불 어떻게 꺼요?",
  "How do I turn on the TV?":"텔레비전 어떻게 켜요?",
  "How do I turn on the air conditioner?":"에어컨 어떻게 켜요?",
  "How do I turn on the hot water?":"온수 어떻게 틀어요?",
  "How do I turn up the volume?":"소리 어떻게 키워요?",
  "How do I use the safe?":"금고 어떻게 써요?",
  "How do I use the shower?":"샤워기 어떻게 써요?",
  "How do I use the washing machine?":"세탁기 어떻게 써요?",
  "How do I use this app?":"이 앱 어떻게 써요?",
  "How do I use this machine?":"이 기계 어떻게 써요?",
  "How do I use this snorkel?":"이 스노클 어떻게 써요?",
  "How long does it take by boat?":"배로 얼마나 걸려요?",
  "How long does it take by bus?":"버스로 얼마나 걸려요?",
  "How long does it take by car?":"차로 얼마나 걸려요?",
  "How long does it take by taxi?":"택시로 얼마나 걸려요?",
  "How long does it take by train?":"기차로 얼마나 걸려요?",
  "How long does it take for laundry?":"세탁하는 데 얼마나 걸려요?",
  "How long does it take in total?":"전부 다 해서 얼마나 걸려요?",
  "How long does it take on foot?":"걸어서 얼마나 걸려요?",
  "How long does it take one way?":"편도로 얼마나 걸려요?",
  "How long does it take to charge?":"충전하는 데 얼마나 걸려요?",
  "How long does it take to check in?":"체크인하는 데 얼마나 걸려요?",
  "How long does it take to clean the room?":"방 청소하는 데 얼마나 걸려요?",
  "How long does it take to cook?":"조리하는 데 얼마나 걸려요?",
  "How long does it take to dry?":"마르는 데 얼마나 걸려요?",
  "How long does it take to fix it?":"고치는 데 얼마나 걸려요?",
  "How long does it take to get a refund?":"환불받는 데 얼마나 걸려요?",
  "How long does it take to get a table?":"자리 나는 데 얼마나 걸려요?",
  "How long does it take to get my bags?":"제 짐 나오는 데 얼마나 걸려요?",
  "How long does it take to get ready?":"준비하는 데 얼마나 걸려요?",
  "How long does it take to get there?":"거기까지 얼마나 걸려요?",
  "How long does it take to get through security?":"보안 검색 통과하는 데 얼마나 걸려요?",
  "How long does it take to get to the airport?":"공항까지 얼마나 걸려요?",
  "How long does it take to get to the hotel?":"호텔까지 얼마나 걸려요?",
  "How long does it take to get to the island?":"그 섬까지 얼마나 걸려요?",
  "How long does it take to walk there?":"거기까지 걸어서 얼마나 걸려요?",
  "How long does it take to walk to the station?":"역까지 걸어서 얼마나 걸려요?",
  "How long does it take to wrap it?":"포장하는 데 얼마나 걸려요?",
  "How long does it take?":"얼마나 걸려요?",
  "How much are these shoes?":"이 신발 얼마예요?",
  "How much are these?":"이거 얼마예요?",
  "How much in ringgit?":"링깃으로 얼마예요?",
  "How much is a boat ticket?":"배표 얼마예요?",
  "How much is a coffee?":"커피 한 잔 얼마예요?",
  "How much is a taxi to the airport?":"공항까지 택시 얼마예요?",
  "How much is an umbrella?":"우산 얼마예요?",
  "How much is breakfast?":"조식 얼마예요?",
  "How much is delivery?":"배달 얼마예요?",
  "How much is it for a child?":"아이는 얼마예요?",
  "How much is it for two nights?":"2박에 얼마예요?",
  "How much is it per night?":"1박에 얼마예요?",
  "How much is it per person?":"1인당 얼마예요?",
  "How much is it to the airport?":"공항까지 얼마예요?",
  "How much is it with the discount?":"할인하면 얼마예요?",
  "How much is it?":"얼마예요?",
  "How much is one more night?":"하루 더 묵으면 얼마예요?",
  "How much is one?":"하나에 얼마예요?",
  "How much is parking?":"주차비 얼마예요?",
  "How much is the airport pickup?":"공항 픽업 얼마예요?",
  "How much is the deposit?":"보증금 얼마예요?",
  "How much is the entrance fee?":"입장료 얼마예요?",
  "How much is the ferry ticket?":"배표 얼마예요?",
  "How much is the laundry?":"세탁 얼마예요?",
  "How much is the room per night?":"방 1박에 얼마예요?",
  "How much is the set menu?":"세트 메뉴 얼마예요?",
  "How much is the smallest one?":"제일 작은 거 얼마예요?",
  "How much is the snorkeling gear rental?":"스노클 장비 대여 얼마예요?",
  "How much is the taxi?":"택시 얼마예요?",
  "How much is the total?":"전부 얼마예요?",
  "How much is this per kilo?":"이거 1킬로에 얼마예요?",
  "How much is this shirt?":"이 셔츠 얼마예요?",
  "How much is this tour?":"이 투어 얼마예요?",
  "How much is this?":"이거 얼마예요?",
  "How much longer do I have to wait for my bags?":"제 짐 나오려면 얼마나 더 기다려야 해요?",
  "How much longer do we have to wait for a table?":"자리 나려면 얼마나 더 기다려야 해요?",
  "How much longer do we have to wait for the pickup?":"픽업 오려면 얼마나 더 기다려야 해요?",
  "How much longer do we have to wait?":"얼마나 더 기다려야 해요?",
  "How much longer until boarding starts?":"탑승 시작까지 얼마나 더 남았어요?",
  "How much longer until dinner?":"저녁까지 얼마나 더 남았어요?",
  "How much longer until we get there?":"도착하려면 얼마나 더 남았어요?",
  "How much longer will check-in take?":"체크인 얼마나 더 걸려요?",
  "How much longer will it take?":"얼마나 더 걸려요?",
  "How much longer will the rain last?":"비 얼마나 더 와요?",
  "I can't find my booking email.":"예약 메일을 못 찾겠어요.",
  "I can't find my charger.":"충전기를 못 찾겠어요.",
  "I can't find my driver.":"기사님을 못 찾겠어요.",
  "I can't find my family.":"가족을 못 찾겠어요.",
  "I can't find my gate.":"탑승구를 못 찾겠어요.",
  "I can't find my glasses.":"안경을 못 찾겠어요.",
  "I can't find my luggage.":"제 짐을 못 찾겠어요.",
  "I can't find my passport.":"여권을 못 찾겠어요.",
  "I can't find my phone.":"휴대폰을 못 찾겠어요.",
  "I can't find my receipt.":"영수증을 못 찾겠어요.",
  "I can't find my room key.":"방 열쇠를 못 찾겠어요.",
  "I can't find my seat.":"제 자리를 못 찾겠어요.",
  "I can't find my shopping bag.":"쇼핑백을 못 찾겠어요.",
  "I can't find my size.":"제 사이즈를 못 찾겠어요.",
  "I can't find my son.":"아들을 못 찾겠어요.",
  "I can't find my ticket.":"표를 못 찾겠어요.",
  "I can't find my umbrella.":"우산을 못 찾겠어요.",
  "I can't find my wallet.":"지갑을 못 찾겠어요.",
  "I can't find the bus stop.":"버스 정류장을 못 찾겠어요.",
  "I can't find the elevator.":"엘리베이터를 못 찾겠어요.",
  "I can't find the exit.":"출구를 못 찾겠어요.",
  "I can't find the hotel.":"호텔을 못 찾겠어요.",
  "I can't find the light switch.":"전등 스위치를 못 찾겠어요.",
  "I can't find the meeting point.":"집합 장소를 못 찾겠어요.",
  "I can't find the menu.":"메뉴판을 못 찾겠어요.",
  "I can't find the price tag.":"가격표를 못 찾겠어요.",
  "I can't find the restroom.":"화장실을 못 찾겠어요.",
  "I have a reservation at seven.":"7시로 예약했어요.",
  "I have a reservation for a car.":"차 예약했어요.",
  "I have a reservation for a family room.":"가족실로 예약했어요.",
  "I have a reservation for a table by the window.":"창가 자리로 예약했어요.",
  "I have a reservation for an airport pickup.":"공항 픽업 예약했어요.",
  "I have a reservation for dinner at eight.":"저녁 8시로 예약했어요.",
  "I have a reservation for dinner.":"저녁 예약했어요.",
  "I have a reservation for lunch.":"점심 예약했어요.",
  "I have a reservation for six people.":"여섯 명으로 예약했어요.",
  "I have a reservation for the airport pickup.":"공항 픽업 예약했어요.",
  "I have a reservation for the boat.":"배 예약했어요.",
  "I have a reservation for the buffet.":"뷔페 예약했어요.",
  "I have a reservation for the island tour today.":"오늘 섬 투어 예약했어요.",
  "I have a reservation for the show.":"공연 예약했어요.",
  "I have a reservation for three nights.":"3박으로 예약했어요.",
  "I have a reservation for tomorrow.":"내일로 예약했어요.",
  "I have a reservation for tonight.":"오늘 밤으로 예약했어요.",
  "I have a reservation for two.":"두 명으로 예약했어요.",
  "I have a reservation under Kim.":"김으로 예약했어요.",
  "I have a reservation under my name.":"제 이름으로 예약했어요.",
  "I have a reservation under my wife's name.":"아내 이름으로 예약했어요.",
  "I have a reservation.":"예약했어요.",
  "I think I left my bag at the cafe.":"카페에 가방을 두고 온 것 같아요.",
  "I think I left my bag at the table.":"자리에 가방을 두고 온 것 같아요.",
  "I think I left my bag in the room.":"방에 가방을 두고 온 것 같아요.",
  "I think I left my bag on the boat.":"배에 가방을 두고 내린 것 같아요.",
  "I think I left my camera on the bus.":"버스에 카메라를 두고 내린 것 같아요.",
  "I think I left my card at the shop.":"가게에 카드를 두고 온 것 같아요.",
  "I think I left my card in the machine.":"기계에 카드를 두고 온 것 같아요.",
  "I think I left my charger in the room.":"방에 충전기를 두고 온 것 같아요.",
  "I think I left my glasses in the fitting room.":"탈의실에 안경을 두고 온 것 같아요.",
  "I think I left my hat on the beach.":"해변에 모자를 두고 온 것 같아요.",
  "I think I left my jacket in the room.":"방에 겉옷을 두고 온 것 같아요.",
  "I think I left my passport at the front desk.":"프런트에 여권을 두고 온 것 같아요.",
  "I think I left my passport in the room.":"방에 여권을 두고 온 것 같아요.",
  "I think I left my phone at the food court.":"푸드코트에 휴대폰을 두고 온 것 같아요.",
  "I think I left my phone at the restaurant.":"식당에 휴대폰을 두고 온 것 같아요.",
  "I think I left my phone in the car.":"차에 휴대폰을 두고 내린 것 같아요.",
  "I think I left my phone in the taxi.":"택시에 휴대폰을 두고 내린 것 같아요.",
  "I think I left my shoes at the temple.":"사원에 신발을 두고 온 것 같아요.",
  "I think I left my sunglasses at the cafe.":"카페에 선글라스를 두고 온 것 같아요.",
  "I think I left my sunglasses by the pool.":"수영장에 선글라스를 두고 온 것 같아요.",
  "I think I left my ticket at the counter.":"카운터에 표를 두고 온 것 같아요.",
  "I think I left my umbrella at the restaurant.":"식당에 우산을 두고 온 것 같아요.",
  "I think I left my umbrella on the train.":"기차에 우산을 두고 내린 것 같아요.",
  "I think I left my wallet at security.":"보안 검색대에 지갑을 두고 온 것 같아요.",
  "I think I left my wallet at the restaurant.":"식당에 지갑을 두고 온 것 같아요.",
  "I think I left my water bottle on the tour bus.":"투어 버스에 물병을 두고 내린 것 같아요.",
  "I think I left the light on.":"불을 켜두고 온 것 같아요.",
  "I'd like to ask a question.":"질문 하나 하려고요.",
  "I'd like to book a boat to Mengalum for tomorrow.":"내일 멩갈룸 가는 배 예약하려고요.",
  "I'd like to book a snorkeling tour for tomorrow.":"내일 스노클링 투어 예약하려고요.",
  "I'd like to book a taxi to the airport.":"공항 가는 택시 예약하려고요.",
  "I'd like to book an island tour for tomorrow.":"내일 섬 투어 예약하려고요.",
  "I'd like to cancel my reservation.":"예약 취소하려고요.",
  "I'd like to change the pickup time.":"픽업 시간 바꾸려고요.",
  "I'd like to check in.":"체크인하려고요.",
  "I'd like to check out later.":"체크아웃 늦게 하려고요.",
  "I'd like to confirm my booking.":"예약 확인하려고요.",
  "I'd like to extend my stay.":"숙박 연장하려고요.",
  "I'd like to make an appointment.":"예약 잡으려고요.",
  "I'd like to order two coffees.":"커피 두 잔 주문할게요.",
  "I'd like to pay in cash.":"현금으로 낼게요.",
  "I'd like to rent a car for a day.":"하루 차 빌리려고요.",
  "I'd like to rent snorkeling gear.":"스노클 장비 빌리려고요.",
  "I'd like to reserve a table for tonight.":"오늘 저녁 자리 예약하려고요.",
  "I'd like to return this.":"이거 반품하려고요.",
  "I'd like to see the room first.":"방 먼저 보고 싶어요.",
  "I'd like to speak to the manager.":"매니저와 얘기하고 싶어요.",
  "I'd like to try this on.":"이거 입어보려고요.",
  "I'll take it.":"이걸로 할게요.",
  "I'll take this one.":"이걸로 주세요.",
  "I'll take this.":"이걸로 할게요.",
  "I'll take two.":"두 개 주세요.",
  "I'm so sorry.":"정말 죄송합니다.",
  "I'm sorry.":"죄송합니다.",
  "Is a guide included?":"가이드 포함이에요?",
  "Is breakfast included?":"조식 포함이에요?",
  "Is cleaning included?":"청소 포함이에요?",
  "Is coffee included?":"커피 포함이에요?",
  "Is delivery included?":"배송 포함이에요?",
  "Is hotel pickup included?":"호텔 픽업 포함이에요?",
  "Is insurance included?":"보험 포함이에요?",
  "Is lunch included?":"점심 포함이에요?",
  "Is parking included?":"주차 포함이에요?",
  "Is pickup included?":"픽업 포함이에요?",
  "Is rice included?":"밥 포함이에요?",
  "Is snorkeling gear included?":"스노클 장비 포함이에요?",
  "Is tax included?":"세금 포함이에요?",
  "Is the boat ride included?":"배 타는 것도 포함이에요?",
  "Is the boat still going today?":"오늘 배 아직 다녀요?",
  "Is the dessert included?":"디저트 포함이에요?",
  "Is the drink included?":"음료 포함이에요?",
  "Is the entrance fee included?":"입장료 포함이에요?",
  "Is the service charge included?":"봉사료 포함이에요?",
  "Is the tip included?":"팁 포함이에요?",
  "Is there a bus to the station?":"역 가는 버스 있어요?",
  "Is there a cheaper way?":"더 싼 방법 있어요?",
  "Is there a clinic nearby?":"근처에 병원 있어요?",
  "Is there a discount for kids?":"아이 할인 있어요?",
  "Is there a dress code?":"복장 규정 있어요?",
  "Is there a ferry this afternoon?":"오늘 오후에 배 있어요?",
  "Is there a hotel pickup service?":"호텔 픽업 서비스 있어요?",
  "Is there a kids' area in the pool?":"수영장에 아이들 구역 있어요?",
  "Is there a laundromat nearby?":"근처에 빨래방 있어요?",
  "Is there a minimum charge?":"최소 금액 있어요?",
  "Is there a pharmacy nearby?":"근처에 약국 있어요?",
  "Is there a place to leave our bags?":"짐 맡길 데 있어요?",
  "Is there a problem?":"무슨 문제 있어요?",
  "Is there a restroom near here?":"이 근처에 화장실 있어요?",
  "Is there a seat for one?":"한 명 자리 있어요?",
  "Is there a shuttle to the airport?":"공항 가는 셔틀 있어요?",
  "Is there a store nearby?":"근처에 가게 있어요?",
  "Is there an ATM nearby?":"근처에 현금인출기 있어요?",
  "Is there an extra charge for late checkout?":"늦게 체크아웃하면 추가 요금 있어요?",
  "Is there an extra charge for snorkeling gear?":"스노클 장비는 추가 요금 있어요?",
  "Is there parking here?":"여기 주차장 있어요?",
  "Is there wifi in the room?":"방에 와이파이 있어요?",
  "Is this the right address?":"이 주소 맞아요?",
  "Is this the right amount?":"금액 이거 맞아요?",
  "Is this the right boat to Mengalum?":"멩갈룸 가는 배 이거 맞아요?",
  "Is this the right boat?":"이 배 맞아요?",
  "Is this the right building?":"이 건물 맞아요?",
  "Is this the right bus to the airport?":"공항 가는 버스 이거 맞아요?",
  "Is this the right bus?":"이 버스 맞아요?",
  "Is this the right change?":"거스름돈 이거 맞아요?",
  "Is this the right color?":"이 색 맞아요?",
  "Is this the right counter?":"이 창구 맞아요?",
  "Is this the right entrance?":"이 입구 맞아요?",
  "Is this the right floor?":"이 층 맞아요?",
  "Is this the right form?":"이 서류 맞아요?",
  "Is this the right gate for my flight?":"제 비행기 탑승구 이거 맞아요?",
  "Is this the right gate?":"이 탑승구 맞아요?",
  "Is this the right key?":"이 열쇠 맞아요?",
  "Is this the right line for check-in?":"체크인 줄 이거 맞아요?",
  "Is this the right line?":"이 줄 맞아요?",
  "Is this the right number?":"이 번호 맞아요?",
  "Is this the right pier for Gaya Island?":"가야섬 가는 선착장 이거 맞아요?",
  "Is this the right pier?":"이 선착장 맞아요?",
  "Is this the right price?":"가격 이거 맞아요?",
  "Is this the right room?":"이 방 맞아요?",
  "Is this the right seat?":"이 자리 맞아요?",
  "Is this the right shop?":"이 가게 맞아요?",
  "Is this the right size?":"이 사이즈 맞아요?",
  "Is this the right stop?":"여기서 내리는 거 맞아요?",
  "Is this the right table?":"이 테이블 맞아요?",
  "Is this the right train?":"이 기차 맞아요?",
  "Is this the right way?":"이 길 맞아요?",
  "Is water included?":"물 포함이에요?",
  "It was delicious.":"맛있었어요.",
  "It's delicious.":"맛있어요.",
  "It's really good.":"정말 맛있어요.",
  "Just looking, thank you.":"그냥 구경하는 거예요, 감사합니다.",
  "Just looking, thanks.":"그냥 구경하는 거예요, 고마워요.",
  "No ice, please.":"얼음 빼주세요.",
  "Not too spicy, please.":"너무 맵지 않게 해주세요.",
  "Sorry I'm late.":"늦어서 죄송합니다.",
  "Sorry.":"죄송합니다.",
  "Takeaway, please.":"포장해 주세요.",
  "Thank you so much.":"정말 감사합니다.",
  "Thank you.":"감사합니다.",
  "Thanks.":"고마워요.",
  "That's a bit expensive.":"좀 비싸네요.",
  "That's too expensive.":"너무 비싸요.",
  "There's a problem with my card.":"제 카드에 문제가 있어요.",
  "There's a problem with my key card.":"제 카드키에 문제가 있어요.",
  "There's a problem with my key.":"제 열쇠에 문제가 있어요.",
  "There's a problem with my order.":"제 주문에 문제가 있어요.",
  "There's a problem with my payment.":"제 결제에 문제가 있어요.",
  "There's a problem with my phone.":"제 휴대폰에 문제가 있어요.",
  "There's a problem with my reservation.":"제 예약에 문제가 있어요.",
  "There's a problem with the TV.":"텔레비전에 문제가 있어요.",
  "There's a problem with the air conditioner.":"에어컨에 문제가 있어요.",
  "There's a problem with the app.":"앱에 문제가 있어요.",
  "There's a problem with the bill.":"계산서에 문제가 있어요.",
  "There's a problem with the change.":"거스름돈이 잘못됐어요.",
  "There's a problem with the delivery.":"배송에 문제가 있어요.",
  "There's a problem with the door.":"문에 문제가 있어요.",
  "There's a problem with the food.":"음식에 문제가 있어요.",
  "There's a problem with the hot water.":"온수에 문제가 있어요.",
  "There's a problem with the light.":"조명에 문제가 있어요.",
  "There's a problem with the pickup.":"픽업에 문제가 있어요.",
  "There's a problem with the receipt.":"영수증에 문제가 있어요.",
  "There's a problem with the seat.":"좌석에 문제가 있어요.",
  "There's a problem with the shower.":"샤워기에 문제가 있어요.",
  "There's a problem with the toilet.":"변기에 문제가 있어요.",
  "There's a problem with the wifi.":"와이파이에 문제가 있어요.",
  "There's a problem with the window.":"창문에 문제가 있어요.",
  "There's a problem with this shirt.":"이 셔츠에 문제가 있어요.",
  "Two adults and two kids.":"어른 둘, 아이 둘이요.",
  "We have a reservation for four.":"네 명으로 예약했어요.",
  "We have a reservation for the island tour.":"섬 투어 예약했어요.",
  "We have a reservation for the massage.":"마사지 예약했어요.",
  "We have a reservation for tomorrow night.":"내일 밤으로 예약했어요.",
  "What do you recommend around here?":"이 근처에 뭐가 괜찮아요?",
  "What do you recommend for a day trip?":"당일치기로는 어디가 괜찮아요?",
  "What do you recommend for a family?":"가족끼리 오면 뭐가 괜찮아요?",
  "What do you recommend for a first visit?":"처음 왔으면 뭐가 괜찮아요?",
  "What do you recommend for a gift?":"선물로는 뭐가 괜찮아요?",
  "What do you recommend for a half day?":"반나절이면 뭐가 괜찮아요?",
  "What do you recommend for a rainy day?":"비 오는 날엔 뭐가 괜찮아요?",
  "What do you recommend for breakfast?":"아침으로는 뭐가 괜찮아요?",
  "What do you recommend for dessert?":"디저트는 뭐가 괜찮아요?",
  "What do you recommend for dinner?":"저녁으로는 뭐가 괜찮아요?",
  "What do you recommend for kids?":"아이들한테는 뭐가 괜찮아요?",
  "What do you recommend for lunch?":"점심으로는 뭐가 괜찮아요?",
  "What do you recommend for seafood?":"해산물은 어디가 괜찮아요?",
  "What do you recommend for snorkeling?":"스노클링은 어디가 괜찮아요?",
  "What do you recommend for souvenirs?":"기념품으로는 뭐가 괜찮아요?",
  "What do you recommend for sunset?":"일몰은 어디가 괜찮아요?",
  "What do you recommend for tomorrow?":"내일은 뭐가 괜찮아요?",
  "What do you recommend for two people?":"둘이면 뭐가 괜찮아요?",
  "What do you recommend on a budget?":"돈 아끼려면 뭐가 괜찮아요?",
  "What do you recommend on the menu?":"메뉴 중에 뭐가 괜찮아요?",
  "What do you recommend that's local?":"현지 음식으론 뭐가 괜찮아요?",
  "What do you recommend that's not spicy?":"안 매운 걸로 뭐가 괜찮아요?",
  "What do you recommend to drink?":"마실 건 뭐가 괜찮아요?",
  "What do you recommend?":"뭐가 괜찮아요?",
  "What does \"cash only\" mean?":"'현금만 가능'이 무슨 뜻이에요?",
  "What does \"closed for today\" mean?":"'금일 영업 종료'가 무슨 뜻이에요?",
  "What does \"complimentary\" mean?":"'무료 제공'이 무슨 뜻이에요?",
  "What does \"deposit\" mean?":"'보증금'이 무슨 뜻이에요?",
  "What does \"free cancellation\" mean?":"'무료 취소'가 무슨 뜻이에요?",
  "What does \"free of charge\" mean?":"'무료'가 무슨 뜻이에요?",
  "What does \"free refill\" mean?":"'무료 리필'이 무슨 뜻이에요?",
  "What does \"fully booked\" mean?":"'예약 마감'이 무슨 뜻이에요?",
  "What does \"in stock\" mean?":"'재고 있음'이 무슨 뜻이에요?",
  "What does \"last call\" mean?":"'주문 마감'이 무슨 뜻이에요?",
  "What does \"meeting point\" mean?":"'집합 장소'가 무슨 뜻이에요?",
  "What does \"minimum spend\" mean?":"'최소 주문 금액'이 무슨 뜻이에요?",
  "What does \"no entry\" mean?":"'출입 금지'가 무슨 뜻이에요?",
  "What does \"no vacancy\" mean?":"'빈방 없음'이 무슨 뜻이에요?",
  "What does \"non-refundable\" mean?":"'환불 불가'가 무슨 뜻이에요?",
  "What does \"on sale\" mean?":"'할인 중'이 무슨 뜻이에요?",
  "What does \"one way\" mean?":"'편도'가 무슨 뜻이에요?",
  "What does \"out of order\" mean?":"'고장'이 무슨 뜻이에요?",
  "What does \"reserved\" mean?":"'예약석'이 무슨 뜻이에요?",
  "What does \"round trip\" mean?":"'왕복'이 무슨 뜻이에요?",
  "What does \"self service\" mean?":"'셀프 서비스'가 무슨 뜻이에요?",
  "What does \"service charge\" mean?":"'봉사료'가 무슨 뜻이에요?",
  "What does \"shared transfer\" mean?":"'합승 이동'이 무슨 뜻이에요?",
  "What does \"sold out\" mean?":"'품절'이 무슨 뜻이에요?",
  "What does \"take out\" mean?":"'포장'이 무슨 뜻이에요?",
  "What does last call mean?":"'주문 마감'이 무슨 뜻이에요?",
  "What does minimum spend mean?":"'최소 주문 금액'이 무슨 뜻이에요?",
  "What does non-refundable mean?":"'환불 불가'가 무슨 뜻이에요?",
  "What does service charge mean?":"'봉사료'가 무슨 뜻이에요?",
  "What does shared transfer mean?":"'합승 이동'이 무슨 뜻이에요?",
  "What should I do about my flight?":"제 비행기는 어떻게 해야 해요?",
  "What should I do about my ticket?":"제 표는 어떻게 해야 해요?",
  "What should I do about the extra charge?":"추가 요금은 어떻게 해야 해요?",
  "What should I do first?":"먼저 뭘 해야 해요?",
  "What should I do if I miss the boat?":"배를 놓치면 어떻게 해야 해요?",
  "What should I do if I'm late?":"늦으면 어떻게 해야 해요?",
  "What should I do if it breaks?":"고장 나면 어떻게 해야 해요?",
  "What should I do if it doesn't fit?":"안 맞으면 어떻게 해야 해요?",
  "What should I do if it rains?":"비 오면 어떻게 해야 해요?",
  "What should I do if my card doesn't work?":"카드가 안 되면 어떻게 해야 해요?",
  "What should I do if my luggage doesn't arrive?":"제 짐이 안 나오면 어떻게 해야 해요?",
  "What should I do next?":"다음엔 뭘 해야 해요?",
  "What should I do then?":"그럼 어떻게 해야 해요?",
  "What should I do to get a refund?":"환불받으려면 어떻게 해야 해요?",
  "What should I do with the key?":"열쇠는 어떻게 해야 해요?",
  "What should I do with the tray?":"쟁반은 어떻게 해야 해요?",
  "What should I do with this form?":"이 서류는 어떻게 해야 해요?",
  "What should I do?":"어떻게 해야 해요?",
  "What should we do about dinner?":"저녁은 어떻게 할까요?",
  "What should we do about the noise?":"소음은 어떻게 해야 해요?",
  "What should we do about the schedule?":"일정은 어떻게 해야 해요?",
  "What should we do about the wait?":"기다리는 건 어떻게 해야 해요?",
  "What should we do if it rains?":"비 오면 어떻게 해야 해요?",
  "What should we do if the boat is canceled?":"배가 취소되면 어떻게 해야 해요?",
  "What should we do if the tour is canceled?":"투어가 취소되면 어떻게 해야 해요?",
  "What should we do now?":"이제 어떻게 해야 해요?",
  "What should we do while we wait?":"기다리는 동안 뭘 하면 돼요?",
  "What should we do with our luggage?":"짐은 어떻게 해야 해요?",
  "What should we do with the leftovers?":"남은 음식은 어떻게 해야 해요?",
  "What time do we need to arrive?":"몇 시까지 도착해야 해요?",
  "What time do we need to be at the airport?":"몇 시까지 공항에 가 있어야 해요?",
  "What time do we need to be at the meeting point?":"몇 시까지 집합 장소에 가 있어야 해요?",
  "What time do we need to be at the pier?":"몇 시까지 선착장에 가 있어야 해요?",
  "What time do we need to be back on the boat?":"몇 시까지 배로 돌아와야 해요?",
  "What time do we need to be in the lobby?":"몇 시까지 로비에 가 있어야 해요?",
  "What time do we need to be ready?":"몇 시까지 준비돼 있어야 해요?",
  "What time do we need to be seated?":"몇 시까지 자리에 앉아 있어야 해요?",
  "What time do we need to be there?":"몇 시까지 거기 가 있어야 해요?",
  "What time do we need to check in for the flight?":"비행기 체크인 몇 시까지 해야 해요?",
  "What time do we need to check out?":"몇 시까지 체크아웃해야 해요?",
  "What time do we need to come back?":"몇 시까지 돌아와야 해요?",
  "What time do we need to finish shopping?":"몇 시까지 쇼핑을 끝내야 해요?",
  "What time do we need to finish?":"몇 시까지 끝내야 해요?",
  "What time do we need to get on the boat?":"몇 시까지 배에 타야 해요?",
  "What time do we need to get up?":"몇 시에 일어나야 해요?",
  "What time do we need to leave the hotel?":"몇 시에 호텔에서 나가야 해요?",
  "What time do we need to leave the room?":"몇 시까지 방을 비워야 해요?",
  "What time do we need to leave?":"몇 시에 출발해야 해요?",
  "What time do we need to meet the guide?":"몇 시에 가이드를 만나야 해요?",
  "What time do we need to meet?":"몇 시에 만나야 해요?",
  "What time do we need to order?":"몇 시까지 주문해야 해요?",
  "What time do we need to pick it up?":"몇 시에 찾으러 와야 해요?",
  "What time do we need to return the car?":"몇 시까지 차를 반납해야 해요?",
  "What time do we need to return the towels?":"몇 시까지 수건을 반납해야 해요?",
  "What time do we need to start?":"몇 시에 시작해야 해요?",
  "What time does breakfast start?":"조식 몇 시부터예요?",
  "What time does check-in start?":"체크인 몇 시부터예요?",
  "What time does snorkeling start?":"스노클링 몇 시에 시작해요?",
  "What time does the bank open?":"은행 몇 시에 열어요?",
  "What time does the boat leave?":"배 몇 시에 떠나요?",
  "What time does the buffet open?":"뷔페 몇 시에 열어요?",
  "What time does the kitchen close?":"주방 몇 시에 닫아요?",
  "What time does the last bus leave?":"버스 막차 몇 시에 떠나요?",
  "What time does the last ferry leave?":"막배 몇 시에 떠나요?",
  "What time does the last train leave?":"기차 막차 몇 시에 떠나요?",
  "What time does the mall open?":"쇼핑몰 몇 시에 열어요?",
  "What time does the market close?":"시장 몇 시에 닫아요?",
  "What time does the movie start?":"영화 몇 시에 시작해요?",
  "What time does the museum close?":"박물관 몇 시에 닫아요?",
  "What time does the next boat leave?":"다음 배 몇 시에 떠나요?",
  "What time does the park close?":"공원 몇 시에 닫아요?",
  "What time does the pool close?":"수영장 몇 시에 닫아요?",
  "What time does the restaurant open?":"식당 몇 시에 열어요?",
  "What time does the sale start?":"세일 몇 시에 시작해요?",
  "What time does the shop open?":"가게 몇 시에 열어요?",
  "What time does the show start?":"공연 몇 시에 시작해요?",
  "What time does the shuttle leave?":"셔틀 몇 시에 떠나요?",
  "What time does the store close today?":"오늘 가게 몇 시에 닫아요?",
  "What time does the tour end?":"투어 몇 시에 끝나요?",
  "What time does the tour start?":"투어 몇 시에 시작해요?",
  "What time does the train leave?":"기차 몇 시에 떠나요?",
  "What's the difference between a one-way ticket and a round-trip ticket?":"편도표랑 왕복표가 뭐가 달라요?",
  "What's the difference between a standard room and a sea-view room?":"일반실이랑 오션뷰 객실이 뭐가 달라요?",
  "What's the difference between a twin room and a double room?":"트윈룸이랑 더블룸이 뭐가 달라요?",
  "What's the difference between hot and iced?":"따뜻한 거랑 차가운 게 뭐가 달라요?",
  "What's the difference between shared and private transfer?":"합승 이동이랑 단독 이동이 뭐가 달라요?",
  "What's the difference between snorkeling and diving?":"스노클링이랑 다이빙이 뭐가 달라요?",
  "What's the difference between the big size and the small size?":"큰 사이즈랑 작은 사이즈가 뭐가 달라요?",
  "What's the difference between the ferry and the speedboat?":"여객선이랑 스피드보트가 뭐가 달라요?",
  "What's the difference between the half-day and full-day tours?":"반나절 투어랑 종일 투어가 뭐가 달라요?",
  "What's the difference between the morning and afternoon tours?":"오전 투어랑 오후 투어가 뭐가 달라요?",
  "What's the difference between the old one and the new one?":"구형이랑 신형이 뭐가 달라요?",
  "What's the difference between the standard and premium packages?":"스탠다드랑 프리미엄 패키지가 뭐가 달라요?",
  "What's the difference between the standard and premium rooms?":"일반실이랑 프리미엄 객실이 뭐가 달라요?",
  "What's the difference between these two colors?":"이 두 색이 뭐가 달라요?",
  "What's the difference between these two dishes?":"이 음식 두 개가 뭐가 달라요?",
  "What's the difference between these two options?":"이 두 가지가 뭐가 달라요?",
  "What's the difference between these two prices?":"이 두 가격이 뭐가 달라요?",
  "What's the difference between these two room rates?":"이 두 방값이 뭐가 달라요?",
  "What's the difference between these two seats?":"이 자리 두 개가 뭐가 달라요?",
  "What's the difference between these two sizes?":"이 두 사이즈가 뭐가 달라요?",
  "What's the difference between these two tickets?":"이 표 두 개가 뭐가 달라요?",
  "What's the difference between these two tours?":"이 투어 두 개가 뭐가 달라요?",
  "Where are the lockers?":"물품 보관함이 어디예요?",
  "Where are the stairs?":"계단이 어디예요?",
  "Where do we meet after lunch?":"점심 먹고 어디서 만나요?",
  "Where do we meet after shopping?":"쇼핑 끝나고 어디서 만나요?",
  "Where do we meet after snorkeling?":"스노클링 끝나고 어디서 만나요?",
  "Where do we meet after the tour?":"투어 끝나고 어디서 만나요?",
  "Where do we meet at the airport?":"공항 어디서 만나요?",
  "Where do we meet at the mall?":"쇼핑몰 어디서 만나요?",
  "Where do we meet at the station?":"역 어디서 만나요?",
  "Where do we meet for coffee?":"커피 마시러 어디서 만나요?",
  "Where do we meet for dinner?":"저녁 먹으러 어디서 만나요?",
  "Where do we meet for lunch?":"점심 먹으러 어디서 만나요?",
  "Where do we meet for the boat trip?":"배 타는 건 어디서 만나요?",
  "Where do we meet for the tour?":"투어는 어디서 만나요?",
  "Where do we meet if we get separated?":"떨어지면 어디서 만나요?",
  "Where do we meet in the hotel?":"호텔 어디서 만나요?",
  "Where do we meet later?":"이따가 어디서 만나요?",
  "Where do we meet the boat?":"배는 어디서 타요?",
  "Where do we meet the driver?":"기사님은 어디서 만나요?",
  "Where do we meet the group?":"일행은 어디서 만나요?",
  "Where do we meet the guide?":"가이드는 어디서 만나요?",
  "Where do we meet the taxi?":"택시는 어디서 타요?",
  "Where do we meet tomorrow morning?":"내일 아침에 어디서 만나요?",
  "Where do we meet?":"어디서 만나요?",
  "Where is baggage claim?":"수하물 찾는 곳이 어디예요?",
  "Where is my bag?":"제 가방이 어디 있어요?",
  "Where is my seat?":"제 자리가 어디예요?",
  "Where is our gate?":"저희 탑승구가 어디예요?",
  "Where is the ATM?":"현금인출기가 어디예요?",
  "Where is the breakfast room?":"조식 먹는 곳이 어디예요?",
  "Where is the bus stop?":"버스 정류장이 어디예요?",
  "Where is the cashier?":"계산대가 어디예요?",
  "Where is the check-in counter?":"체크인 카운터가 어디예요?",
  "Where is the convenience store?":"편의점이 어디예요?",
  "Where is the duty free shop?":"면세점이 어디예요?",
  "Where is the elevator?":"엘리베이터가 어디예요?",
  "Where is the entrance?":"입구가 어디예요?",
  "Where is the exit?":"출구가 어디예요?",
  "Where is the fitting room?":"탈의실이 어디예요?",
  "Where is the food court?":"푸드코트가 어디예요?",
  "Where is the information desk?":"안내 데스크가 어디예요?",
  "Where is the money exchange?":"환전소가 어디예요?",
  "Where is the nearest ATM?":"제일 가까운 현금인출기가 어디예요?",
  "Where is the nearest station?":"제일 가까운 역이 어디예요?",
  "Where is the parking lot?":"주차장이 어디예요?",
  "Where is the pharmacy?":"약국이 어디예요?",
  "Where is the pickup area?":"픽업 장소가 어디예요?",
  "Where is the pickup point?":"픽업 장소가 어디예요?",
  "Where is the restroom?":"화장실이 어디예요?",
  "Where is the shuttle stop?":"셔틀 타는 곳이 어디예요?",
  "Where is the supermarket?":"마트가 어디예요?",
  "Where is the taxi stand?":"택시 타는 곳이 어디예요?",
  "Where is the trash can?":"쓰레기통이 어디예요?",
  "Where is the water fountain?":"정수기가 어디예요?",
  "Where's the toilet?":"화장실이 어디예요?",
  "How much longer do we have to wait for the room?":"방 나오려면 얼마나 더 기다려야 해요?",
  "How much longer do I have to wait for the driver?":"기사님 오시려면 얼마나 더 기다려야 해요?",
  "How much longer will the food take?":"음식 나오는 데 얼마나 더 걸려요?",
  "How much longer will the laundry take?":"세탁 되는 데 얼마나 더 걸려요?",
  "How much longer until the tour starts?":"투어 시작까지 얼마나 더 남았어요?",
  "How much longer will the tour last?":"투어가 앞으로 얼마나 더 이어져요?",
  "How much longer will the show last?":"공연이 앞으로 얼마나 더 해요?",
  "How much longer will the sale last?":"세일이 앞으로 얼마나 더 가요?",
  "How much longer will the traffic last?":"이 정체가 얼마나 더 갈까요?",
  "How much longer until boarding?":"탑승까지 얼마나 더 남았어요?",
  "How much longer until we can go in?":"들어갈 수 있을 때까지 얼마나 더 남았어요?",
  "How much longer until we leave?":"출발까지 얼마나 더 남았어요?"
};

function travelKrOf(en){
  if(!en) return "";
  const s=String(en).trim();
  return TRAVEL_KR[s] || TRAVEL_KR[s.replace(/\s+/g," ")] || "";
}

const TRAVEL_ALL_FRAMES=TRAVEL_FRAMES;

const TRAVEL_BY_ID=(function(){ const m={}; TRAVEL_ALL_FRAMES.forEach(f=>m[f.id]=f); return m; })();

function travelAll(){ try{ return hGet(TRAVEL_KEY,{})||{}; }catch(e){ return {}; } }

function travelSave(o){ try{ hSet(TRAVEL_KEY,o); }catch(e){} }

function travelStat(id){ const o=travelAll(); return o[id]||{seen:0, ok:0, miss:0, lastT:0, introduced:false}; }

function travelMarkIntroduced(id){
  const o=travelAll(); const st=o[id]||{seen:0, ok:0, miss:0, lastT:0};
  if(st.introduced) return; st.introduced=true; o[id]=st; travelSave(o);
}

function travelRecord(fid, ok){
  const o=travelAll(); const s=o[fid]||{seen:0, ok:0, miss:0, lastT:0};
  s.seen=(s.seen||0)+1; if(ok) s.ok=(s.ok||0)+1; else s.miss=(s.miss||0)+1;
  s.streak = ok ? ((s.streak||0)+1) : 0;   // 연속 성공 — 자동화 판단의 핵심
  s.lastT=Date.now(); o[fid]=s; travelSave(o);
}

function travelWeight(st){
  st=st||{};
  const ok=st.ok||0, miss=st.miss||0, streak=st.streak||0;
  if(miss>ok)      return 0.7;   // 맞힌 것보다 틀린 게 많다 — 더 자주
  if(streak>=5)    return 3.2;   // 완전히 붙었다 — 가끔만
  if(streak>=3)    return 2.2;   // 자동화됨
  if(streak>=2)    return 1.5;   // 익숙해지는 중
  return 1.0;                    // 기본
}

const TRAVEL_FREQ={ travel_how_do_i:2 };

function travelWeightFor(id, st){ return travelWeight(st)/(TRAVEL_FREQ[id]||1); }

function travelCost(st){ st=st||{}; return (st.cost==null) ? (st.shown||0) : st.cost; }

function travelSeedNew(o){
  const known=TRAVEL_FRAMES.filter(f=>o[f.id]&&travelCost(o[f.id])>0);
  if(!known.length) return false;                            // 아직 아무것도 안 돌린 사람은 그냥 0에서 시작
  const fresh=TRAVEL_FRAMES.filter(f=>!o[f.id]);
  if(!fresh.length) return false;
  const lo=Math.min.apply(null, known.map(f=>travelCost(o[f.id])));
  fresh.forEach(f=>{ o[f.id]={seen:0, ok:0, miss:0, lastT:0, shown:0, cost:lo}; });
  return true;
}

function travelPickFrames(n, pool){
  const FR=(pool&&pool.length)?pool:TRAVEL_FRAMES;   // 골라서 연습이면 그 표현들만
  const o=travelAll();
  /* 새로 추가된 프레임의 출발선을 먼저 맞추고 저장한다.
     기록이 만들어진 뒤에 심으면 늦어서 cost 0 으로 굳어버린다. */
  try{ if(travelSeedNew(o)) travelSave(o); }catch(e){}
  const out=[], bump={};
  let remain=FR.slice();                  // 이번 세션에 아직 안 쓴 프레임
  /* 고를 때: 비용이 낮은 것부터. 자동화된 프레임은 비용이 빨리 쌓여 뒤로 밀린다.
     난수(±0.45)는 비용이 비슷한 것들 사이에서만 순서를 흔든다 —
     차이가 분명하면 난수로 뒤집히지 않는다. */
  while(out.length<n){
    if(!remain.length) remain=FR.slice();   // 범위를 한 바퀴 다 썼다 — 그때만 다시 돈다
    const eff=f=>travelCost(o[f.id]) + (bump[f.id]||0)*travelWeightFor(f.id,o[f.id]) + Math.random()*0.45;
    let best=remain[0], bv=eff(best);
    remain.forEach(f=>{ const v=eff(f); if(v<bv){ bv=v; best=f; } });
    out.push(best); bump[best.id]=(bump[best.id]||0)+1;
    remain=remain.filter(x=>x.id!==best.id);
  }
  /* 내는 순서는 따로 섞는다 — 비용순으로 나오면 순서를 외워버린다 */
  for(let i=out.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; const t=out[i]; out[i]=out[j]; out[j]=t; }
  /* 지난 세션 마지막 문제와 첫 문제가 같은 프레임이면 자리를 바꾼다 —
     앱을 다시 켰을 때 방금 본 표현이 또 나오는 느낌을 없앤다 */
  try{
    const lastId=hGet(TRAVEL_KEY+":lastFrame","");
    if(lastId && out.length>1 && out[0].id===lastId){ const t=out[0]; out[0]=out[1]; out[1]=t; }
    if(out.length) hSet(TRAVEL_KEY+":lastFrame", out[out.length-1].id);
  }catch(e){}
  return out;
}

function travelMarkShown(ids){
  const o=travelAll();
  (ids||[]).forEach(id=>{
    const st=o[id]||{seen:0,ok:0,miss:0,lastT:0};
    st.shown=(st.shown||0)+1;
    st.cost=travelCost(st)+travelWeightFor(id,st);   // 잘하는 프레임일수록 비용이 크게 쌓인다
    o[id]=st;
  });
  travelSave(o);
}

function travelPickItem(f, o){
  const st=o[f.id]||(o[f.id]={seen:0,ok:0,miss:0,lastT:0});
  let used=Array.isArray(st.used)?st.used:[];
  let fresh=f.items.filter(x=>used.indexOf(x.ko)<0);
  if(!fresh.length){ used=[]; fresh=f.items.filter(x=>x.ko!==st.lastKo); if(!fresh.length) fresh=f.items.slice(); }
  const pick=fresh[Math.floor(Math.random()*fresh.length)];
  used.push(pick.ko); st.used=used; st.lastKo=pick.ko;
  return pick;
}

const TRAVEL_SKIP_WORDS=new Set(("a an the some my our your is are was to it its do does did i we you he she they this that "
  +"of in on at for and or with here there be been am not no me him her us them mine yours "
  +"if when while until than then so but as "
  /* 조동사·부정형은 '무엇에 대한 말인지'를 정하지 않는다 —
     "Does that mean I can't order?" 에서 order 를 다른 말로 바꿔도 cant 가 겹쳐 정답이 되던 문제 */
  +"can cant cannot could couldnt would wouldnt should shouldnt will wont must may might "
  +"dont doesnt didnt isnt arent wasnt werent havent hasnt hadnt "
  +"much very really quite bit these those one ones just too also good im "
  +"anything something anyone someone s t").split(" ").filter(Boolean));

const TRAVEL_FILLER_WORDS=new Set("please thanks thank sorry hello hi excuse okay ok yes yeah sir madam maam".split(" "));

const TRAVEL_LIGHT_VERBS=new Set(("get go come take have make give put keep let know see want need like "
  +"use help show tell say speak stop bring").split(" "));

const TRAVEL_SYN_GROUPS=[
  ["boat","ferry","ship","speedboat"],
  ["taxi","cab"],
  ["plane","flight","airplane"],
  ["car","vehicle"],
  ["jacket","jackets","coat","coats"],
  ["shoes","shoe","sneakers"],
  ["hat","cap"],
  ["bag","bags","luggage","baggage","suitcase","backpack"],
  ["wallet","purse"],
  ["restroom","toilet","bathroom","washroom","lavatory"],
  ["pier","jetty","dock","wharf"],
  ["desk","counter","reception"],
  ["store","shop","shops","stores"],
  ["elevator","lift"],
  ["stairs","staircase"],
  ["clinic","hospital"],
  ["laundry","laundromat"],
  ["pharmacy","drugstore"],
  ["supermarket","grocery","mart"],
  ["cafe","coffeeshop"],
  ["parking","lot","garage"],
  ["dish","dishes","food","meal","meals"],
  ["drink","drinks","beverage","beverages"],
  ["bill","check","tab"],
  ["cup","glass","mug"],
  ["napkins","napkin","tissue","tissues"],
  ["ice","iced"],
  ["refill","refills"],
  ["leftovers","rest"],
  ["towel","towels"],
  ["key","keys","keycard"],
  ["phone","cellphone","mobile","smartphone"],
  ["laptop","computer"],
  ["ticket","tickets"],
  ["money","cash"],
  ["paper","papers"],
  ["gift","present"],
  ["souvenir","souvenirs"],
  ["adapter","plug"],
  ["locker","lockers"],
  ["gear","equipment"],
  ["snorkel","snorkeling"],
  ["bike","bicycle"],
  ["message","note","memo"],
  ["reservation","booking","appointment"],
  ["schedule","plan","plans"],
  ["problem","issue","trouble"],
  ["size","sizes"],
  ["color","colors","colour","colours"],
  ["kid","kids","child","children"],
  ["adult","adults","people","person","persons"],
  ["group","others"],
  ["seat","seats","chair"],
  ["table","tables"],
  ["room","rooms"],
  ["area","space","place","spot"],
  ["way","route","direction"],
  ["line","queue"],
  ["delivery","shipping"],
  ["cleaning","clean"],
  ["battery","batteries"],
  ["material","materials"],
  ["class","classes","lesson","course"],
  ["movie","film"],
  ["price","cost","rate","rates","fare","fee","charge","prices"],
  ["discount","sale"],
  ["total","amount","sum"],
  ["email","mail"],
  ["wifi","internet"],
  ["heater","heat","heating"],
  ["light","lamp"],
  ["tv","television"],
  ["air","aircon","aircond","conditioner","conditioning"],
  ["rain","rains","rainy"],
  ["evening","night","tonight"],
  ["start","starts","begin","begins"],
  ["close","closes","closed","closing"],
  ["open","opens","opening"],
  ["finish","finishes","end","ends"],
  ["arrive","arrives","arrival"],
  ["photo","photos","picture","pictures"],
  ["coffee","coffees"],
  ["tour","tours"],
  ["package","packages"],
  ["option","options"],
  ["phone","phones"],
  ["glasses","spectacles"],
  ["notebook","notepad"],
  ["button","switch"],
  ["id","identification","passport"]
];

const TRAVEL_SYN=(function(){
  const m={};
  TRAVEL_SYN_GROUPS.forEach((g,i)=>g.forEach(w=>{ (m[w]=m[w]||[]).push(i); }));
  return m;
})();

function travelSynEq(a,b){
  if(!a||!b) return false;
  if(a===b) return true;
  if(a===b+"s" || b===a+"s" || a===b+"es" || b===a+"es") return true;
  const A=TRAVEL_SYN[a], B=TRAVEL_SYN[b];
  if(!A||!B) return false;
  return A.some(i=>B.indexOf(i)>=0);
}

function travelReWords(f){
  try{
    const src=String((f&&f.re)||"").replace(/\\[bB]/g," ").replace(/[^A-Za-z]+/g," ");
    return adWords(src);
  }catch(e){ return []; }
}

function travelKeyOf(it){
  const frameWords=new Set(adWords(String((it.frame&&it.frame.frame)||"").replace(/[~?]/g," ")));
  travelReWords(it.frame).forEach(w=>frameWords.add(w));
  const want=adWords((it.ex&&it.ex.en)||"").filter(w=>!frameWords.has(w)&&!TRAVEL_SKIP_WORDS.has(w));
  const solid=want.filter(w=>!TRAVEL_FILLER_WORDS.has(w));
  const key=solid.filter(w=>!TRAVEL_LIGHT_VERBS.has(w));
  /* 실전 반응은 '상대의 말'이 유일한 단서다.
     거기에 안 나온 낱말까지 요구하면 알 방법이 없는 문제가 된다 —
     상대가 말한 낱말일 때만 필수로 본다. */
  let needKey = key.length>0;
  if(needKey && it._react){
    const cue=adNorm(it.cue||"").split(" ").filter(Boolean);
    needKey = key.some(w=>cue.some(x=>x===w||adLooseWordEq(x,w)));
  }
  return {frameWords, want, key, needKey};
}

/* Context-preserving whole-sentence alternatives. Never interchange frame names globally. */
function travelAnswerAlternatives(it){
  const en=it.ex.en, id=it.frame.id, out=new Set([en]);
  const add=(re,...replacements)=>{for(const replacement of replacements)if(re.test(en))out.add(en.replace(re,replacement));};
  switch(id){
    case 'travel_can_i_get':
      add(/^Can (I|we) get /i,'Could $1 get ','Can $1 have ','Could $1 have ','May $1 have ');
      add(/^Can I get /i,"I'd like ");add(/^Can we get /i,"We'd like ");break;
    case 'travel_can_you':add(/^Can you /i,'Could you ','Would you ','Will you ','Please ');break;
    case 'travel_can_i_we':add(/^Can (I|we) /i,'Could $1 ','May $1 ');add(/^Can I /i,'Is it okay if I ','Is it OK if I ','Am I allowed to ');add(/^Can we /i,'Is it okay if we ','Are we allowed to ');break;
    case 'travel_do_you_have':
      add(/^Do you have /i,'Have you got ');
      if(!/this in|change for/.test(en))add(/^Do you have /i,/life jackets/.test(en)?'Are there ':'Is there ');break;
    case 'travel_is_there':
      add(/^Is there an extra charge for (.+)\?/i,'Do you charge extra for $1?');
      if(!/nearby|problem|cheaper way|ferry|bus to|extra charge|minimum charge|dress code/.test(en))add(/^Is there /i,'Do you have ','Have you got ');break;
    case 'travel_where_is':add(/^Where is /i,"Where's ",'Can you tell me where to find ','Could you tell me where to find ');add(/^Where are /i,'Can you tell me where to find ','Could you tell me where to find ');break;
    case 'travel_how_do_i_get_to':add(/^How do (I|we) get to /i,'How can $1 get to ','Could you tell me how to get to ','Can you show me the way to ');break;
    case 'travel_how_long':add(/^How long does it take/i,'How long will it take','How much time does it take');break;
    case 'travel_what_time_does':add(/^What time does /i,'When does ');break;
    case 'travel_what_time_need':add(/^What time do (we|I) need to /i,'When do $1 need to ','What time do $1 have to ','When do $1 have to ','What time should $1 ','When should $1 ');break;
    case 'travel_do_i_need_to':add(/^Do (I|we) need to /i,'Do $1 have to ');add(/^Do I need to /i,'Is it necessary for me to ');add(/^Do we need to /i,'Is it necessary for us to ');break;
    case 'travel_is_included':add(/^Is (.+) included\?/i,'Does the price include $1?','Is $1 included in the price?');add(/^Are (.+) included\?/i,'Does the price include $1?','Are $1 included in the price?');break;
    case 'travel_how_much':if(!/ per | for | to | with /.test(en))add(/^How much (?:is|are) (.+)\?/i,"What's the price of $1?","What is the price of $1?",'How much does $1 cost?');else add(/^How much is it /i,'How much does it cost ');break;
    case 'travel_pay_by_card':out.add('Could I pay by card?');out.add('Can I use a card?');out.add('Do you accept cards?');out.add('Do you take cards?');out.add('Can I pay with a card?');out.add('Is card payment accepted?');break;
    case 'travel_have_reservation':add(/^I have a reservation/i,'I have a booking','I made a reservation');add(/^We have a reservation/i,'We have a booking','We made a reservation');break;
    case 'travel_can_i_leave':add(/^Can (I|we) leave /i,'Could $1 leave ','May $1 leave ');break;
    case 'travel_problem_with':add(/^There's a problem with /i,'There is a problem with ','There is an issue with ','Something is wrong with ','I have a problem with ');break;
    case 'travel_cant_find':add(/^I can't find /i,'I cannot find ',"I'm unable to find ");add(/^We can't find /i,"We're unable to find ");break;
    case 'travel_think_i_left':add(/^I think I left /i,'I may have left ','I might have left ');break;
    case 'travel_does_that_mean':add(/^Does that mean /i,'Do you mean ','Are you saying ');break;
    case 'travel_say_again_slowly':out.add('Could you repeat that more slowly?');out.add('Can you say that again more slowly?');out.add('Could you say that again slowly?');out.add('Please repeat that slowly.');break;
    case 'travel_what_recommend':add(/^What do you recommend/i,'What would you recommend','What do you suggest','What would you suggest');break;
    case 'travel_can_we_change':add(/^Can (we|I) change /i,'Could $1 change ','Is it possible to change ');if(!/money/.test(en))add(/^Can (we|I) change /i,'Can $1 switch ');break;
    case 'travel_is_this_right':add(/^Is this the right /i,'Is this the correct ');break;
    case 'travel_where_meet':add(/^Where do (we|I) meet/i,'Where should $1 meet','Where will $1 meet');break;
    case 'travel_what_should_i_do':add(/^What should (I|we) do/i,'What do $1 need to do','What would you suggest $1 do');break;
    case 'travel_id_like_to':add(/^I'd like to /i,'I would like to ','I want to ','Can I ','Could I ');break;
    case 'travel_how_much_longer':add(/^How much longer until /i,'How long until ');add(/^How much longer (.+) take\?/i,'How much more time $1 take?');break;
    case 'travel_whats_difference':add(/^What's the difference between /i,'What is the difference between ');add(/^What's the difference between (.+)\?/i,'How are $1 different?');break;
    case 'travel_what_does_mean':add(/^What does (.+) mean\?/i,'What is the meaning of $1?','Can you explain $1?','Could you explain $1?');break;
    case 'travel_how_do_i':add(/^How do (I|we) /i,'How can $1 ');add(/^How (?:do|can) (?:I|we) /i,'Can you show me how to ','Could you tell me how to ');break;
    case 'travel_can_i_ask':add(/^Can (I|we) ask /i,'Could $1 ask ','May $1 ask ');break;
  }
  return [...out];
}
function travelMeaningNorm(text){
  return adNorm(text).replace(/\b(?:excuse me|please|thank you|thanks)\b/g,' ')
    .replace(/\b(?:there s|theres)\b/g,'there is').replace(/\bwhere s\b/g,'where is').replace(/\bwhat s\b/g,'what is')
    .replace(/\b(?:do not|don t)\b/g,'dont').replace(/\b(?:can not|can t)\b/g,'cant')
    .replace(/\b(?:is not|isn t)\b/g,'isnt').replace(/\b(?:are not|aren t)\b/g,'arent')
    .replace(/\bmore slowly\b/g,'slowly').replace(/\b(?:one more|extra)\b/g,'another').replace(/\b(?:bathroom|washroom)\b/g,'restroom')
    .replace(/\bbooking\b/g,'reservation').replace(/\bcab\b/g,'taxi').replace(/\bwi fi\b/g,'wifi')
    .replace(/\b(?:credit|debit) (?=cards?\b)/g,'').replace(/\b(?:a|an|the|some)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}
function travelMeaningGuard(expected,heard){
  const words=t=>travelMeaningNorm(t).split(' '), a=words(expected),b=words(heard);
  const neg=w=>/^(?:not|no|never|cant|dont|doesnt|isnt|arent|wont|cannot|couldnt|shouldnt|unable)$/.test(w);
  if(a.some(neg)!==b.some(neg))return false;
  const numeric=w=>/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/.test(w);
  for(const modifier of ['child','kids','hot','iced','bigger','smaller','cheaper','another','more','less','slowly','not','only','last','next','nearest'])if(a.includes(modifier)&&!b.includes(modifier))return false;
  const numbers=a.filter(numeric);if(numbers.join('|')!==b.filter(numeric).join('|'))return false;
  for(const pair of [['hot','iced'],['bigger','smaller'],['on','off'],['up','down'],['before','after'],['open','close'],['tomorrow','today']]){
    if(pair.some(w=>a.includes(w))&&pair.some(w=>b.includes(w)&&!a.includes(w)))return false;
  }
  return true;
}

function travelGrade(it, heard){
  const h=adNorm(heard), hw=h.split(" ").filter(Boolean);
  /* 1순위 — 목표 프레임을 실제로 썼는가. 여기는 엄격하게 본다. */
  let frameOk=false;
  try{ frameOk=new RegExp(it.frame.re,"i").test(h); }catch(e){ frameOk=false; }
  /* 🇲🇾 이벤트 팩은 현지어로 말해도 정답이다 */
  let myOk=false;
  if(it.frame && it.frame.myRe){ try{ myOk=new RegExp(it.frame.myRe,"i").test(h); }catch(e){ myOk=false; } }
  if(myOk) frameOk=true;
  /* 2·3순위 — 예시 정답과 낱말이 같은지는 결정적이지 않다.
     building 을 hotel 로, another 를 one more 로 바꿔 말해도 그 프레임을 연습한 것이다.
     낱말 비교는 기존 것을 그대로 쓴다: adLooseWordEq(활용형) + phWordEq(한국식 발음). */
  const K=travelKeyOf(it);
  const frameWords=K.frameWords, want=K.want;
  const hasW=(w)=>hw.some(x=>x===w||travelSynEq(x,w)||adLooseWordEq(x,w)||(function(){ try{ return phWordEq(x,w); }catch(e){ return false; } })());
  const missing=want.filter(w=>!hasW(w));
  const sameWords = !want.length || missing.length<want.length;      // 예시와 겹치는 낱말이 하나라도 있는가
  const extra = hw.filter(w=>!frameWords.has(w)).length;             // 프레임 말고 실제 내용이 있는가
  /* 핵심 낱말 — 하나라도 들어가야 정답.
     전부를 요구하지는 않는다: "another towel" 을 "one more towel" 로 바꿔 말한 건 맞는 답이다.
     하지만 towel 자리에 fork 를 넣으면 다른 말이라 오답이다. */
  const keyMissing=K.key.filter(w=>!hasW(w));
  const keyHit = !K.key.length || keyMissing.length===0;
  /* 프레임에 ~ 가 있으면 뒤에 뭔가는 붙여야 한다(Can I get ~?).
     문장 자체가 프레임이면(Hello. / How long does it take?) 그대로 말해도 정답이다. */
  const openFrame=/~/.test(String((it.frame&&it.frame.frame)||""));
  let ok = myOk ? true
           : frameOk && ((K.needKey && K.key.length) ? keyHit : (openFrame ? extra>0 : true));
  const candidates=travelAnswerAlternatives(it);
  const natural=candidates.find(answer=>travelMeaningNorm(answer)===travelMeaningNorm(heard));
  if(natural){ok=true;frameOk=true;}
  if(!travelMeaningGuard(it.ex.en,heard))ok=false;
  /* 같은 상황을 다르게 말해도 맞는 경우가 있다 (짐 기다릴 때 will it be? 도 자연스러움).
     예문 하나만 정답으로 보면 맞는 영어를 틀렸다고 가르치게 된다. */
  let altUsed=natural&&travelMeaningNorm(natural)!==travelMeaningNorm(it.ex.en)?natural:null;
  if(!ok && it.alt && it.alt.length){
    for(let ai=0; ai<it.alt.length; ai++){
      const sub=Object.assign({}, it, {ex:Object.assign({}, it.ex, {en:it.alt[ai]}), alt:null});
      let r=null; try{ r=travelGrade(sub, heard); }catch(e){ r=null; }
      if(r && r.ok){ ok=true; altUsed=it.alt[ai]; break; }
    }
  }
  return { ok, altUsed, blockHit:frameOk, slotHit:true, slot:missing, hit:want.length-missing.length,
           heardNorm:h, altBlock:null, key:K.key, keyMissing, needKey:K.needKey,
           myOk,                                       // 현지어로 말해서 맞음
           keyMiss:(frameOk && !myOk && K.needKey && !keyHit),  // 프레임은 맞는데 핵심 낱말이 없음
           meaningOnly:(!frameOk && sameWords),      // 뜻은 통하는데 이번 프레임을 안 씀
           otherWords:(ok && !sameWords) };          // 프레임은 맞고 예시와 다른 낱말로 말함
}

const TRAVEL_COUNT_KEY="speakingroom:travel_count";

const TRAVEL_COUNTS=[5,10,15,20];

function travelCountGet(){
  let v; try{ v=+hGet(TRAVEL_COUNT_KEY,10)||10; }catch(e){ v=10; }
  return TRAVEL_COUNTS.indexOf(v)>=0 ? v : 10;
}

const TRAVEL_STUDY_KEY="speakingroom:travel_study";

function travelStudyGet(){
  try{ const v=hGet(TRAVEL_STUDY_KEY,[]); return Array.isArray(v)?v.filter(id=>TRAVEL_BY_ID[id]):[]; }
  catch(e){ return []; }
}

function travelStudySet(a){ try{ hSet(TRAVEL_STUDY_KEY, (a||[]).slice()); }catch(e){} }

const MISS_KEY="speakingroom:travel_miss";

function missAll(){ try{ const v=hGet(MISS_KEY,{}); return (v&&typeof v==="object")?v:{}; }catch(e){ return {}; } }

function missSave(o){ try{ hSet(MISS_KEY,o); }catch(e){} }

const MISS_GRADUATE=3;

function missList(){
  const o=missAll();
  return Object.keys(o)
    .filter(en=>(o[en].miss||0)>0 && TRAVEL_BY_ID[o[en].fid])
    .map(en=>Object.assign({en:en}, o[en]))
    .sort((a,b)=> (b.miss-a.miss) || ((b.lastT||0)-(a.lastT||0)));
}

function missCount(){ try{ return missList().length; }catch(e){ return 0; } }

const SURVIVAL=[
 {id:"sv_ms",   emo:"💳", t:"카드 결제 문제", role:"a customer-service agent at a software company (like Microsoft)", ctx:"The learner called customer service because their card expired and a payment/subscription failed. They must explain the problem, verify the account, and get it fixed.", emotion:"polite but a bit impatient, follows a strict verification script", pressure:"a long support queue; the agent wants to move fast"},
 {id:"sv_clinic",emo:"🏥", t:"병원 예약·접수", role:"a hospital/clinic receptionist", ctx:"The learner needs to make an appointment or check in, describe a symptom, and answer questions about insurance and personal info.", emotion:"rushed and busy, many patients waiting", pressure:"the clinic closes soon; limited appointment slots"},
 {id:"sv_school",emo:"🏫", t:"아이 학교 상담", role:"the learner's child's school teacher", ctx:"Meeting or calling about how their child is settling in; ask questions and share concerns.", emotion:"supportive but short on time between classes", pressure:"only a few minutes before the next class"},
 {id:"sv_bank", emo:"🏦", t:"은행 계좌 개설", role:"a bank teller", ctx:"The learner wants to open a bank account: answer ID/address questions, choose an account type, handle paperwork.", emotion:"professional, detail-obsessed about documents", pressure:"strict ID requirements; a queue behind them"},
 {id:"sv_phone",emo:"📱", t:"휴대폰 개통", role:"a mobile carrier shop staff", ctx:"The learner wants a SIM/phone plan: discuss plans, data, price, ID, activation.", emotion:"chatty salesperson trying to upsell", pressure:"pushes add-ons; activation needs documents"},
 {id:"sv_hotel",emo:"🏨", t:"호텔 체크인 문제", role:"a hotel front-desk clerk", ctx:"There's a problem at check-in (reservation not found / room issue); the learner must explain and resolve it.", emotion:"stressed, the lobby is crowded", pressure:"no record of the booking; a line forming"},
 {id:"sv_parcel",emo:"📦", t:"택배 분실 문의", role:"a delivery/courier customer-service agent on a phone line", ctx:"The learner's package is lost or delayed; give tracking info, explain the problem, ask for a solution.", emotion:"a bit defensive, asks for proof", pressure:"bad phone connection; keeps mishearing the tracking number"},
 {id:"sv_pharm", emo:"💊", t:"약국에서 약 사기", role:"a pharmacist", ctx:"The learner needs medicine for a symptom: explain what's wrong and ask about dosage.", emotion:"careful and cautious about safety", pressure:"asks detailed health questions before selling"},
 {id:"sv_immig", emo:"🛂", t:"입국심사·관공서", role:"an immigration / government office officer", ctx:"The learner must answer questions about purpose of stay, documents, address, and duration.", emotion:"firm, official, no small talk", pressure:"strict; unexpected follow-up questions; must be clear"},
 {id:"sv_net",   emo:"🌐", t:"인터넷 문제 통화", role:"an internet service provider support agent", ctx:"The learner's internet is down; they must describe the problem, do troubleshooting steps, and arrange a fix.", emotion:"reads from a troubleshooting script, slightly robotic", pressure:"makes them try steps live; connection keeps cutting"}
];

/* Answer explanations restored from the original learning screen. */
const PREP_VERB=/^(get|go|check|walk|be|leave|come|pay|book|order|see|rent|try|return|ask|take|make|learn|send|cancel|confirm|extend|speak|open|change|reserve|drink|watch|read|buy|wait|sign|pick|meet|eat|use|stay|finish|start|sleep|call|arrive|do|fix|clean|cook|dry|charge|deliver|weigh|print|bring|wear|keep|show|tell|turn|flush|lock|scan|split|top|report|find|connect|set|boil|save|spell|answer|hold|carry|heat|put|close|wrap|help|drop|write)$/;
const PREP_TIMEUNIT=/^(minute|minutes|hour|hours|day|days|night|nights|week|weeks|month|months|year|years|second|seconds|while|bit|moment|days?)$/;
const PREP_NUM=/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|fifty|\d+)$/;
const PREP_PERSON=/^(me|us|you|him|her|them|kids|children|adults|someone|everyone|myself)$/;
const PREP_RIDE=/^(taxi|bus|train|car|boat|ferry|plane|subway|speedboat)$/;
const PREP_WAY=/^(card|cash|mail|phone|email|hand)$/;
const PREP_BESIDE=/^(window|pool|door|entrance|sea|beach|counter|river)$/;
const PREP_CLOCK=/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight|\d{1,2}(:\d\d)?)$/;
const PREP_ONRIDE=/^(boat|bus|train|plane|ferry|tour)$/;
const PREP_DAY=/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)$/;
const PREP_WHEN=/^(morning|afternoon|evening|night)$/;
/* 동사에 붙어 통째로 한 뜻이 되는 것들. 여기서 in·on·up 은 전치사가 아니다.
   "check in 의 in 이 왜 '안에'냐"고 헷갈리는 걸 막으려고 따로 뺀다. */
const PREP_PHRASAL={
  "check in":"체크인하다", "check out":"체크아웃하다", "come in":"들어오다", "come back":"돌아오다",
  "turn on":"켜다", "turn off":"끄다", "turn up":"(소리·세기를) 올리다", "try on":"입어보다",
  "get on":"(배·버스에) 타다", "get up":"일어나다", "get through":"통과하다",
  "top up":"충전하다", "sign up":"가입하다", "set up":"설정하다", "take off":"벗다",
  "pick up":"찾아가다", "put on":"입다", "wait for":"~을 기다리다", "look for":"~을 찾다", "pay for":"~의 값을 내다"
};
const PREP_SEP=/^(try|turn|pick|top|put|take)$/;   /* try this on 처럼 사이에 낱말이 끼는 것 */
/* 앞에 관사·소유격이 오면 그다음 낱말이 진짜 알맹이다 */
function prepHead(ws, i){
  let j=i+1;
  while(j<ws.length && /^(the|a|an|my|our|your|his|her|their|this|that|these|those|next|last|first|other|another|nearest|whole)$/.test(ws[j])) j++;
  return {head:(ws[j]||""), first:(ws[i+1]||"")};
}
const PREP_DUR=/^(a|an|one|two|three|four|five|six|seven|eight|ten|fifteen|twenty|thirty|\d+)?\s*(minute|hour|day|night|week|month|year|second|while|bit|moment)s?\b/;
const PREP_WHENFOR=/^(today|tomorrow|tonight|now|later|monday|tuesday|wednesday|thursday|friday|saturday|sunday|the weekend|the night|this (weekend|morning|afternoon|evening|week|month))\b/;
const PREP_WHOFOR=/^(me|us|you|him|her|them|kids|children|adult|adults|people|person|someone|everyone|one|two|three|four|five|six|a family|a child|a kid|a beginner|a small|my wife|a person)\b/;
function prepNotes(en){
  const raw=String(en||"");
  const ws=raw.replace(/[?.,!"']/g," ").split(/\s+/).filter(Boolean).map(w=>w.toLowerCase());
  const out=[], seen={}, used={};
  const add=(w,t,d)=>{ const k=w+"|"+t; if(seen[k]) return; seen[k]=1; out.push({w:w,t:t,d:d}); };
  /* 먼저 구동사부터 — 여기 걸린 자리는 전치사로 설명하지 않는다 */
  ws.forEach((w,i)=>{
    if(i===0) return;
    let pv=ws[i-1]+" "+w;
    if(!PREP_PHRASAL[pv] && i>=2 && PREP_SEP.test(ws[i-2])) pv=ws[i-2]+" "+w;   /* try this on */
    const ko=PREP_PHRASAL[pv];
    if(!ko) return;
    if(pv==="wait for" && PREP_DUR.test(ws.slice(i+1,i+4).join(" "))) return;    /* wait for 5 minutes 는 기간 */
    used[i]=1;
    add(pv, "동사에 붙은 말", "여기서 <b>"+w+"</b> 는 전치사가 <b>아니에요</b>. <b>"+pv+"</b> 가 통째로 '"+ko+"' 예요.");
  });
  ws.forEach((w,i)=>{
    if(used[i]) return;
    const H=prepHead(ws,i), head=H.head, nx=H.first;
    const prev2=(ws[i-2]||"")+" "+(ws[i-1]||"");
    if(!nx && /^(on|off)$/.test(w)) {
      if(/\b(light|lights|tv|air conditioning|heater)\b/.test(raw.toLowerCase()))add(w,'켜짐·꺼짐 상태',w==='on'?'여기서는 <b>켜져 있는 상태</b>예요. leave the light on = 불을 켜둔 채로 두다.':'여기서는 <b>꺼져 있는 상태</b>예요.');
      return;
    }
    switch(w){
      case "to":
        if(PREP_VERB.test(nx)) add("to","동사 앞의 to","전치사가 <b>아니에요</b>. 동사 앞에 붙어서 <b>~하는 것 · ~하려고</b> 를 만들어요. (to get = 가는 것)");
        else add("to","도착점","<b>~까지 · ~에게</b>. 가는 곳이나 주는 상대가 뒤에 와요.");
        break;
      case "for": {
        const af=ws.slice(i+1,i+4).join(" ");
        if(PREP_DUR.test(af))          add("for","얼마 동안","<b>~동안</b>. 시간 <b>길이</b>가 뒤에 와요. (for five minutes = 5분 동안)");
        else if(PREP_WHENFOR.test(af)) add("for","언제 쓸 건지","<b>~에 쓸 · ~날짜로</b>. 언제인지가 뒤에 와요. (for tomorrow = 내일 걸로)");
        else if(PREP_WHOFOR.test(af))  add("for","누구 주려고","<b>~에게 · ~용</b>. 받는 사람이나 인원이 뒤에 와요.");
        else                           add("for","무슨 용도","<b>~용 · ~하려고</b>. 쓸 곳이나 목적이 뒤에 와요.");
        break; }
      case "by":
        if(PREP_RIDE.test(head)&&!/^(the|a|an|my|our)$/.test(nx)) add("by","타고 가는 수단","<b>~로 (타고)</b>. 교통수단이 뒤에 와요. 이때는 <b>the 를 안 붙여요</b> — by taxi (○) by the taxi (✕)");
        else if(PREP_WAY.test(head)&&!/^(the|a|an|my|our)$/.test(nx)) add("by","내는 방법","<b>~로</b>. 결제·전달 방법이 뒤에 와요. 여기도 <b>the 없이</b> by card.");
        else if(PREP_BESIDE.test(head)) add("by","바로 옆","<b>~옆에</b>. 딱 붙어 있는 자리예요. (by the window = 창가)");
        else add("by","수단·방법","<b>~로</b>. 어떻게 하는지가 뒤에 와요.");
        break;
      case "at":
        if(PREP_CLOCK.test(nx)) add("at","몇 시에","<b>~시에</b>. 시각은 항상 at 이에요. (at seven = 7시에)");
        else add("at","콕 집은 지점","<b>~에서</b>. 넓은 공간이 아니라 <b>한 지점</b>이에요 — 카운터 앞, 프런트, 문 앞.");
        break;
      case "in":
        if(head==="cash") add("in","현금으로","<b>in cash = 현금으로</b>. 통째로 외우세요. 카드는 by card 인데 현금만 in cash 예요.");
        else if(/^(advance|stock|total|line|person)$/.test(head)) add("in","통째로 외우는 말","<b>in "+head+"</b> 로 붙어다녀요. 낱말 뜻으로 쪼개지 마세요.");
        else if(/^(english|korean|ringgit|blue|red|black|white)$/.test(head)) add("in","어떤 형태로","<b>~로</b>. 언어·색·화폐가 뒤에 와요. (in English = 영어로)");
        else if(PREP_WHEN.test(head)) add("in","하루 중 언제","<b>~에</b>. 아침·오후·저녁은 in 을 써요. (in the morning)");
        else add("in","둘러싸인 안","<b>~안에</b>. 사방이 막힌 공간이에요. 택시·방·상자는 in.");
        break;
      case "on":
        if(head==="foot") add("on","걸어서","<b>on foot = 걸어서</b>. 통째로 외우세요.");
        else if(/^(sale|budget|time|purpose)$/.test(head)) add("on","통째로 외우는 말","<b>on "+head+"</b> 로 붙어다녀요.");
        else if(PREP_DAY.test(head)) add("on","무슨 요일에","<b>~요일에</b>. 날짜·요일은 on 이에요.");
        else if(PREP_ONRIDE.test(head)) add("on","타고 있는","<b>~에 (타고)</b>. 배·버스·비행기는 <b>on</b>, 택시·승용차는 <b>in</b> 이에요. 서서 걸어다닐 수 있으면 on.");
        else add("on","표면 위","<b>~위에</b>. 바닥이나 면에 닿아 있어요.");
        break;
      case "with":
        if(/problem/.test(prev2)) add("with","무엇에 문제가","<b>~에 (문제가 있다)</b>. a problem with ~ 로 붙어다녀요.");
        else if(/help/.test(prev2)) add("with","무엇을 도와줘","<b>~을 (도와줘)</b>. help me with ~ 로 붙어다녀요.");
        else if(PREP_PERSON.test(nx)) add("with","누구와 함께","<b>~와 같이</b>.");
        else add("with","무엇을 가지고","<b>~로 · ~을 가지고</b>. 쓰는 도구나 같이 있는 것이 뒤에 와요.");
        break;
      case "between": add("between","둘 중에","<b>A와 B 사이</b>. 반드시 <b>between A <u>and</u> B</b> 로 and 와 짝을 지어요."); break;
      case "until":   add("until","그때까지 쭉","<b>~까지</b>. 계속 이어지다 끝나는 시점이에요."); break;
      case "about":   add("about","무엇에 대해","<b>~에 대해</b>. 이야기 주제가 뒤에 와요."); break;
      case "of":      add("of","~의","앞말과 뒷말을 묶어줘요. (a glass of water = 물 한 잔)"); break;
      case "after":   add("after","~한 뒤에","<b>~후에</b>. 먼저 끝나는 일이 뒤에 와요."); break;
      case "before":  add("before","~하기 전에","<b>~전에</b>."); break;
      case "per":     add("per","하나당","<b>~당 · ~마다</b>. (per night = 1박당)"); break;
      case "near": case "around": add(w,"근처에","<b>~근처에</b>. 딱 붙어 있진 않아요."); break;
      case "from":    add("from","출발점","<b>~에서부터</b>. 시작하는 곳이에요."); break;
      case "inside":  add("inside","안으로","<b>안에 · 안으로</b>."); break;
      case "instead": add("instead","대신에","<b>대신에</b>. instead of ~ 로도 써요."); break;
    }
  });
  return out;
}

const FREQ_DICT={"the":"그/저(정관사)","and":"그리고","to":"~로/~에게","a":"하나의(부정관사)","in":"~안에","for":"~을 위해","is":"~이다","on":"~위에","that":"그/저것","by":"~에 의해/~옆에","this":"이것","with":"~와 함께","i":"나","you":"너/당신","it":"그것","not":"~않다","or":"또는","be":"~이다/되다","are":"~이다","from":"~로부터","at":"~에서","as":"~로서/~만큼","your":"너의","have":"가지다","new":"새로운","more":"더 많은","was":"~였다","we":"우리","will":"~할 것이다","home":"집","can":"~할 수 있다","about":"~에 대해","if":"만약","page":"페이지/쪽","my":"나의","has":"가지다","search":"찾다/검색하다","free":"자유로운/무료의","but":"그러나","our":"우리의","one":"하나","other":"다른","do":"하다","information":"정보","time":"시간","they":"그들","site":"장소/현장/사이트","he":"그(남자)","up":"위로","may":"~일지도/5월","what":"무엇","which":"어느","their":"그들의","news":"뉴스","out":"밖으로","use":"사용하다","any":"어떤","there":"거기","see":"보다","only":"오직","so":"그래서","his":"그의","when":"언제","contact":"연락(하다)/접촉","here":"여기","business":"사업","who":"누구","web":"웹","now":"지금","help":"돕다/도움","get":"얻다/받다","view":"관점/전망/보다","online":"온라인","e":"이메일/전자(접두어)","first":"첫번째","been":"~였다","would":"~할 것이다","how":"어떻게","me":"나를","some":"약간의","click":"클릭(하다)","like":"좋아하다/~같은","service":"서비스/봉사","x":"엑스/곱하기","than":"~보다","find":"찾다","price":"가격","date":"날짜/데이트","back":"뒤/등","top":"꼭대기/위","people":"사람들","list":"목록","name":"이름","just":"그냥/방금","over":"~위에/끝난","state":"상태/주(州)","year":"년/해","day":"날/하루","into":"~안으로","email":"이메일","two":"둘","health":"건강","n":"엔(글자)","world":"세계","re":"~에 관하여","next":"다음","used":"사용된/익숙한","b":"비(글자)","work":"일하다/작동하다","last":"마지막의/지난","most":"가장","music":"음악","buy":"사다","make":"만들다","should":"~해야 한다","product":"제품/상품","system":"시스템/체계","post":"게시(하다)/우편","city":"도시","t":"티(글자)","add":"더하다/추가하다","policy":"정책/방침","number":"숫자","such":"그런","please":"제발/부디","available":"이용 가능한","copyright":"저작권","support":"지지하다/지원","message":"메시지","after":"~후에","best":"최고의","software":"소프트웨어","then":"그때/그다음","video":"영상/비디오","well":"잘/음","d":"디(글자)","where":"어디","public":"공공의/대중","books":"책들","high":"높은","school":"학교","through":"~을 통해","m":"엠(글자)","each":"각각의","she":"그녀","review":"검토/후기","order":"주문/순서","very":"매우","privacy":"사생활/개인정보","company":"회사","r":"아르(글자)","read":"읽다","group":"그룹/집단","sex":"성별/성관계","need":"필요하다","many":"많은","set":"놓다/세트","under":"~아래에","general":"일반적인/장군","research":"연구","university":"대학교","january":"1월","mail":"우편","full":"가득한","program":"프로그램","life":"삶/생명","know":"알다","way":"길/방법","days":"날들","management":"관리/경영","p":"피(글자)","great":"훌륭한","hotel":"호텔","real":"진짜의","f":"에프(글자)","item":"항목/물품","international":"국제적인","center":"중심/센터","must":"~해야 한다","store":"가게/저장하다","travel":"여행하다","made":"만들었다","development":"개발/발전","report":"보고(하다)","off":"떨어져/꺼진","member":"회원/구성원","line":"선/줄","before":"~전에","did":"했다","send":"보내다","right":"오른쪽/옳은","type":"유형/타이핑하다","because":"왜냐하면","local":"지역의","office":"사무실","education":"교육","national":"국가의","car":"자동차","design":"디자인/설계","take":"가져가다/잡다","internet":"인터넷","address":"주소/연설","community":"공동체/커뮤니티","area":"지역/면적","want":"원하다","phone":"전화","shipping":"배송","reserved":"예약된/(권리)보유","subject":"주제/과목/대상","between":"~사이에","forum":"포럼/게시판","family":"가족","l":"엘(글자)","long":"긴","based":"~에 기반한","w":"더블유(글자)","code":"암호/코드","show":"보여주다","o":"오(글자)","even":"심지어","black":"검은","check":"확인하다/수표","special":"특별한","index":"색인/지수","much":"많은","sign":"표지판/서명하다","file":"파일/서류","link":"연결/링크","open":"열다/열린","today":"오늘","technology":"기술","south":"남쪽","case":"경우/사건","project":"프로젝트/계획","same":"같은","version":"버전/판","section":"부분/구역","own":"자신의","found":"찾았다","sports":"스포츠","house":"집","related":"관련된","security":"보안","both":"둘 다","g":"지(글자)","county":"군(郡)","american":"미국의","photo":"사진","game":"게임/경기","power":"힘/전력","while":"~하는 동안","care":"돌봄/관심","network":"네트워크/망","down":"아래로","computer":"컴퓨터","three":"셋","place":"장소","end":"끝","following":"다음의/따르는","h":"에이치(글자)","him":"그를","without":"~없이","think":"생각하다","north":"북쪽","resources":"자원/자료","current":"현재의/해류","big":"큰","media":"미디어/매체","control":"통제하다","water":"물","history":"역사","size":"크기/사이즈","art":"예술","personal":"개인적인","guide":"안내(서)/가이드","shop":"가게/쇼핑하다","directory":"디렉터리/명부","board":"판자/이사회/탑승하다","location":"위치/장소","change":"바꾸다/변화","white":"흰","text":"본문/문자","small":"작은","rating":"평가/등급","rate":"비율/요금/속도","government":"정부","children":"아이들","return":"돌아오다/반납하다","v":"브이(글자)","shopping":"쇼핑","account":"계좌/계정","times":"번/시대","level":"수준/레벨","digital":"디지털","profile":"프로필/측면","previous":"이전의","form":"형태/양식","love":"사랑(하다)","old":"늙은/오래된","main":"주요한","call":"부르다/전화하다","image":"이미지/사진","department":"부서","title":"제목/직함","y":"와이(글자)","insurance":"보험","why":"왜","property":"재산/부동산","class":"수업/계급","still":"여전히","money":"돈","quality":"품질/질","every":"모든","content":"내용/콘텐츠","country":"나라","private":"사적인/개인의","little":"작은/조금","visit":"방문하다","save":"구하다/저장하다","low":"낮은","reply":"답장(하다)","customer":"고객","december":"12월","compare":"비교하다","college":"대학","value":"가치/값","article":"기사/글","york":"요크","man":"남자","card":"카드","j":"제이(글자)","food":"음식","source":"출처/근원","author":"저자/작가","different":"다른","press":"누르다/언론","u":"유(글자)","learn":"배우다","sale":"판매/세일","print":"인쇄(하다)","course":"과정(of course 물론)","job":"직업/일","canada":"캐나다","process":"과정/처리하다","room":"방","stock":"재고/주식","training":"훈련","too":"너무/또한","credit":"신용/신용카드","point":"점/요점","join":"합류하다","science":"과학","advanced":"고급의/진보한","west":"서쪽","sales":"판매/매출","look":"보다","english":"영어/영국의","left":"왼쪽/떠났다","team":"팀","estate":"부동산/재산","box":"상자","select":"선택하다","gay":"동성애의/즐거운","thread":"실/(게시판)글타래","week":"주","category":"범주/카테고리","note":"메모/음표/주목하다","live":"살다","gallery":"갤러리/화랑","table":"탁자","register":"등록(하다)","however":"그러나","june":"6월","october":"10월","november":"11월","library":"도서관/라이브러리","really":"정말로","start":"시작하다","series":"시리즈/연속","model":"모델/모형","air":"공기","industry":"산업","plan":"계획","human":"인간","provided":"제공된/만약 ~라면","tv":"텔레비전","yes":"네","second":"초/두번째","hot":"뜨거운/더운","cost":"비용/(비용이)들다","march":"3월/행진","la":"라(음/도시)","september":"9월","better":"더 좋은","say":"말하다","july":"7월","yahoo":"야후","going":"가는 중","test":"시험/검사","come":"오다","pc":"개인용 컴퓨터","study":"공부/연구","application":"신청/지원/앱","cart":"카트/장바구니","staff":"직원","feedback":"피드백/의견","again":"다시","play":"놀다/연주하다","looking":"보는 중/찾는 중","april":"4월","never":"결코 ~않다","complete":"완전한/완료하다","topic":"주제/화제","standard":"표준/기준","tax":"세금","person":"사람","below":"~아래에","mobile":"이동의/휴대폰","less":"더 적은","party":"파티/정당","student":"학생","let":"~하게 하다","legal":"법적인/합법의","above":"~위에","recent":"최근의","park":"공원/주차하다","side":"쪽/측면","act":"행동하다/연기하다","problem":"문제","red":"빨간","give":"주다","memory":"기억/추억","social":"사회의/사교의","q":"큐(글자)","august":"8월","quote":"인용/견적","story":"이야기","sell":"팔다","options":"선택지(복수)","experience":"경험","create":"만들다/생성하다","key":"열쇠/핵심","young":"젊은","america":"미국","field":"들판/분야","east":"동쪽","paper":"종이/논문","single":"하나의/독신의","age":"나이","club":"클럽/동아리","example":"예/사례","password":"비밀번호","z":"지(글자)","something":"무언가","road":"길/도로","gift":"선물","night":"밤","ca":"캘리포니아(약자)","hard":"어려운/단단한","pay":"지불하다","four":"넷","poker":"포커","issue":"문제/쟁점/발행하다","range":"범위/산맥","building":"건물","court":"법정/코트","february":"2월","always":"항상","result":"결과","audio":"오디오/음성","light":"빛/가벼운","write":"쓰다","war":"전쟁","offer":"제안하다","blue":"파란","easy":"쉬운","given":"주어진","event":"사건/행사","release":"풀어주다/출시하다","analysis":"분석","request":"요청","fax":"팩스","china":"중국","making":"만드는","picture":"그림/사진","possible":"가능한","professional":"전문적인/프로","yet":"아직","major":"주요한/소령/전공","star":"별/스타","future":"미래","space":"공간/우주","committee":"위원회","hand":"손","sun":"태양","meeting":"회의/만남","interest":"관심/이자","id":"신분증","child":"아이","keep":"유지하다","enter":"들어가다/입력하다","california":"캘리포니아","million":"백만","reference":"참고/참조","baby":"아기","learning":"학습/배움","energy":"에너지","run":"달리다/운영하다","delivery":"배달","net":"그물/순(純)/인터넷","popular":"인기 있는/대중의","term":"용어/기간","film":"영화/필름","put":"놓다","journal":"저널/일기","try":"시도하다","welcome":"환영하다","central":"중앙의","president":"대통령/회장","notice":"알아차리다/공지","god":"신/하느님","original":"원래의/독창적인","head":"머리","radio":"라디오","until":"~까지","cell":"세포/감방/휴대폰","self":"자기 자신","council":"의회/위원회","away":"멀리","track":"길/추적하다","australia":"호주","discussion":"토론/논의","once":"한번","entertainment":"오락/연예","agreement":"합의/계약","least":"가장 적은(at least 적어도)","society":"사회","log":"통나무/기록(하다)","safety":"안전","faq":"자주 묻는 질문","trade":"무역/거래","marketing":"마케팅","further":"더 멀리/더욱","association":"협회/연관","able":"~할 수 있는","having":"가지고 있는","david":"데이비드(이름)","already":"이미","green":"초록","close":"가까운/닫다","common":"흔한/공통의","drive":"운전하다","specific":"구체적인/특정한","several":"몇몇의","gold":"금","living":"사는/생활","collection":"수집/컬렉션","short":"짧은","ask":"묻다","limited":"제한된/유한의","powered":"동력의/~로 작동하는","daily":"매일의","beach":"해변","past":"과거/지난","natural":"자연스러운/천연의","whether":"~인지 아닌지","due":"~때문에/예정된","electronics":"전자기기/전자공학","five":"다섯","period":"기간/마침표","planning":"계획","database":"데이터베이스","official":"공식의/공무원","weather":"날씨","mar":"손상시키다/3월(약자)","land":"땅/착륙하다","average":"평균","window":"창문","france":"프랑스","pro":"프로/찬성","region":"지역/지방","island":"섬","record":"기록/음반","direct":"직접의/지시하다","environment":"환경","calendar":"달력/일정표","style":"스타일/방식","front":"앞","update":"업데이트/갱신하다","ever":"언제나/한번이라도","early":"이른","sound":"소리","resource":"자원/자료","present":"선물/현재/참석한","either":"둘 중 하나","ago":"~전에","document":"문서","word":"단어","material":"재료/물질","bill":"계산서/청구서","written":"쓰여진","talk":"말하다/대화","final":"마지막의","thing":"것/물건","cheap":"싼","nude":"나체의","finance":"재정/금융","true":"진짜의","minutes":"분(복수)","else":"그밖에","mark":"표시/마크","third":"세번째","rock":"바위/록","europe":"유럽","reading":"읽기/독서","bad":"나쁜","individual":"개인/개별의","plus":"더하기/플러스","cover":"덮다/표지","usually":"보통","edit":"편집하다","together":"함께","percent":"퍼센트","unit":"단위/부대","global":"세계적인/전체의","meet":"만나다","far":"먼","economic":"경제의","en":"엔(글자)","player":"선수/플레이어","subscribe":"구독하다/가입하다","germany":"독일","amount":"양/금액","watch":"보다/손목시계","feel":"느끼다","though":"~이긴 하지만","bank":"은행/둑","risk":"위험","thanks":"감사","everything":"모든 것","production":"생산/제작","commercial":"상업의/광고","james":"제임스(이름)","weight":"무게/체중","town":"마을","heart":"심장/마음","advertising":"광고(업)","received":"받은","treatment":"치료/대우","newsletter":"소식지/뉴스레터","archives":"기록 보관소/archive","magazine":"잡지","error":"오류/실수","camera":"카메라","girl":"소녀","currently":"현재","construction":"건설/공사","registered":"등록된","clear":"분명한/맑은","golf":"골프","receive":"받다","domain":"영역/도메인","chapter":"장(章)/지부","protection":"보호","loan":"대출","wide":"넓은","beauty":"아름다움","manager":"관리자/매니저","india":"인도","position":"위치/자리","sort":"종류/분류하다","michael":"마이클(이름)","known":"알려진","half":"반","step":"걸음/단계","engineering":"공학/엔지니어링","florida":"플로리다","simple":"간단한","quick":"빠른","wireless":"무선의","license":"면허/허가","paul":"폴(이름)","friday":"금요일","lake":"호수","whole":"전체의","annual":"연례의/매년의","later":"나중에","basic":"기본의/기초의","corporate":"기업의/법인의","church":"교회","purchase":"구입(하다)","response":"응답/반응","practice":"연습/실천","hardware":"하드웨어/철물","figure":"수치/인물/figure out 알아내다","materials":"재료/자료(복수)","fire":"불","holiday":"휴일","chat":"수다/대화","enough":"충분한","designed":"설계된","death":"죽음","writing":"쓰기/글","speed":"속도","loss":"손실/상실","face":"얼굴","brand":"상표/브랜드","higher":"더 높은","remember":"기억하다","oil":"기름/석유","bit":"조금","yellow":"노란색","political":"정치적인","increase":"증가(하다)","advertise":"광고하다","base":"기지/토대","near":"가까운","environmental":"환경의","thought":"생각","stuff":"물건/것","french":"프랑스의/프랑스어","storage":"저장(고)","oh":"오!","japan":"일본","shoes":"신발","stay":"머무르다","nature":"자연/본성","availability":"이용 가능성","africa":"아프리카","turn":"돌다/차례","growth":"성장","agency":"대행사/기관","king":"왕","monday":"월요일","activity":"활동","copy":"복사(하다)/사본","although":"비록 ~이지만","western":"서양의/서부의","income":"소득/수입","force":"힘/강요하다","cash":"현금","employment":"고용/취업","overall":"전반적인/전체의","bay":"만(灣)","river":"강","commission":"위원회/수수료","ad":"광고","package":"꾸러미/패키지","contents":"내용물/목차(복수)","seen":"보였다","engine":"엔진","port":"항구/포트","album":"앨범","regional":"지역의","stop":"멈추다","administration":"행정/관리","bar":"바/막대","institute":"기관/협회","double":"두 배의","dog":"개","build":"짓다/만들다","screen":"화면/스크린","exchange":"교환/환전","soon":"곧","continue":"계속하다","across":"~을 가로질러","season":"계절/시즌","anything":"무엇이든","printer":"프린터/인쇄기","condition":"상태/조건","effective":"효과적인/유효한","believe":"믿다","effect":"효과/영향","sunday":"일요일","selection":"선택/선발","casino":"카지노","lost":"잃어버린/길 잃은","tour":"여행/관광","menu":"메뉴","volume":"부피/음량/권(卷)","cross":"건너다/십자가","anyone":"누구든","mortgage":"주택담보대출","hope":"희망(하다)","silver":"은","corporation":"기업/법인","wish":"바라다","inside":"안쪽","mature":"성숙한/만기의","role":"역할","rather":"오히려/꽤","addition":"추가/덧셈","came":"왔다","supply":"공급(하다)","nothing":"아무것도 아닌","certain":"확실한/어떤","executive":"임원/경영진","running":"달리는/운영하는","lower":"더 낮은/낮추다","union":"조합/연합","homepage":"홈페이지","hour":"시간","gas":"가스/휘발유","six":"여섯","bush":"덤불/관목","islands":"섬(복수)","career":"경력/직업","military":"군대의","rental":"임대(의)","leave":"떠나다/남기다","british":"영국의","pre":"~이전의(접두어)","sat":"앉았다/SAT시험","woman":"여자","zip":"지퍼/우편번호","bid":"입찰(하다)","kind":"친절한/종류","middle":"중간","move":"움직이다","cable":"케이블/전선","taking":"가져가는","division":"분할/부서","tuesday":"화요일","object":"물체/대상/반대하다","machine":"기계","length":"길이","nice":"좋은/멋진","score":"점수/득점","statistics":"통계(학)","client":"고객/의뢰인","ok":"좋아/괜찮은","capital":"수도/자본","sample":"표본/견본","investment":"투자","saturday":"토요일","christmas":"크리스마스","england":"영국","culture":"문화","band":"밴드/띠","flash":"섬광/번쩍임","lead":"이끌다/납","george":"조지(이름)","choice":"선택","registration":"등록","thursday":"목요일","airport":"공항","artist":"예술가/아티스트","outside":"바깥","furniture":"가구","channel":"채널/해협","letter":"편지/글자","mode":"방식/모드","wednesday":"수요일","fund":"기금/자금","summer":"여름","contract":"계약","button":"버튼/단추","super":"최고의/슈퍼","male":"남성의","custom":"맞춤의/관습","multiple":"다수의/여러","asian":"아시아의","distribution":"분배/유통","inn":"여관","industrial":"산업의/공업의","potential":"잠재력/가능성","song":"노래","focus":"초점/집중하다","late":"늦은","fall":"떨어지다/가을","featured":"특집의/주연한","idea":"생각/아이디어","female":"여성의","win":"이기다","primary":"주요한/일차의","cancer":"암","numbers":"숫자(복수)","reason":"이유","tool":"도구/연장","spring":"봄/용수철","answer":"대답(하다)","voice":"목소리","friendly":"친절한/우호적인","schedule":"일정/시간표","communication":"의사소통/통신","feature":"특징/특집","bed":"침대","independent":"독립적인","approach":"접근(하다)/방법","brown":"갈색","physical":"신체의/물리적인","operating":"운영의/수술의","hill":"언덕","medicine":"약","deal":"거래/다루다","hold":"잡다/들다","chicago":"시카고","glass":"유리/잔","happy":"행복한","developed":"개발된/선진의","thank":"감사하다","safe":"안전한/금고","unique":"독특한/유일한","survey":"조사/설문","prior":"이전의/우선하는","telephone":"전화","sport":"스포츠/운동","ready":"준비된","feed":"먹이다","animal":"동물","mexico":"멕시코","population":"인구","regular":"규칙적인/보통의","secure":"안전한/확보하다","navigation":"항해/길찾기","ass":"엉덩이/당나귀","simply":"단순히","station":"역/정거장","christian":"기독교의/기독교인","round":"둥근/회전","understand":"이해하다","option":"선택(권)","master":"주인/석사","recently":"최근에","probably":"아마도","sea":"바다","blood":"피","cut":"자르다","worldwide":"전 세계적인","publisher":"출판사/발행인","hall":"홀/복도","anti":"반대(접두어)","earth":"지구/땅","parents":"부모","impact":"영향/충격","transfer":"환승/이체","introduction":"소개/도입","kitchen":"부엌","carolina":"캐롤라이나","wedding":"결혼식","hospital":"병원","ground":"땅/바닥","ship":"배","accommodation":"숙박/숙소","paid":"지불했다","italy":"이탈리아","perfect":"완벽한","hair":"머리카락","kit":"도구 세트/키트","classic":"고전/명작","basis":"기초/근거","command":"명령(하다)/지휘","william":"윌리엄(이름)","express":"표현하다/급행","award":"상(賞)/수여하다","distance":"거리","tree":"나무","peter":"피터(이름)","assessment":"평가","ensure":"보장하다/확실히 하다","thus":"따라서/이렇게","wall":"벽","involved":"관련된","el":"엘(글자)","extra":"추가의","especially":"특히","interface":"인터페이스/접점","pussy":"고양이/(속어)여성기","budget":"예산","ma":"엄마","operation":"수술/작전/운영","selected":"선택된","boy":"소년","amazon":"아마존","beautiful":"아름다운","warning":"경고","horse":"말","vote":"투표(하다)","forward":"앞으로","retail":"소매","directly":"직접/곧장","est":"~이다(불어)/추정","son":"아들","providing":"제공하는/만약 ~라면","rule":"규칙/지배하다","mac":"맥(컴퓨터)","housing":"주택/주거","bring":"가져오다","trying":"노력하는","mother":"어머니","considered":"고려된/~로 여겨지는","traffic":"교통","input":"입력","strategy":"전략","agent":"요원/대리인","bin":"통/쓰레기통","modern":"현대의","senior":"연장자/선임의","ireland":"아일랜드","teaching":"가르치기/교육","door":"문","grand":"웅장한","trial":"재판/시험","charge":"요금/청구하다","canadian":"캐나다의","cool":"멋진/시원한","normal":"정상의","enterprise":"기업/사업","entire":"전체의","educational":"교육의","md":"의학박사/메릴랜드","leading":"선두의/주요한","metal":"금속","positive":"긍정적인","fitness":"체력/적합성","chinese":"중국의/중국어","opinion":"의견","asia":"아시아","football":"축구/미식축구","abstract":"추상적인/요약","output":"산출/출력","employees":"직원(복수)","responsibility":"책임","resolution":"해상도/결의/해결","java":"자바","guest":"손님","publication":"출판(물)","pass":"통과하다/건네다","trust":"신뢰하다","van":"승합차","session":"세션/회기","multi":"다수의(접두어)","photography":"사진술/사진 촬영","republic":"공화국","vacation":"휴가/방학","century":"세기","academic":"학업의/학문의","skin":"피부","graphics":"그래픽/도표","indian":"인도의/인디언","ring":"반지/울리다","grade":"등급/성적","dating":"데이트/연대 측정","pop":"펑(소리)/팝","filter":"필터/거르다","mailing":"우편 발송","vehicle":"차량/수단","consider":"고려하다","northern":"북쪽의","panel":"패널/판/위원단","floor":"바닥/층","german":"독일의/독일어","buying":"구매","match":"성냥/경기/어울리다","require":"요구하다/필요로 하다","iraq":"이라크","outdoor":"야외의","deep":"깊은","morning":"아침","otherwise":"그렇지 않으면","rest":"휴식/나머지","plant":"식물/공장/심다","hit":"치다","transportation":"교통/운송","pool":"수영장/웅덩이","mini":"소형의/미니","politics":"정치","partner":"파트너/동반자","faculty":"교수진/학부/능력","fish":"물고기","membership":"회원(자격)","mission":"임무","eye":"눈","string":"끈/문자열","sense":"감각/의미","pack":"싸다/꾸러미","stage":"무대/단계","internal":"내부의","unless":"~하지 않으면","richard":"리처드(이름)","japanese":"일본의/일본어","race":"경주/인종","background":"배경","target":"목표/표적","character":"성격/등장인물","maintenance":"유지/관리","ed":"교육(약자)/편집","moving":"움직이는/감동적인","pretty":"예쁜/꽤","southern":"남쪽의","yourself":"너 자신","winter":"겨울","rape":"강간","battery":"배터리/건전지","youth":"청년/젊음","pressure":"압력","debt":"빚/부채","television":"텔레비전","interested":"관심 있는","core":"핵심/중심","break":"부수다/휴식","dance":"춤추다","wood":"나무/목재","itself":"그 자체","studio":"작업실/스튜디오","reader":"독자/읽는 기기","device":"장치/기기","rent":"임대료/빌리다","remote":"먼/원격의/리모컨","dark":"어두운","programming":"프로그래밍/편성","external":"외부의","apple":"사과","instructions":"지시/설명","theory":"이론","remove":"제거하다/없애다","surface":"표면","minimum":"최소(의)","host":"주최자/주인","variety":"다양성/종류","isbn":"국제표준도서번호","martin":"마틴(이름)","manual":"설명서/수동의","block":"막다/블록","repair":"수리(하다)","fair":"공정한/박람회","civil":"시민의/민간의","steel":"강철","understanding":"이해","fixed":"고정된/수리된","wrong":"틀린","beginning":"시작","finally":"마침내","paris":"파리","capacity":"용량/수용력","jersey":"운동복/저지","fat":"뚱뚱한/지방","fully":"완전히","father":"아버지","saw":"보았다","driver":"운전사","dead":"죽은","respect":"존중(하다)","unknown":"알려지지 않은/미지의","restaurant":"식당","trip":"여행","worth":"~의 가치가 있는","poor":"가난한/불쌍한","teacher":"선생님","eyes":"눈(복수)","relationship":"관계","farm":"농장","georgia":"조지아","peace":"평화","traditional":"전통적인","campus":"캠퍼스/교정","tom":"톰(이름)","showing":"보여주기/상영","creative":"창의적인","coast":"해안","benefit":"이익/혜택","progress":"진행/진보","lord":"주님/영주","grant":"보조금/허가하다","sub":"잠수함/대체(접두어)","agree":"동의하다","hear":"듣다","sometimes":"가끔","beyond":"~너머","led":"이끌었다/LED","museum":"박물관","themselves":"그들 자신","fan":"팬/선풍기","transport":"운송/수송하다","interesting":"흥미로운","wife":"아내","evaluation":"평가","former":"이전의","ten":"열","complex":"복잡한/단지","cat":"고양이","die":"죽다","jack":"잭","flat":"평평한/아파트","flow":"흐름/흐르다","literature":"문학/문헌","respective":"각각의","michigan":"미시간","columbia":"컬럼비아","setting":"설정/배경","scale":"규모/저울/비늘","stand":"서다","economy":"경제/절약","monthly":"매월의","critical":"비판적인/중대한","frame":"틀/액자/프레임","musical":"음악의/뮤지컬","secretary":"비서","networking":"인맥 쌓기/네트워킹","bottom":"맨 아래/바닥","detail":"세부 사항","pet":"애완동물","colorado":"콜로라도","royal":"왕실의","clean":"깨끗한/청소하다","switch":"스위치/바꾸다","guy":"남자/녀석","relevant":"관련된/적절한","justice":"정의","connect":"연결하다","cup":"컵","basket":"바구니","weekly":"매주의","installation":"설치","suite":"스위트룸/세트","square":"정사각형/광장","attention":"주의/관심","advance":"전진/발전/선불","skip":"건너뛰다","diet":"식단/다이어트","auction":"경매","gear":"기어/장비","lee":"리(이름)","correct":"맞는/고치다","nation":"국가","selling":"판매","lots":"많음","piece":"조각","sheet":"시트/한 장/이불","firm":"회사/단단한","seven":"일곱","illinois":"일리노이","jump":"뛰다","module":"모듈/단위","resort":"리조트/휴양지","facility":"시설/설비","random":"무작위의","fashion":"패션/유행","documentation":"문서(화)/서류","monitor":"모니터/감시하다","forest":"숲","coverage":"보도/보장 범위","couple":"커플/한 쌍","chance":"기회","vision":"시력/비전","ball":"공","listen":"듣다","discuss":"논의하다","automotive":"자동차의","naked":"벌거벗은","goal":"목표/골","successful":"성공한","wind":"바람","clinical":"임상의","publishing":"출판(업)","appear":"나타나다/~처럼 보이다","emergency":"응급/비상","developing":"개발 중인/발전하는","currency":"통화/화폐","leather":"가죽","temperature":"온도/체온","palm":"손바닥/야자수","historical":"역사의/역사적인","stone":"돌","bob":"밥(이름)","satellite":"위성","fit":"맞다/건강한","village":"마을","ex":"전(前)~/예전의","pain":"고통","coffee":"커피","cum":"~을 겸한","buyer":"구매자","cultural":"문화의","easily":"쉽게","ford":"포드/(강을)건너다","poster":"포스터","edge":"가장자리/모서리","functional":"기능적인","root":"뿌리/근원","closed":"닫힌","ice":"얼음","pink":"분홍색","zealand":"질랜드(뉴질랜드)","balance":"균형/잔액","graduate":"졸업하다/대학원생","shot":"총격/샷","architecture":"건축(술)","initial":"처음의/이니셜","label":"라벨/상표","sec":"초(秒)/증권거래위","recommend":"추천하다","canon":"규범/정전/캐논","hardcore":"강경한/하드코어","waste":"낭비하다","bus":"버스","provider":"제공자/공급자","optional":"선택적인","dictionary":"사전","cold":"차가운/추운","accounting":"회계","chair":"의자","fishing":"낚시","effort":"노력","bag":"가방/봉지","fantasy":"환상/공상","motor":"모터/엔진","professor":"교수","context":"문맥/맥락","shirt":"셔츠","apparel":"의류","foot":"발","mass":"질량/대량","crime":"범죄","count":"세다","breast":"가슴/유방","johnson":"존슨(이름)","quickly":"빨리","religion":"종교","claim":"주장하다/청구(하다)","driving":"운전","surgery":"수술","patch":"조각/패치/헝겊","heat":"열/더위","wild":"야생의","generation":"세대","kansas":"캔자스","miss":"그리워하다/놓치다","task":"일/과제","reduce":"줄이다/감소시키다","himself":"그 자신","nor":"~도 아닌","enable":"가능하게 하다","exercise":"운동/연습","bug":"벌레/버그","leader":"지도자","diamond":"다이아몬드","israel":"이스라엘","soft":"부드러운","alone":"혼자","flight":"비행/항공편","congress":"의회/국회","fuel":"연료","walk":"걷다","fuck":"(욕설)젠장","pocket":"주머니","saint":"성인(聖人)","rose":"장미","freedom":"자유","competition":"경쟁/대회","joint":"관절/공동의","premium":"고급의/할증금","fresh":"신선한","upgrade":"업그레이드/향상","di":"디","factor":"요인/인수","thousands":"수천","stream":"개울/흐름/스트림","pick":"고르다/집다","hearing":"청문회/듣기","signed":"서명한/부호 있는","upper":"위쪽의/상부의","prime":"주요한/최고의/소수","louis":"루이스(이름)","bondage":"속박/구속","informed":"정보에 근거한/아는","creek":"개울/시내","urban":"도시의","essential":"필수적인/본질적인","myself":"나 자신","platform":"승강장","load":"짐/싣다","immediately":"즉시","nursing":"간호","defense":"방어/수비","designated":"지정된","heavy":"무거운","covered":"덮인/보장되는","recovery":"회복/복구","joe":"조(이름)","integrated":"통합된","configuration":"구성/배치","cock":"수탉/(속어)음경","merchant":"상인","comprehensive":"포괄적인/종합적인","expert":"전문가","universal":"보편적인/전체의","drop":"떨어뜨리다/방울","solid":"고체의/단단한","presentation":"발표/제시","orange":"오렌지/주황색","compliance":"준수/따름","theme":"주제/테마","rich":"부유한","campaign":"캠페인/운동","marine":"해양의/해병","improvement":"개선/향상","guitar":"기타","porno":"포르노","challenge":"도전","acceptance":"수락/받아들임","seem":"~인 것 같다","touch":"만지다","hire":"고용하다/빌리다","suggest":"제안하다/암시하다","serve":"제공하다/봉사하다","mount":"오르다/설치하다/산","smart":"똑똑한","latin":"라틴어/라틴의","avoid":"피하다","certified":"공인된/증명된","manage":"관리하다/해내다","corner":"모퉁이/구석","rank":"순위/계급","oregon":"오리건","element":"요소/원소","birth":"출생/탄생","virus":"바이러스","abuse":"학대/남용","interactive":"상호작용의/쌍방향의","quarter":"4분의 1/분기","racing":"경주/레이싱","religious":"종교의","breakfast":"아침식사","column":"기둥/칼럼/열(列)","faith":"믿음/신앙","chain":"사슬/체인","avenue":"대로/거리","missing":"사라진/그리운","domestic":"국내의/가정의","comparison":"비교","mental":"정신의/마음의","moment":"순간","extended":"확장된/연장된","inch":"인치","attack":"공격(하다)","sorry":"미안한","opening":"개방/개막/공석","damage":"손해/피해","lab":"실험실","reserve":"예약하다","plastic":"플라스틱/성형의","snow":"눈","counter":"계산대/반대하다","failure":"실패","dollar":"달러","camp":"캠프/야영","ontario":"온타리오","automatically":"자동으로","bridge":"다리/브리지","native":"토박이의/원주민","fill":"채우다","movement":"움직임/운동","printing":"인쇄","baseball":"야구","owned":"소유한","draft":"초안/징병/외풍","chart":"도표/차트","jesus":"예수","adventure":"모험","matching":"어울리는/일치","offering":"제공물/헌금","profit":"이익/수익","variable":"변수/변하는","ave":"거리(약자)/만세","advertisement":"광고","parking":"주차","yesterday":"어제","determined":"단호한/결정된","wholesale":"도매","workshop":"작업장/워크숍","russia":"러시아","gone":"가버린","extension":"연장/확장/내선","golden":"황금의","completely":"완전히","lighting":"조명","funny":"웃긴","gene":"유전자","portable":"휴대용의","tried":"시도했다","returned":"돌아온/반환된","pattern":"패턴/무늬","boat":"보트/배","named":"~라는 이름의","laser":"레이저","sponsor":"후원자/스폰서","classical":"고전의/클래식","icon":"아이콘/우상","dedicated":"헌신적인/전용의","indiana":"인디애나","direction":"방향","basketball":"농구","evening":"저녁","assembly":"조립/의회/집회","nuclear":"핵의/원자력의","mouse":"쥐/마우스","signal":"신호","criminal":"범죄자","sexual":"성적인","powerful":"강력한","flower":"꽃","felt":"느꼈다","personnel":"인원/인사부","passed":"지나갔다/합격했다","soul":"영혼","promote":"승진시키다/홍보하다","stated":"명시된/진술된","hawaii":"하와이","carry":"나르다/가지고 다니다","flag":"깃발","em":"그들을(them)","advantage":"이점/장점","maintain":"유지하다","tourism":"관광(업)","priority":"우선순위","graphic":"그래픽/생생한","atom":"원자","estimated":"추정된","binding":"구속력 있는/제본","brief":"간단한/짧은","winning":"우승의/이기는","eight":"여덟","anonymous":"익명의","iron":"철/다리미","straight":"곧은/똑바로","script":"대본/스크립트","prepared":"준비된","integration":"통합/적분","dakota":"다코타","interview":"인터뷰/면접","mix":"섞다/혼합","disk":"디스크/원반","queen":"여왕","clearly":"분명히","fix":"고치다","handle":"다루다/손잡이","sweet":"달콤한","desk":"책상","massachusetts":"매사추세츠","vice":"악덕/부(副)","associate":"동료/연관시키다","truck":"트럭","ray":"광선/레이(이름)","frequently":"자주/빈번히","revenue":"수익/세입","measure":"측정하다/조치","duty":"의무/임무","bear":"곰/참다","gain":"얻다/이득","festival":"축제","laboratory":"실험실","ocean":"바다/대양","lack":"부족/결핍","depth":"깊이","iowa":"아이오와","whatever":"무엇이든","logged":"기록된/로그인한","vintage":"빈티지/오래된","train":"기차/훈련하다","exactly":"정확히","dry":"마른/건조한","explore":"탐험하다/탐구하다","concept":"개념","nearly":"거의","eligible":"자격이 있는","reality":"현실","handling":"취급/처리","origin":"기원/출신","billion":"십억","destination":"목적지","dallas":"댈러스","con":"반대/사기","route":"경로/노선","specifications":"사양/명세(복수)","broken":"부서진","frank":"솔직한/프랭크","alaska":"알래스카","zoom":"확대하다/줌","blow":"불다/타격","residential":"주거의","anime":"애니메이션","speak":"말하다","query":"질문/문의","clip":"클립/짧은 영상","partnership":"동반자 관계/제휴","es":"~들(접미)/에스파냐","equity":"공정성/자기자본","speech":"연설/말","wire":"전선/철사","rural":"시골의/농촌의","replacement":"교체/대체(품)","tape":"테이프","strategic":"전략적인","judge":"판사/판단하다","economics":"경제학","cent":"센트","fight":"싸우다","apartment":"아파트","height":"높이/키","null":"무효의/영(零)","zero":"영/제로","speaker":"연설자/스피커","gb":"기가바이트/영국","netherlands":"네덜란드","obtain":"얻다/획득하다","designer":"디자이너/설계자","remain":"남다/여전히 ~이다","marriage":"결혼","roll":"구르다/말다","korea":"한국","secret":"비밀","bath":"목욕/욕조","negative":"부정적인","austin":"오스틴","theater":"극장/연극","missouri":"미주리","andrew":"앤드루(이름)","translation":"번역","injury":"부상/상해","mt":"산(약자)/마운트","joseph":"조셉(이름)","ministry":"부처/장관직","lawyer":"변호사","proposal":"제안/청혼","sharing":"공유/나눔","waiting":"기다리는","beta":"베타","fail":"실패하다","banking":"은행업","toward":"~쪽으로/~향해","assist":"돕다/도움","contained":"포함된/억제된","lingerie":"란제리/여성속옷","legislation":"법률/입법","calling":"부르는/전화하는","jazz":"재즈","serving":"제공/1인분","miami":"마이애미","comics":"만화(복수)","postal":"우편의","tennessee":"테네시","wear":"입다","breaking":"부수는/속보","combined":"결합된/합친","wales":"웨일스","representative":"대표(자)/대리인","frequency":"빈도/주파수","minor":"작은/사소한/미성년자","finish":"끝내다","noted":"유명한/주목된","mom":"엄마","reduced":"줄어든/할인된","physics":"물리학","rare":"드문/희귀한","extreme":"극단적인/극심한","daniel":"다니엘(이름)","row":"줄/열/노 젓다","removed":"제거된","cycle":"주기/순환/자전거","contain":"포함하다/담다","dual":"이중의/둘의","rise":"오르다/상승","sleep":"자다","pharmacy":"약국","brazil":"브라질","creation":"창조/창작물","static":"정적인/고정된","scene":"장면","hunter":"사냥꾼","lady":"여성/숙녀","crystal":"수정/결정","writer":"작가/글쓴이","chairman":"의장/회장","oklahoma":"오클라호마","drink":"마시다/음료","academy":"학원/학술원","dynamic":"역동적인/동적인","eat":"먹다","agriculture":"농업","cleaning":"청소","practical":"실용적인/실제적인","infrastructure":"기반 시설","exclusive":"독점적인/배타적인","seat":"좌석","color":"색","vendor":"판매자/노점상","originally":"원래/처음에","philosophy":"철학","reduction":"감소/축소","aim":"목표(하다)/겨누다","nutrition":"영양","recording":"녹음","junior":"손아래의/하급의","toll":"통행료/사상자","cape":"곶/망토","tip":"팁/조언","secondary":"이차적인/중등의","henry":"헨리(이름)","ticket":"표/티켓","agreed":"동의했다","ski":"스키","math":"수학","import":"수입(하다)","presence":"존재/참석","instant":"즉각적인/순간","automatic":"자동의","viewing":"관람/시청","majority":"다수/과반수","connected":"연결된","dan":"댄(이름)","austria":"오스트리아","ahead":"앞으로","participation":"참여","utility":"유용성/공공설비","preview":"미리보기/예고편","fly":"날다/파리","manner":"방식/태도","matrix":"행렬/매트릭스","combination":"조합/결합","strength":"힘/강점","turkey":"칠면조/터키","delta":"삼각주/델타","fear":"두려움","phoenix":"피닉스/불사조","convention":"대회/관례","principal":"교장/원금","daughter":"딸","standing":"서있는","voyeur":"관음증자","comfort":"편안함/위안","alpha":"알파/첫째","appeal":"호소/항소/매력","cruise":"유람선 여행/순항","bonus":"보너스/상여금","certification":"증명/인증","beat":"때리다/이기다","household":"가정/세대","smoking":"흡연","alabama":"앨라배마","tea":"차(茶)","achieve":"달성하다/이루다","dealer":"딜러/판매상","contemporary":"현대의/동시대의","sky":"하늘","utah":"유타","nearby":"근처의","rom":"롬/읽기전용메모리","exposure":"노출","hide":"숨기다","signature":"서명","gambling":"도박","refer":"언급하다/참조하다","miller":"방앗간 주인/밀러","provision":"공급/조항","clothes":"옷","luxury":"사치(품)/호화","viagra":"비아그라","certainly":"확실히","newspaper":"신문","circuit":"회로/순회","layer":"층/겹","printed":"인쇄된","slow":"느린","removal":"제거/철거","hip":"엉덩이/멋진","nine":"아홉","kentucky":"켄터키","spot":"점/장소/발견하다","spend":"쓰다(돈/시간)","factory":"공장","interior":"내부/실내(의)","grow":"자라다","promotion":"승진/홍보","relative":"친척/상대적인","clock":"시계","dot":"점","identity":"정체성/신원","conversion":"전환/변환","feeling":"느낌/감정","reasonable":"합리적인/적당한","relief":"안도/구호","revision":"수정/개정","broadband":"광대역/초고속","influence":"영향(력)","rain":"비","dsl":"디지털 가입자 회선","planet":"행성","recipe":"조리법/레시피","permit":"허가(하다)/허가증","dna":"디엔에이/유전자","tennis":"테니스","bass":"베이스/농어","bedroom":"침실","instance":"사례/경우","hole":"구멍","ride":"타다","licensed":"면허가 있는/허가된","specifically":"구체적으로/특별히","bureau":"사무국/안내소","represent":"대표하다/나타내다","conservation":"보존/보호","pair":"한 쌍/짝","ideal":"이상적인/이상","recorded":"기록된/녹음된","don":"하지 않다(don't)","dinner":"저녁식사","stress":"스트레스/강조","cream":"크림","yeah":"응/그래","fourth":"네번째","marketplace":"시장/장터","evil":"사악한","aware":"알고 있는/인식하는","wilson":"윌슨(이름)","shape":"모양/형태","evolution":"진화","concerned":"걱정하는/관련된","operator":"운영자/교환원","generic":"일반의/포괄적인","usage":"사용(법)/용법","cap":"모자/뚜껑","ink":"잉크","continuing":"계속되는","census":"인구 조사","interracial":"인종 간의","competitive":"경쟁적인/경쟁력 있는","exist":"존재하다","wheel":"바퀴","transit":"운송/통과","salt":"소금","compact":"소형의/조밀한","poetry":"시(詩)","lights":"빛/조명(복수)","angel":"천사","bell":"종","preparation":"준비","width":"너비/폭","noise":"소음","forget":"잊다","array":"배열/집합","elizabeth":"엘리자베스(이름)","pin":"핀","alcohol":"술/알코올","greek":"그리스의/그리스어","instruction":"지시/설명","managing":"관리하는/경영하는","sister":"여자형제","raw":"날것의/가공하지 않은","walking":"걷는","explain":"설명하다","establish":"설립하다/확립하다","sharp":"날카로운","lane":"차선/좁은 길","paragraph":"문단/단락","kill":"죽이다","mathematics":"수학","compensation":"보상(금)","export":"수출(하다)","sweden":"스웨덴","conflict":"갈등/충돌","percentage":"백분율/비율","concern":"걱정/관심사","backup":"백업/지원","connecticut":"코네티컷","heritage":"유산","immediate":"즉각적인/직접의","holding":"잡고 있는","trouble":"문제/곤란","spread":"퍼뜨리다/펼치다","coach":"코치/감독","expand":"확장하다/넓히다","supporting":"지지하는/보조의","jordan":"요르단/조던","plug":"플러그/마개","cook":"요리하다/요리사","affect":"영향을 미치다","virgin":"처녀/순수한","experienced":"경험 많은/노련한","investigation":"수사/조사","raised":"올린/기른","hat":"모자","institution":"기관/제도","directed":"감독된/지시된","sporting":"스포츠의","helping":"돕는","lib":"해방운동(약자)","plate":"접시/판","blonde":"금발의","transmission":"전송/변속기","lose":"잃다/지다","organic":"유기농의/유기의","extremely":"극도로/매우","equivalent":"동등한/맞먹는","chemistry":"화학","tony":"토니(이름)","neighborhood":"동네/이웃","nevada":"네바다","thailand":"태국","anyway":"어쨌든","cam":"캠/카메라","logic":"논리(학)","template":"틀/견본/템플릿","prince":"왕자","circle":"원/동그라미","soil":"흙/토양","anywhere":"어디든","psychology":"심리학","atlantic":"대서양의","wet":"젖은","circumstances":"상황/사정","investor":"투자자","identification":"신원 확인/신분증","ram":"숫양/램(메모리)","leaving":"떠나는","elementary":"초보의/초등의","cooking":"요리","speaking":"말하는","fox":"여우","respond":"응답하다/반응하다","plain":"평범한/명백한/평원","exit":"출구","arm":"팔","launch":"출시하다/발사하다","wave":"파도/물결/흔들다","costa":"코스타","printable":"인쇄 가능한","holy":"신성한","mesh":"그물망","trail":"오솔길/자취","highway":"고속도로","dean":"학장/주임","setup":"설정/구성","poll":"여론조사/투표","booking":"예약","glossary":"용어 사전","fiscal":"재정의/회계의","denver":"덴버","unix":"유닉스","bond":"유대/채권/결합","notify":"알리다/통지하다","blues":"블루스/우울","chocolate":"초콜릿","pub":"술집/펍","portion":"부분/1인분","hampshire":"햄프셔","supplier":"공급자/납품업체","cotton":"면/목화","requirement":"요구 사항/필요조건","biology":"생물학","dental":"치과의/치아의","border":"국경/경계","ancient":"고대의/오래된","debate":"토론/논쟁","arkansas":"아칸소","notebook":"공책/노트북","explorer":"탐험가/탐색기","historic":"역사적인","husband":"남편","disabled":"장애가 있는/비활성화된","authorized":"승인된/권한 있는","crazy":"미친","britain":"영국","concert":"콘서트","retirement":"은퇴/퇴직","efficiency":"효율(성)","sp":"특수(약자)","comedy":"코미디/희극","linear":"선형의/직선의","commitment":"헌신/약속","specialty":"전문/특산물","jean":"진(이름)/청바지","hop":"깡충 뛰다","carrier":"운반자/항공사/보균자","constant":"끊임없는/상수","visa":"비자","mouth":"입","meter":"미터/계량기","gun":"총","reflect":"반사하다/반영하다","deliver":"배달하다/전하다","wonder":"궁금해하다","hell":"지옥","fruit":"과일","qualified":"자격 있는/적격의","reform":"개혁(하다)","lens":"렌즈","discovery":"발견","draw":"그리다/끌다/무승부","classified":"분류된/기밀의","assume":"추측하다/가정하다","confidence":"자신감/신뢰","alliance":"동맹/연합","confirm":"확인하다/확정하다","warm":"따뜻한","neither":"둘 다 아닌","leaves":"잎(복수)/떠나다","engineer":"기술자/공학자","lifestyle":"생활 방식","consistent":"일관된/일치하는","clearance":"정리/허가","inventory":"재고/목록","converter":"변환기","suck":"빨다/형편없다","babe":"아기/(애칭)자기","reached":"도달한/연락된","safari":"사파리","objective":"목표/객관적인","sugar":"설탕","crew":"승무원/팀","stick":"막대기/붙다","securities":"증권/유가증권","relation":"관계/관련","genre":"장르/유형","slide":"미끄러지다/슬라이드","volunteer":"자원봉사자/자원하다","tested":"검증된/시험된","rear":"뒤(쪽의)/기르다","democratic":"민주적인","switzerland":"스위스","bound":"~할 수밖에 없는/묶인","parameter":"매개변수/한도","adapter":"어댑터/접속기","processor":"처리장치/프로세서","node":"교점/노드","contribute":"기여하다/기부하다","lock":"잠그다/자물쇠","hockey":"하키","storm":"폭풍","micro":"미세한/마이크로","mile":"마일","bowl":"그릇/사발","supreme":"최고의","recognition":"인식/인정","ref":"심판/참조","tank":"탱크/수조","submission":"제출/복종","estimate":"추정(하다)/견적","encourage":"격려하다/장려하다","navy":"해군/남색","kid":"아이","regulatory":"규제의","inspection":"검사/점검","cancel":"취소하다","territory":"영토/지역","transaction":"거래/처리","manchester":"맨체스터","paint":"페인트/그리다","delay":"지연","pilot":"조종사/시범의","continuous":"연속적인/끊임없는","czech":"체코의","cambridge":"케임브리지","initiative":"주도(권)/계획","novel":"소설/참신한","pan":"냄비/팬","execution":"실행/처형","winner":"승자/우승자","idaho":"아이다호","contractor":"계약자/도급업자","ph":"피에이치/산도","episode":"에피소드/사건","potter":"도공/포터","dish":"접시/요리","ia":"아이오와(약자)","oxford":"옥스퍼드","adam":"아담(이름)","painting":"그림/회화","committed":"헌신적인/저지른","extensive":"광범위한/대규모의","affordable":"저렴한/감당할 수 있는","universe":"우주","patent":"특허","slot":"슬롯/구멍/자리","ha":"하!","eating":"먹는","perspective":"관점/원근법","lodge":"오두막/제출하다","messenger":"전령/메신저","tournament":"토너먼트/경기","consideration":"고려/배려","ds":"닌텐도DS/예탁증서","kernel":"핵심/낟알/커널","gray":"회색","catalogue":"카탈로그/목록","ea":"각각(약자)/EA","charged":"충전된/기소된","broad":"넓은","taiwan":"대만","chosen":"선택된","demo":"시연/데모","greece":"그리스","swiss":"스위스의","sarah":"사라(이름)","labor":"노동/진통","hate":"미워하다","terminal":"터미널/말기의","caribbean":"카리브해의","liquid":"액체/유동의","rice":"쌀/밥","nebraska":"네브래스카","loop":"고리/순환","reservation":"예약","gourmet":"미식가/고급의","guard":"경비/지키다","properly":"제대로/적절히","saving":"절약/저축","empire":"제국","resume":"이력서/재개하다","twenty":"스물","raise":"올리다/키우다","illegal":"불법의","vary":"다양하다/달라지다","hundreds":"수백","rome":"로마","arab":"아랍의/아랍인","lincoln":"링컨","premier":"최고의/총리","tomorrow":"내일","milk":"우유","consent":"동의/허락","drama":"드라마/극","visiting":"방문하는","performing":"공연하는/수행하는","downtown":"시내/번화가","keyboard":"키보드/건반","contest":"대회/경연","collected":"수집된/침착한","boot":"부츠/장화","suitable":"적합한/알맞은","ff":"이하 참조(약자)","absolutely":"절대적으로","lunch":"점심","audit":"회계 감사","push":"밀다","chamber":"방/의회","guinea":"기니","iso":"국제표준화기구","typical":"전형적인/일반적인","tower":"탑","sum":"합계/금액","calculator":"계산기","chicken":"닭/치킨","temporary":"임시의/일시적인","shower":"샤워/소나기","tonight":"오늘 밤","dear":"친애하는","shell":"껍질/조개","catholic":"가톨릭의","oak":"참나무/오크","vat":"부가가치세/큰 통","awareness":"인식/자각","vancouver":"밴쿠버","governor":"주지사/총독","beer":"맥주","contribution":"기여/기부(금)","measurement":"측정/치수","swimming":"수영","formula":"공식/제조법","constitution":"헌법/구성","solar":"태양의","catch":"잡다","pakistan":"파키스탄","consultation":"상담/협의","northwest":"북서(쪽)","sir":"선생님(남성존칭)","earn":"벌다/얻다","unable":"~할 수 없는","classroom":"교실","democracy":"민주주의","wallpaper":"벽지/배경화면","resistance":"저항","symptoms":"증상(복수)","memorial":"기념의/추모의","visitor":"방문객","twin":"쌍둥이의/한 쌍","insert":"삽입하다/끼우다","drawing":"그림/소묘","charlotte":"샬럿(이름)","ordered":"주문된/정돈된","biological":"생물학의/생물학적인","fighting":"싸우는","transition":"전환/이행","spy":"스파이/염탐하다","romance":"로맨스/연애","instrument":"기구/악기","bruce":"브루스(이름)","split":"나누다/쪼개다","heaven":"천국","pregnant":"임신한","twice":"두 번","classification":"분류","egypt":"이집트","hollywood":"할리우드","cellular":"세포의/휴대폰의","normally":"보통/정상적으로","lo":"보라!(감탄사)","spiritual":"영적인/정신의","diabetes":"당뇨병","suit":"정장/소송","shift":"교대/이동/바꾸다","chip":"칩/조각","sit":"앉다","cutting":"자르기/절단","wow":"와!","flexible":"유연한/융통성 있는","mapping":"지도 제작/매핑","numerous":"수많은","relatively":"비교적/상대적으로","satisfaction":"만족","char":"숯/그을리다","indexed":"색인된/연동된","superior":"우월한/상급의","cartoon":"만화","intellectual":"지적인/지식인","carbon":"탄소","comfortable":"편안한","magnetic":"자석의/자기의","interaction":"상호작용","listening":"듣는","effectively":"효과적으로/사실상","registry":"등록(소)","crisis":"위기","massive":"거대한/대규모의","denmark":"덴마크","employed":"고용된","bright":"밝은/똑똑한","treat":"대하다/대접하다","header":"머리글/헤더","piano":"피아노","echo":"메아리/울림","grid":"격자/전력망","experimental":"실험적인","revolution":"혁명","plasma":"혈장/플라스마","mystery":"미스터리/수수께끼","mechanical":"기계적인/기계의","journey":"여행/여정","applicant":"지원자/신청자","charter":"헌장/전세 내다","fig":"무화과/그림(약자)","acquisition":"인수/획득","notification":"알림/통지","teach":"가르치다","rapid":"빠른/신속한","pull":"당기다","hairy":"털이 많은","reverse":"뒤집다/반대의/후진","deposit":"보증금/예금","seminar":"세미나","nasa":"미 항공우주국","specify":"명시하다/구체화하다","tab":"탭/계산서","boots":"부츠","router":"라우터/공유기","poland":"폴란드","folder":"폴더/서류철","completion":"완성/완료","pulse":"맥박","technique":"기법/기술","alexander":"알렉산더(이름)","broadcast":"방송(하다)","converted":"전환된/개조된","anniversary":"기념일","strip":"벗기다/긴 조각","specification":"사양/명세","pearl":"진주","nick":"닉(이름)","accessible":"접근하기 쉬운/이용 가능한","accessory":"부속품/액세서리","resident":"거주자/주민","possibly":"아마/혹시","airline":"항공사","typically":"일반적으로/보통","representation":"표현/대표","regard":"여기다/관련/안부","pump":"펌프/퍼올리다","smooth":"부드러운/매끄러운","strike":"치다/파업","consumption":"소비/소모","birmingham":"버밍엄","flashing":"번쩍이는","lp":"엘피판/장시간 음반","narrow":"좁은","sitting":"앉아있는","consultant":"컨설턴트/상담가","controller":"관리자/제어기","ownership":"소유(권)","vietnam":"베트남","trailer":"예고편/트레일러","malaysia":"말레이시아","antique":"골동품/고풍의","willing":"기꺼이 하는","bio":"생물의/약력","logos":"로고(복수)/이성","residence":"거주(지)/주택","density":"밀도","hundred":"백(100)","strange":"이상한","statistical":"통계의/통계적인","mention":"언급하다","innovation":"혁신/쇄신","parallel":"평행의/유사한","operate":"작동하다/운영하다/수술하다","bathroom":"화장실","stable":"안정된/마구간","opera":"오페라/가극","cinema":"영화(관)","asset":"자산/재산","scan":"훑어보다/스캔하다","drinking":"마시는","reaction":"반응","blank":"빈/공백","enhanced":"향상된/강화된","deluxe":"고급의/호화로운","humor":"유머/익살","aged":"나이 든/숙성된","bulk":"부피/대량","successfully":"성공적으로","indonesia":"인도네시아","fabric":"천/직물/구조","tight":"꽉 끼는/단단한","contrast":"대조/대비","recommendation":"추천/권고","flying":"나는","recruitment":"채용/모집","sin":"죄","cute":"귀여운","siemens":"지멘스","adoption":"입양/채택","expensive":"비싼","capture":"포획하다/포착하다","buffalo":"버팔로/물소","plane":"비행기","pg":"전체관람가","seed":"씨앗","desire":"욕망/바람","expertise":"전문 지식","mechanism":"기제/구조","camping":"캠핑/야영","welfare":"복지","peer":"또래/동등한 사람","eventually":"결국/마침내","marked":"표시된/뚜렷한","measured":"측정된/신중한","bottle":"병","innovative":"혁신적인","massage":"마사지/안마","rubber":"고무","conclusion":"결론/마무리","closing":"마감/폐점","thousand":"천(1000)","meat":"고기","legend":"전설","grace":"우아함/은총","ing":"~ing(접미사)","python":"파이썬/비단뱀","monster":"괴물","bang":"쾅/탕","bone":"뼈","collaboration":"협업/공동작업","detection":"발견/탐지","inner":"내부의/안쪽의","formation":"형성/대형","tutorial":"지침서/개별지도","gate":"탑승구/문","settlement":"정착(지)/합의","portugal":"포르투갈","roman":"로마의/로마인","valuable":"귀중한/값진","erotic":"선정적인/관능적인","tone":"어조/음색","ethics":"윤리(학)","forever":"영원히","dragon":"용","busy":"바쁜","captain":"선장/대위","imagine":"상상하다","leg":"다리","neck":"목","wing":"날개","abc":"기초/알파벳","stereo":"스테레오/입체음향","appointed":"임명된/정해진","taste":"맛(보다)","commit":"저지르다/약속하다/전념하다","operational":"운영상의/가동되는","rail":"철도/난간","liberal":"자유주의의/진보적인","gap":"틈/격차","tube":"관/튜브/지하철","cache":"저장소/캐시","belt":"벨트/허리띠","jacket":"재킷","animation":"애니메이션","oracle":"신탁/오라클","er":"어...","lease":"임대(차)","aviation":"항공(술)","proud":"자랑스러운","excess":"초과/과잉","console":"콘솔/위로하다","telecommunications":"통신/전기통신","instructor":"강사/교관","biz":"사업(약자)","voltage":"전압","anthony":"앤서니(이름)","usual":"평소의/보통의","franklin":"프랭클린(이름)","angle":"각도","vinyl":"비닐","highlights":"하이라이트/강조점","mining":"광업/채굴","melbourne":"멜버른","worst":"최악의","liberty":"자유","blackjack":"블랙잭","argentina":"아르헨티나","convert":"전환하다/개종하다","possibility":"가능성","analyst":"분석가","commissioner":"위원/국장","dangerous":"위험한","garage":"차고/정비소","exciting":"흥미진진한/신나는","reliability":"신뢰성","unfortunately":"불행히도/유감스럽게도","attachment":"첨부(물)/애착","finland":"핀란드","derived":"파생된/유래한","honor":"명예","eagle":"독수리","pants":"바지","columbus":"콜럼버스","nurse":"간호사","prayer":"기도","hurricane":"허리케인/태풍","quiet":"조용한","producer":"생산자/제작자","dial":"다이얼/전화 걸다","cheese":"치즈","comic":"만화의/희극의","carefully":"조심스럽게","jet":"제트기/분출","productivity":"생산성","crown":"왕관","par":"동등/(골프)기준 타수","underground":"지하의","diagnosis":"진단","crack":"금/갈라지다","principle":"원칙/원리","gang":"패거리/갱","calculated":"계산된/의도적인","fetish":"집착/페티시","smoke":"연기/담배 피우다","apache":"아파치","incorporated":"법인의/합병된","craft":"공예/기술","cake":"케이크","fellow":"동료/녀석","blind":"눈먼","lounge":"라운지/휴게실","algorithm":"알고리즘","semi":"반(半)(접두어)","gross":"총(總)/역겨운","strongly":"강하게/강력히","cafe":"카페/찻집","valentine":"밸런타인/연인","horror":"공포/끔찍함","familiar":"익숙한/친숙한","till":"~까지","pen":"펜","admission":"입장/입학/인정","shoe":"신발","carrying":"운반하는","sand":"모래","terrorism":"테러(리즘)","joy":"기쁨","ethnic":"민족의/인종의","ran":"달렸다","parliament":"의회/국회","actor":"배우","seal":"봉인하다/물개","fifth":"다섯번째","citizen":"시민","vertical":"수직의/세로의","municipal":"지방자치의/시(市)의","prize":"상(賞)/상품","absolute":"절대적인/완전한","anytime":"언제든지","pipe":"파이프/관","guardian":"보호자/수호자","simulation":"모의실험/시뮬레이션","layout":"배치/레이아웃","ill":"아픈","concentration":"집중/농도","lay":"놓다/눕히다","dirty":"더러운","deck":"갑판/덱","bankruptcy":"파산","worker":"노동자/일꾼","optimization":"최적화","alive":"살아있는","temple":"사원/관자놀이","prove":"증명하다","wings":"날개(복수)","genetic":"유전의/유전적인","promise":"약속(하다)","thin":"얇은/마른","exhibition":"전시(회)","ridge":"산등성이/능선","cabinet":"내각/캐비닛","modem":"모뎀","sick":"아픈","dose":"복용량/투여","tiffany":"티파니","tropical":"열대의","collect":"모으다","bet":"내기하다","composition":"구성/작곡/작문","vector":"벡터/방향량","definitely":"확실히","turning":"도는/전환점","purple":"보라색","existence":"존재","larry":"래리(이름)","immigration":"이민/출입국","pipeline":"송유관/(진행)과정","necessarily":"반드시/필연적으로","syntax":"구문/문법","prison":"감옥","skill":"기술/기량","everyday":"매일의/일상의","popularity":"인기","checked":"확인했다","exhibit":"전시하다/증거물","throw":"던지다","visible":"보이는/눈에 띄는","desert":"사막/버리다","nba":"미국 프로농구","busty":"가슴이 큰","coordinator":"진행자/조정자","obviously":"분명히","mercury":"수은/수성","navigate":"항해하다/길을 찾다","worse":"더 나쁜","summit":"정상(회담)/꼭대기","epa":"미 환경보호청","escape":"탈출하다","somewhat":"다소/약간","receiver":"수신기/받는 사람","substantial":"상당한/실질적인","progressive":"진보적인/점진적인","glance":"흘끗 봄","arcade":"오락실/아케이드","richmond":"리치먼드","impossible":"불가능한","fiber":"섬유","graph":"그래프/도표","covering":"덮개/씌우기","platinum":"백금","judgment":"판단/판결","filing":"서류 정리/제출","foster":"양육하다/조장하다","modeling":"모형 제작/모델 일","passing":"지나가는/합격","memorabilia":"기념품","cartridge":"카트리지/탄약통","alberta":"앨버타","commons":"평민/공유지","cincinnati":"신시내티","subsection":"하위 항목/소절","electricity":"전기","spectrum":"스펙트럼/범위","arrival":"도착","pottery":"도자기","emphasis":"강조","roger":"로저(이름)","aspect":"측면/양상","awesome":"멋진","confirmed":"확인된/확정된","priced":"가격이 매겨진","hist":"역사(약자)","crash":"충돌/추락","lift":"들어올리다/승강기","desired":"바라던/원하는","closer":"더 가까운","shadow":"그림자","riding":"타기/승마","infection":"감염","expense":"비용/지출","eligibility":"자격(여부)","venture":"모험적 사업/벤처","clinic":"병원/진료소","princess":"공주","mall":"쇼핑몰","packet":"꾸러미/(데이터)패킷","involvement":"관여/참여","dad":"아빠","placement":"배치/취업 알선","extend":"연장하다/확장하다","subsequent":"그 다음의/이후의","pat":"토닥이다/팻(이름)","rolling":"구르는","fell":"떨어졌다","nelson":"넬슨(이름)","mayor":"시장(市長)","murder":"살인","senator":"상원의원","presentations":"발표(복수)","cartoons":"만화(복수)","pour":"붓다/쏟다","digest":"소화하다/요약","dust":"먼지","hence":"따라서/그러므로","radar":"레이더","rescue":"구조(하다)","undergraduate":"학부생","combat":"전투/싸우다","reducing":"줄이는/감량","butt":"엉덩이/꽁초","closely":"면밀히/가깝게","radiation":"방사선/복사","diary":"일기(장)","shooting":"촬영/총격","ear":"귀","baker":"제빵사","elsewhere":"다른 곳에서","conservative":"보수적인","shock":"충격","ebony":"흑단/검은색","tie":"넥타이/묶다/동점","ward":"병동/구역/보호","drawn":"그려진/끌린","arthur":"아서(이름)","roof":"지붕","walker":"보행자/보행기/워커","atmosphere":"분위기/대기","kiss":"키스(하다)","beast":"짐승/야수","targets":"목표(복수)/표적","dodge":"피하다/회피","counsel":"조언(하다)/변호사","pizza":"피자","assignment":"과제/배정","gordon":"고든(이름)","rush":"서두르다/돌진","ukraine":"우크라이나","absence":"부재/결석","cluster":"무리/송이","whereas":"~한 반면에","yoga":"요가","surprise":"놀람/놀라게 하다","lamp":"램프/등","partial":"부분적인/편파적인","everybody":"모두","ranking":"순위/등급","palace":"궁전","satisfied":"만족한","glad":"기쁜","verify":"확인하다/입증하다","globe":"지구(본)/세계","copper":"구리/동","milwaukee":"밀워키","rack":"선반/걸이","medication":"약(물)","warehouse":"창고","rep":"담당자/대표(약자)","kerry":"케리(이름)","receipt":"영수증","supposed":"~하기로 되어 있는","ordinary":"평범한/보통의","nobody":"아무도","ghost":"유령","stability":"안정(성)","southwest":"남서(쪽)","boss":"상사/사장","pride":"자부심/긍지","institutional":"기관의/제도적인","independence":"독립","reporter":"기자/리포터","metabolism":"신진대사","champion":"챔피언/우승자","cloudy":"흐린/구름 낀","solo":"독주/단독의","throat":"목구멍","excellence":"탁월함/우수성","tall":"키 큰/높은","somewhere":"어딘가","vacuum":"진공/청소기","dancing":"춤추는","recognize":"알아보다/인정하다","brass":"놋쇠/금관악기","survival":"생존","publish":"출판하다/게재하다","screening":"상영/선별 검사","toe":"발가락","thumbnail":"썸네일/엄지손톱","jonathan":"조너선(이름)","whenever":"~할 때마다/언제든지","lifetime":"평생/일생","pioneer":"개척자/선구자","venue":"장소/개최지","athletic":"운동의/탄탄한","thermal":"열의/보온의","vital":"필수적인/생명의","telling":"말하는","fairly":"꽤/공정하게","charity":"자선","intelligent":"지능적인/똑똑한","edinburgh":"에든버러","obligation":"의무/책임","wake":"깨다","hungary":"헝가리","traveler":"여행자","realize":"깨닫다","regardless":"상관없이/개의치 않고","lan":"근거리 통신망","enemy":"적","puzzle":"퍼즐/수수께끼","rising":"떠오르는/상승하는","aluminum":"알루미늄","insight":"통찰(력)","restricted":"제한된/한정된","republican":"공화당의/공화국의","lucky":"운 좋은","latter":"후자의/후반의","thick":"두꺼운/진한","repeat":"반복하다","syndrome":"증후군","attendance":"출석/참석(자)","penalty":"처벌/벌칙","drum":"드럼/북","glasses":"안경","iraqi":"이라크의","vista":"전망/경치","terry":"테리(이름)","flood":"홍수/범람","ease":"편안함/완화하다","orgy":"난교/흥청망청","arena":"경기장/무대","announcement":"발표/공지","appreciate":"감사하다/감상하다","expanded":"확장된/확대된","casual":"평상시의/격식 없는","polish":"광택(제)/닦다","lovely":"사랑스러운","gm":"제너럴모터스/총감독","jerry":"제리(이름)","smile":"미소(짓다)","indoor":"실내의","bulgaria":"불가리아","charger":"충전기","regularly":"규칙적으로/정기적으로","pine":"소나무","tend":"~하는 경향이 있다/돌보다","gulf":"만(灣)/격차","rick":"릭(이름)","divorce":"이혼","laura":"로라(이름)","shopper":"쇼핑객","tokyo":"도쿄","partly":"부분적으로/일부는","candy":"사탕","tiger":"호랑이","exposed":"노출된/드러난","telecom":"통신(업)","hunt":"사냥(하다)","thai":"태국의/태국어","loaded":"가득 실은/장전된","boost":"북돋우다/증대","spanking":"엉덩이 때리기","scholarship":"장학금/학식","chronic":"만성의","tranny":"트랜지스터/(속어)","moral":"도덕적인/교훈","finger":"손가락","pound":"파운드/세게 두드리다","burn":"태우다/타다","ourselves":"우리 자신","bread":"빵","tobacco":"담배","wooden":"나무로 된/목제의","tough":"힘든/거친","incident":"사건/일","dynamics":"역학/역동성","lie":"거짓말/눕다","conversation":"대화","chest":"가슴/상자","pension":"연금","worship":"숭배/예배","capability":"능력/역량","producing":"생산하는","precision":"정밀/정확","reproduction":"번식/복제","minority":"소수(집단)","sole":"유일한/발바닥","franchise":"가맹점/독점권","recorder":"녹음기/기록자","facing":"마주한","nancy":"낸시(이름)","passion":"열정","rehabilitation":"재활/갱생","sight":"시야/광경","laid":"놓인/낳은","clay":"점토/진흙","weak":"약한","refund":"환불","divided":"나뉜/분할된","reception":"접수처/환영회/수신","wise":"현명한","cyprus":"키프로스","odds":"확률/가능성","insider":"내부자","geography":"지리(학)","integrity":"진실성/온전함","worry":"걱정하다","eve":"전야/이브","carter":"카터(이름)","legacy":"유산","marc":"마크(이름)","danger":"위험","vitamin":"비타민","widely":"널리/폭넓게","phrase":"구절/문구","paradise":"낙원","intermediate":"중간의/중급의","emotional":"감정적인","leaf":"잎","pad":"패드/덧대다","glory":"영광","billing":"청구/대금 청구","diesel":"디젤","versus":"대(對)/~에 맞서","combine":"결합하다/합치다","overnight":"하룻밤 사이의/밤새","rod":"막대/낚싯대","fault":"잘못/결함","cuba":"쿠바","preliminary":"예비의/준비의","introduce":"소개하다/도입하다","silk":"비단/실크","promotional":"홍보의/판촉의","chevrolet":"쉐보레","bi":"양(兩)~/2(접두어)","romantic":"낭만적인","generator":"발전기/생성기","albert":"앨버트(이름)","examine":"검사하다/조사하다","jimmy":"지미(이름)","graham":"그레이엄(이름)","suspension":"정지/매달기/서스펜션","bristol":"브리스틀","sad":"슬픈","wolf":"늑대","slowly":"천천히","communicate":"소통하다/전달하다","rugby":"럭비","supplement":"보충(제)/추가","infant":"유아/아기","samuel":"새뮤얼(이름)","fluid":"액체/유동적인","kick":"차다","hurt":"다치다/아프다","machinery":"기계(류)/조직","bandwidth":"대역폭/처리 능력","equation":"방정식/등식","probability":"확률/가능성","pot":"냄비/항아리","dimension":"차원/치수","warren":"워런(이름)/토끼굴","slip":"미끄러지다/쪽지","studied":"공부한/신중한","reviewer":"평론가/검토자","quarterly":"분기별의/계간지","devil":"악마","grass":"풀/잔디","florist":"꽃집/플로리스트","illustrated":"삽화가 든","cherry":"체리/벚나무","continental":"대륙의","alternate":"번갈아 하다/교대의","kenya":"케냐","funeral":"장례식","pee":"오줌(누다)","quebec":"퀘벡","passenger":"승객","dennis":"데니스(이름)","mars":"화성","socket":"소켓/콘센트","silent":"조용한/침묵의","literary":"문학의","egg":"달걀/알","orientation":"방향/오리엔테이션/성향","pill":"알약","theft":"절도/도둑질","childhood":"어린 시절","swing":"그네/흔들다","lat":"위도(약자)","facial":"얼굴의/안면의","talent":"재능/인재","dated":"날짜가 적힌/구식의","flexibility":"유연성/융통성","seeker":"추구하는 사람","wisdom":"지혜","shoot":"쏘다","mint":"박하/조폐국","offset":"상쇄하다","payday":"월급날","philip":"필립(이름)","spin":"돌다/회전","swedish":"스웨덴의/스웨덴어","jurisdiction":"관할(권)","robot":"로봇","witness":"목격자/증인","powder":"가루/분말","wash":"씻다","entrance":"입구","noble":"고귀한/귀족의","automation":"자동화","rev":"목사(약자)/회전","gospel":"복음","shore":"해안/물가","knight":"기사","loose":"느슨한/풀린","recipient":"수령인/받는 사람","athletics":"운동 경기/육상","southeast":"남동(쪽)","pending":"미결의/임박한","lebanon":"레바논","conditioning":"조절/길들이기","teenage":"십대의","soap":"비누","triple":"세 배의/3루타","cooper":"쿠퍼(이름)/통 만드는 사람","jam":"잼/혼잡","migration":"이주/이동","disorder":"장애/무질서","routine":"일상/루틴","basically":"기본적으로","conventional":"전통적인/재래식의","wearing":"입고 있는","mounted":"올라탄/설치된","habitat":"서식지","scanner":"스캐너","herein":"여기에/이 안에","horny":"흥분한/뿔의","judicial":"사법의/재판의","rio":"리우/강","hero":"영웅","integer":"정수","attitude":"태도/자세","engaged":"약혼한/바쁜","falling":"떨어지는","montreal":"몬트리올","carpet":"카펫/양탄자","genetics":"유전학","difficulty":"어려움/곤란","punk":"펑크/불량배","collective":"집단적인/공동의","pi":"파이/원주율","ai":"인공지능","pace":"속도/보폭","besides":"게다가","wage":"임금","collector":"수집가/징수원","arc":"호(弧)/아크","atlas":"지도책/아틀라스","dawn":"새벽/여명","observation":"관찰/관측","torture":"고문","coat":"외투/코트","mitchell":"미첼(이름)","restoration":"복원/회복","convenience":"편의/편리","container":"용기/컨테이너","confirmation":"확인/확정","embedded":"내장된/박힌","inkjet":"잉크젯","supervisor":"감독자/관리자","wizard":"마법사/달인","corps":"부대/군단","liver":"간(肝)","liable":"~할 책임이 있는/~하기 쉬운","brochure":"안내 책자/브로슈어","petition":"청원/탄원","recall":"기억해내다/회수하다","antenna":"안테나/더듬이","picked":"골랐다","departure":"출발","minneapolis":"미니애폴리스","belief":"믿음/신념","killing":"살인/죽이는","bikini":"비키니","shoulder":"어깨","lookup":"조회/검색","ion":"이온","diameter":"지름/직경","ottawa":"오타와","doll":"인형","tit":"가슴(속어)/박새","peru":"페루","refine":"정제하다/다듬다","bidder":"입찰자","singer":"가수","herald":"전령/예고하다","literacy":"읽고 쓰는 능력","nike":"나이키","intervention":"개입/중재","attraction":"매력/명소/끌림","diving":"다이빙/잠수","alice":"앨리스(이름)","reed":"갈대/리드","involve":"포함하다/관련시키다","moderate":"적당한/온건한","terror":"공포/테러","younger":"더 어린","thirty":"서른","opposite":"반대의/맞은편의","rapidly":"빠르게/급속히","ban":"금지(하다)","temp":"임시 직원/온도(약자)","intro":"도입부/소개","clerk":"점원/사무원","happening":"일어나는","holland":"네덜란드","metropolitan":"대도시의/수도권의","compilation":"모음집/편집","verification":"확인/검증","ent":"이비인후과","odd":"이상한/홀수의","wrap":"감싸다/포장하다","mood":"기분","quiz":"퀴즈/쪽지시험","sigma":"시그마/합","attractive":"매력적인","jefferson":"제퍼슨(이름)","victim":"피해자","sleeping":"자는","beam":"빛줄기/들보","gardening":"원예/정원 가꾸기","orchestra":"오케스트라/관현악단","sunset":"일몰/석양","minimal":"최소의/아주 적은","polyphonic":"다성음의","outsourcing":"외부 위탁/아웃소싱","allocation":"할당/배분","essay":"수필/에세이","discipline":"규율/훈육/학문 분야","dialogue":"대화/대담","declared":"선언된/신고된","aaron":"에런(이름)","handheld":"휴대용의","trace":"흔적/추적하다","shut":"닫다","voluntary":"자발적인/자원의","ncaa":"미국대학체육협회","thou":"너(고어)","consult":"상담하다/참고하다","greatly":"크게/대단히","mask":"마스크/가면","cycling":"자전거 타기","midnight":"자정","commonly":"흔히/일반적으로","photographer":"사진작가","inform":"알리다/통지하다","turkish":"터키의/터키어","coal":"석탄","cry":"울다","intent":"의도/몰두한","largely":"주로/대체로","arrow":"화살(표)","sampling":"표본 추출/시식","rough":"거친","lion":"사자","inspired":"영감을 받은","blade":"칼날/날","suddenly":"갑자기","oxygen":"산소","arrangement":"준비/배열/편곡","bibliography":"참고문헌/서지","pointer":"포인터/지시봉","compatibility":"호환성/궁합","stretch":"늘이다/뻗다","durham":"더럼","furthermore":"게다가/더욱이","cooperative":"협동의/협조적인","cleaner":"청소기/청소부","cricket":"크리켓/귀뚜라미","beef":"소고기","stroke":"뇌졸중/쓰다듬기/타격","township":"읍/구역","robin":"로빈/울새","strap":"끈/띠","sharon":"섀런(이름)","crowd":"군중","surf":"파도타기/서핑","olympic":"올림픽의","transformation":"변형/변신","personality":"성격/개성","rainbow":"무지개","hook":"갈고리/걸다","roulette":"룰렛","decline":"감소(하다)/거절하다","israeli":"이스라엘의","medicare":"노인 의료보험","cord":"끈/줄/코드","skiing":"스키 타기","cloud":"구름","facilitate":"용이하게 하다/촉진하다","subscriber":"가입자/구독자","feelings":"감정(복수)","knife":"칼","jamaica":"자메이카","shelf":"선반","timing":"시기 선택/타이밍","incredible":"믿기 힘든/굉장한","crop":"작물/수확","commonwealth":"연방/공화국","pharmaceutical":"제약의/약학의","manhattan":"맨해튼","tales":"이야기(복수)","islam":"이슬람교","seeds":"씨앗(복수)","hub":"중심(지)/허브","twelve":"열둘","founder":"설립자/창립자","decade":"십 년","portuguese":"포르투갈의/포르투갈어","tired":"피곤한","adverse":"부정적인/불리한","everywhere":"어디나","excerpt":"발췌(문)","steam":"증기/김","discharge":"방출/퇴원/해고","ef":"에프(글자)","ace":"에이스/최고수","halloween":"핼러윈","climbing":"등반/오르기","sing":"노래하다","perfume":"향수","carol":"캐럴/축가","honest":"정직한","hazardous":"위험한","restore":"복원하다/회복시키다","stack":"쌓다/더미","methodology":"방법론","ep":"미니앨범/EP","reputation":"평판/명성","recycling":"재활용","hang":"걸다/매달다","curve":"곡선/커브","creator":"창작자/창조자","coding":"코딩/부호화","tracker":"추적기/추적자","variation":"변화/변형","passage":"통로/구절","trunk":"트렁크/줄기/코끼리 코","damn":"빌어먹을/저주하다","photograph":"사진","waves":"파도(복수)","camel":"낙타","distributor":"유통업자/배급사","underlying":"근본적인/기저의","hood":"두건/(자동차)후드","wrestling":"레슬링/씨름","suicide":"자살","arabia":"아라비아","gathering":"모임/수집","projection":"투영/예상","juice":"주스","chase":"쫓다/추격","logical":"논리적인","sauce":"소스","extract":"추출하다/발췌","diagnostic":"진단의","panama":"파나마","indianapolis":"인디애나폴리스","courtesy":"예의/호의","criticism":"비판/비평","statutory":"법에 명시된/법정의","athens":"아테네","northeast":"북동(쪽)","retired":"은퇴한","juvenile":"청소년의/미성년의","injection":"주사/주입","yorkshire":"요크셔","protective":"보호하는","acoustic":"음향의/통기타의","railway":"철도","cassette":"카세트","initially":"처음에","indicator":"지표/표시기","pointed":"뾰족한/날카로운","fusion":"융합/퓨전","mineral":"광물/미네랄","sunglasses":"선글라스","ruby":"루비","preference":"선호(도)/우선","cemetery":"묘지","croatia":"크로아티아","stadium":"경기장/스타디움","exploration":"탐험/탐사","coupon":"쿠폰","stem":"줄기/유래하다","proxy":"대리(인)/프록시","opt":"선택하다","costume":"의상/복장","berkeley":"버클리","killer":"살인자","rap":"랩/두드림","tune":"곡/선율","bishop":"주교","pulled":"당겼다","corn":"옥수수","seasonal":"계절적인","farmer":"농부","constitutional":"헌법의/체질의","perfectly":"완벽하게","tin":"주석/깡통","slave":"노예","norfolk":"노퍽","litigation":"소송","painted":"칠해진/그려진","broadcasting":"방송","horizontal":"수평의/가로의","artwork":"예술 작품/삽화","cosmetic":"화장품/미용의","portrait":"초상화/인물 사진","terrorist":"테러리스트","informational":"정보의","ethical":"윤리적인","floral":"꽃의/꽃무늬의","struggle":"투쟁/고군분투","neutral":"중립의","fisher":"어부/낚시꾼","prospective":"장래의/유망한","bedding":"침구","ultimately":"궁극적으로/결국","heading":"제목/방향","equally":"똑같이/동등하게","spectacular":"장관인/극적인","coordination":"조정/협응","connector":"연결 장치/커넥터","brad":"브래드(이름)","combo":"조합/세트","guilty":"죄책감 드는/유죄의","affiliated":"제휴한/소속된","activation":"활성화","naturally":"자연스럽게/당연히","tablet":"알약/태블릿","tail":"꼬리","charm":"매력/부적","lawn":"잔디(밭)","violent":"폭력적인","underwear":"속옷","basin":"대야/분지","soup":"수프/국","potentially":"잠재적으로","ranch":"목장","crossing":"건널목/횡단","inclusive":"포함된/포괄적인","dimensional":"차원의","cottage":"오두막/시골집","drunk":"술 취한","considerable":"상당한","toner":"토너","nose":"코","latex":"라텍스/고무","anymore":"더 이상","delhi":"델리","locator":"위치 추적기","zimbabwe":"짐바브웨","complexity":"복잡성","constantly":"끊임없이/항상","resolve":"해결하다/결심하다","barcelona":"바르셀로나","presidential":"대통령의","documentary":"다큐멘터리/기록의","cod":"대구(생선)","moscow":"모스크바","thesis":"논문/논지","nylon":"나일론","palestinian":"팔레스타인의","rocky":"바위투성이의/험난한","frequent":"잦은/빈번한","trim":"다듬다/손질","nigeria":"나이지리아","ceiling":"천장/상한선","hispanic":"히스패닉의","gen":"세대/일반(약자)","anybody":"아무나","procurement":"조달/획득","fleet":"함대/(차량)단","untitled":"제목 없는","singing":"노래하는","theoretical":"이론적인","afford":"~할 여유가 있다","referral":"소개/위탁","quit":"그만두다","lung":"폐","highlight":"강조하다/하이라이트","substitute":"대체(하다)/대체물","inclusion":"포함","hopefully":"바라건대/희망을 갖고","brilliant":"훌륭한/눈부신","turner":"터너(이름)/선반공","sucking":"빠는/젖먹이의","gel":"젤","spoken":"말로 하는/구어의","omega":"오메가/마지막","civic":"시민의/도시의","thereof":"그것의","grill":"석쇠/굽다","redeem":"되찾다/만회하다","grain":"곡물/낟알","authentic":"진짜의/정통의","regime":"정권/체제","bull":"황소","depend":"의존하다/달려 있다","breath":"숨/호흡","cole":"콜(이름)","candle":"양초","hanging":"매달린","colored":"색깔이 있는/유색의","tale":"이야기/설화","projector":"영사기/프로젝터","situated":"위치한","comparative":"비교의/상대적인","herbal":"허브의/약초의","loving":"사랑하는/애정 어린","routing":"경로 지정","psychological":"심리적인","retailer":"소매업자","renewal":"갱신/재개","opposed":"반대하는","scoring":"득점/채점","brooklyn":"브루클린","sisters":"자매(복수)","similarly":"마찬가지로/비슷하게","margin":"여백/차이/이윤","coin":"동전","fake":"가짜","salon":"미용실/살롱","norman":"노먼(이름)/노르만족","headed":"~로 향하는/머리가 ~인","cure":"치료(하다)","madonna":"성모마리아/마돈나","commander":"지휘관","arch":"아치/활 모양","suggestion":"제안","hdtv":"고화질 텔레비전","soldier":"군인/병사","bomb":"폭탄","harm":"해(害)/해치다","interval":"간격/막간","spotlight":"스포트라이트/주목","reset":"재설정하다","brush":"붓/솔/빗질","investigate":"조사하다/수사하다","thy":"너의(고어)","repeated":"반복된","assault":"공격/폭행","spare":"여분의/아끼다","logistics":"물류/병참","deer":"사슴","kodak":"코닥","tongue":"혀","bowling":"볼링","danish":"덴마크의/덴마크어","monkey":"원숭이","proportion":"비율/부분","skirt":"치마/스커트","florence":"피렌체/플로렌스","invest":"투자하다","honey":"꿀/여보","scenario":"시나리오/각본","ye":"너희(고어)","arabic":"아랍어/아랍의","gauge":"측정기/계기","junction":"교차로/연결점","mat":"매트/깔개","rachel":"레이첼(이름)","oven":"오븐","intensive":"집중적인/집약적인","kingston":"킹스턴","sixth":"여섯번째","engage":"관여하다/사로잡다","deviant":"일탈적인/비정상의","noon":"정오","correspondence":"서신/일치","cheat":"속이다/부정행위","bronze":"청동/동메달","sandy":"모래의/샌디(이름)","testimony":"증언","suspect":"용의자/의심하다","macro":"거시적인/매크로","sender":"발신인/보내는 사람","mandatory":"의무적인/필수의","syndication":"신디케이트/배급","tuition":"수업료/교습","exotic":"이국적인/외래의","viewer":"시청자/뷰어","receptor":"수용체","laugh":"웃다","joel":"조엘(이름)","destroy":"파괴하다","citation":"인용/표창","pitch":"음높이/던지다","perry":"페리(이름)","offensive":"공격적인/불쾌한","imperial":"제국의/황제의","dozen":"열두 개/다스","benjamin":"벤저민(이름)","deployment":"배치/전개","cloth":"천/옷감","studying":"공부하는","stamp":"우표/도장/짓밟다","lotus":"연꽃","salmon":"연어","olympus":"올림푸스(산)","cargo":"화물","tan":"황갈색/햇볕에 태우다","directive":"지시/명령","salem":"세일럼","mate":"친구/짝","starter":"전채/시동 장치/선발","butter":"버터","pepper":"후추/고추","weapon":"무기","chef":"요리사/주방장","isle":"섬","slim":"날씬한/가는","maple":"단풍나무","grocery":"식료품(점)","offshore":"해외의/연안의","comp":"무료의/반주(약자)","alt":"대체(키)/알토","pie":"파이","blend":"섞다/혼합","harrison":"해리슨(이름)","occasionally":"가끔/때때로","bow":"활/절하다/뱃머리","instructional":"교육의/교습용의","traveling":"여행하는","probe":"조사(하다)/탐사선","midi":"미디(음악)/중간 길이의","biotechnology":"생명공학","packed":"꽉 찬/포장된","outreach":"봉사 활동/지원","recover":"회복하다/되찾다","balanced":"균형 잡힌","timely":"시기적절한","delayed":"지연된/늦춰진","chuck":"척(이름)/던지다","calculation":"계산","consolidated":"통합된/굳어진","newton":"뉴턴","anxiety":"불안/걱정","bingo":"빙고","spatial":"공간의/공간적인","ceramic":"도자기의/세라믹","prompt":"즉각적인/유도하다","cox":"콕스(이름)","fingers":"손가락(복수)","sunny":"화창한/햇볕이 드는","queensland":"퀸즐랜드","necklace":"목걸이","composite":"합성의/복합의","unavailable":"이용할 수 없는","cedar":"삼나무","raleigh":"롤리","stud":"징/씨말","fold":"접다/주름","essentially":"본질적으로/근본적으로","qualify":"자격을 얻다/한정하다","fingering":"운지법/손가락질","mason":"석공/메이슨","slut":"(욕설)헤픈 여자","footwear":"신발(류)","vic":"빅(이름)","victor":"승리자","attach":"붙이다/첨부하다","brunswick":"브런즈윅","spider":"거미","sensitivity":"민감성/감수성","preservation":"보존","hudson":"허드슨","isolated":"고립된/외딴","interim":"임시의/중간의","divine":"신성한/신의","approve":"승인하다/찬성하다","compound":"화합물/복합의","intensity":"강도/세기","syndicate":"신디케이트/연합","abortion":"낙태/유산","blast":"폭발/돌풍","calcium":"칼슘","addressing":"주소 지정/처리","pole":"막대/극(極)/폴란드인","harvest":"수확","membrane":"막(膜)","prague":"프라하","locally":"국지적으로/현지에서","pickup":"픽업/수거","desperate":"필사적인/절망적인","demonstration":"시위/시연","governmental":"정부의","graduation":"졸업","bend":"구부리다/굽이","sailing":"항해/요트 타기","sacred":"신성한","addiction":"중독","chrome":"크롬","tommy":"토미(이름)","springfield":"스프링필드","brake":"브레이크/제동","exterior":"외부(의)/외관","ecology":"생태(학)","oliver":"올리버(이름)","congo":"콩고","botswana":"보츠와나","synthesis":"합성/종합","olive":"올리브","unemployment":"실업","enhancement":"향상/강화","clone":"복제(하다)/클론","relay":"중계/이어주다/릴레이","composed":"구성된/침착한","oasis":"오아시스","cab":"택시/운전석","brazilian":"브라질의","petroleum":"석유","compete":"경쟁하다","ist":"~하는 사람(접미)","norwegian":"노르웨이의","lover":"연인/애호가","belong":"속하다","honolulu":"호놀룰루","escort":"호위(하다)/에스코트","retention":"보유/유지","pond":"연못","malta":"몰타","daddy":"아빠","ferry":"여객선/나룻배","rabbit":"토끼","profession":"직업/전문직","seating":"좌석 배치","dam":"댐","physiology":"생리학","omaha":"오마하","tire":"타이어/지치게 하다","recreational":"오락의/여가의","dominican":"도미니카의","chad":"차드","heather":"헤더(이름)/히스","passport":"여권","motel":"모텔","treasury":"국고/재무부","warrant":"영장/보증하다","frozen":"얼어붙은/냉동의","royalty":"왕족/인세","rally":"집회/회복하다/랠리","observer":"관찰자/참관인","strain":"긴장/부담/혈통","somehow":"어떻게든","provincial":"지방의/주(州)의","ripe":"익은/숙성된","hebrew":"히브리어/히브리의","dying":"죽어가는","laundry":"세탁(물)","homework":"숙제","advertiser":"광고주","sophisticated":"세련된/정교한","silence":"침묵/고요","soviet":"소련의","possession":"소유(물)","vocal":"목소리의/거리낌 없는","trainer":"트레이너/운동화","organ":"장기(臟器)/오르간","vegetables":"채소(복수)","lemon":"레몬","toxic":"독성의/유독한","darkness":"어둠","nuts":"견과류/(속어)미친","nail":"못/손톱","implied":"암시된/내포된","span":"기간/범위/걸치다","respondent":"응답자/피고","packing":"포장/짐 싸기","satisfy":"만족시키다/충족하다","shelter":"피난처/대피소","chapel":"예배당","manufacture":"제조(하다)","vulnerability":"취약성","celebrate":"축하하다/기념하다","accredited":"인가된/공인된","compressed":"압축된","bahamas":"바하마","mixture":"혼합(물)","zoophilia":"동물성애","bench":"벤치/긴 의자","tub":"욕조/통","rider":"타는 사람/기수","radius":"반지름/반경","mortality":"사망률/죽음","logging":"벌목/로그 기록","impressive":"인상적인","sheep":"양(羊)","railroad":"철도","nursery":"육아실/탁아소/묘목장","ash":"재/물푸레나무","microwave":"전자레인지/극초단파","relocation":"이전/재배치","np":"전문 간호사(약자)","monroe":"먼로(이름)","tender":"부드러운/연한/입찰","foam":"거품/포말","paste":"풀/반죽/붙이다","discretion":"재량/신중함","preserve":"보존하다/지키다","poem":"시(詩)","vibrator":"진동기","easter":"부활절","repository":"저장소/보관소","praise":"칭찬(하다)","venice":"베니스/베네치아","estonia":"에스토니아","christianity":"기독교","veteran":"베테랑/참전용사","realistic":"현실적인/사실적인","showcase":"전시(하다)/진열장","integral":"필수적인/적분","relax":"쉬다/긴장을 풀다","namibia":"나미비아","hardly":"거의 ~않다","reunion":"재회/동창회","composer":"작곡가","absent":"결석한/없는","ecuador":"에콰도르","coral":"산호","float":"뜨다/떠다니다","bias":"편견/편향","bubble":"거품/방울","contrary":"반대의/~와 달리","dairy":"유제품의/낙농장","fancy":"화려한/공상","equality":"평등/균등","samoa":"사모아","tap":"가볍게 두드리다/수도꼭지","leasing":"임대(차)","companion":"동반자/동료","scroll":"두루마리/스크롤","relate":"관련시키다/이해하다","swim":"수영하다","fellowship":"친목/연구비","nano":"나노/극소의","martial":"전쟁의/무술의","victorian":"빅토리아 시대의","retain":"유지하다/보유하다","execute":"실행하다/처형하다","tunnel":"터널","cambodia":"캄보디아","chaos":"혼돈","lithuania":"리투아니아","beaver":"비버","distribute":"분배하다/유통하다","decorative":"장식의/장식용의","confused":"혼란스러운/헷갈리는","compiler":"컴파일러/편집자","accused":"피고(인)/고발된","bee":"벌","loud":"시끄러운","conjunction":"접속사/결합","bride":"신부","indigenous":"토착의/원주민의","anchor":"닻/앵커","parade":"행진/퍼레이드","corruption":"부패/타락","trigger":"방아쇠/유발하다","cholesterol":"콜레스테롤","essex":"에식스","slovenia":"슬로베니아","differential":"차이의/미분","dramatic":"극적인/연극의","pendant":"펜던트/늘어뜨린 장식","baptist":"침례교도","hiring":"채용/고용","arthritis":"관절염","nevertheless":"그럼에도 불구하고","fever":"열","cuisine":"요리(법)","surely":"확실히","transcript":"사본/녹취록/성적증명서","inflation":"인플레이션/팽창","ruth":"루스(이름)","stylus":"철필/스타일러스","contracting":"계약(하는)/수축","topless":"상의를 벗은","reasonably":"합리적으로/꽤","jeep":"지프(차)","bare":"벌거벗은/맨~","radical":"급진적인/근본적인","rover":"방랑자/탐사차","treasure":"보물","reload":"다시 장전하다/새로고침","flame":"불꽃/화염","monetary":"통화의/금전의","elderly":"나이 든/연로한","pit":"구덩이/구멍","arlington":"알링턴","floating":"떠 있는/유동적인","extraordinary":"비범한/엄청난","tile":"타일","bolivia":"볼리비아","spell":"철자를 말하다/주문","coordinate":"조정하다/좌표","kuwait":"쿠웨이트","exclusively":"독점적으로/오로지","alleged":"주장된/~로 알려진","compile":"엮다/편집하다/컴파일하다","rx":"처방(약자)","illustration":"삽화/예시","plymouth":"플리머스","construct":"건설하다/구성하다","bridal":"신부의/결혼의","annex":"부속 건물/합병하다","mag":"잡지(약자)","inspiration":"영감/자극","curious":"호기심 많은/궁금한","freight":"화물(운송)","rebate":"환급/리베이트","eclipse":"(일/월)식/가리다","shuttle":"왕복(편)/셔틀","knee":"무릎","pb":"납(원소)/땅콩버터","complicated":"복잡한","butler":"집사","injured":"부상당한/다친","payroll":"급여 (대상자)","courier":"택배(원)/배달부","shakespeare":"셰익스피어","unlikely":"~할 것 같지 않은","tribute":"헌사/공물","immune":"면역의/면제된","latvia":"라트비아","forestry":"임업","cant":"~할 수 없다(can't)","genesis":"기원/창세기","incorrect":"틀린/부정확한","bicycle":"자전거","furnishings":"가구/세간","letting":"하게 하는","guatemala":"과테말라","celtic":"켈트족의","particle":"입자/조각","perception":"인식/지각","humidity":"습도/습기","boxing":"권투/복싱","bangkok":"방콕","renaissance":"르네상스/부흥","pathology":"병리학","bra":"브래지어","bitch":"암캐/(욕설)","chess":"체스","brisbane":"브리즈번","survive":"살아남다","duck":"오리","reveal":"드러내다/밝히다","canal":"운하/수로","cow":"소/암소","manitoba":"매니토바","lying":"거짓말하는/누워있는","dive":"잠수하다/다이빙","circulation":"순환/유통","drill":"드릴/훈련","threesome":"3인조","assumption":"가정/추정","jerusalem":"예루살렘","hobby":"취미","invention":"발명(품)","nickname":"별명/애칭","technician":"기술자/기사","inline":"인라인의/줄지은","washing":"세탁/빨래","cognitive":"인지의/인식의","trick":"속임수/장난","enquiry":"문의/조사","closure":"폐쇄/종결","raid":"습격/단속","timber":"목재","volt":"볼트","intense":"강렬한/극심한","registrar":"등록 담당자","ruling":"판결/지배하는","steady":"꾸준한/안정된","dirt":"먼지/흙","saskatchewan":"서스캐처원","screw":"나사/돌려 조이다","geneva":"제네바","handed":"건네준/손이 ~인","intake":"섭취(량)/흡입","informal":"비공식의/격식 없는","butterfly":"나비","mechanics":"역학/기계학","heavily":"심하게/무겁게","fifty":"오십","numerical":"수의/숫자의","geek":"괴짜/덕후","uncle":"삼촌","counting":"세기/계산","reflection":"반사/반영/숙고","sink":"가라앉다/싱크대","assure":"보장하다/장담하다","invitation":"초대(장)","devoted":"헌신적인","princeton":"프린스턴","jacob":"제이콥(이름)","sodium":"나트륨/소듐","hormone":"호르몬","proprietary":"독점의/사유의","timothy":"티머시(이름)","brick":"벽돌","grip":"꽉 쥠/손잡이","porcelain":"자기/도자기","casting":"배역/주조","dayton":"데이턴","shortly":"곧/머지않아","reno":"리노","warrior":"전사","diploma":"졸업장/수료증","cabin":"오두막/객실","innocent":"무죄의/순수한","scanning":"훑어보기/검사","polo":"폴로","valium":"발륨(진정제)","copying":"복사/베끼기","cordless":"무선의","horn":"뿔/경적","uganda":"우간다","journalism":"언론(계)/저널리즘","frog":"개구리","grammar":"문법","intention":"의도/의향","syria":"시리아","disagree":"동의하지 않다/반대하다","hazard":"위험(요소)","retro":"복고풍의","leo":"사자자리/레오","statewide":"주(州) 전체의","gregory":"그레고리(이름)","circular":"원형의/순환의","anger":"분노","mainland":"본토","interact":"상호작용하다/소통하다","snap":"탁 하고 부러지다/스냅","happiness":"행복","substantially":"상당히/실질적으로","ribbon":"리본/띠","swap":"교환(하다)/맞바꾸다","exempt":"면제된/면제하다","geometry":"기하학","impression":"인상","slovakia":"슬로바키아","flip":"뒤집다/홱 던지다","guild":"길드/조합","correlation":"상관관계","gorgeous":"멋진/화려한","rna":"리보핵산","barbados":"바베이도스","chrysler":"크라이슬러","nervous":"긴장한","replica":"복제품/모형","plumbing":"배관(설비)","tribe":"부족","superb":"최고의/훌륭한","buzz":"윙윙거림/웅성거림","transparent":"투명한","charleston":"찰스턴","handled":"처리된/다뤄진","boom":"붐/호황","calm":"차분한","exhaust":"배기가스/소진시키다","shanghai":"상하이","burton":"버턴(이름)","scotia":"스코샤","farming":"농업/농사","gibson":"깁슨(이름)","fork":"포크/갈림길","troy":"트로이","roller":"롤러","alter":"바꾸다/변경하다","ghana":"가나","mixing":"혼합/섞기","distinguished":"저명한/뛰어난","asthma":"천식","twins":"쌍둥이(복수)","developmental":"발달의/개발의","rip":"찢다","triangle":"삼각형","amend":"수정하다/개정하다","oriental":"동양의","windsor":"윈저","zambia":"잠비아","hydrogen":"수소","sprint":"전력 질주/단거리","advocate":"옹호하다/지지자","confusion":"혼란/혼동","tray":"쟁반/트레이","genome":"게놈/유전체","thong":"끈/끈팬티","medal":"메달/훈장","harbor":"항구/품다","sage":"현자/세이지","vulnerable":"취약한/연약한","arrange":"정리하다/준비하다","artistic":"예술적인","bat":"방망이/박쥐","indie":"독립의/인디","breed":"번식하다/품종","polar":"극(極)의/정반대의","fallen":"떨어진/쓰러진","precise":"정확한/정밀한","sussex":"서식스","mainstream":"주류(의)","lip":"입술","sap":"수액/약화시키다","gather":"모으다/모이다","maternity":"출산의/임산부의","backed":"지지받는/뒷받침된","alfred":"앨프레드(이름)","colonial":"식민지의","embassy":"대사관","cave":"동굴","slight":"약간의/경미한","indirect":"간접적인","wool":"양털/모직","arrest":"체포하다","volleyball":"배구","horizon":"수평선/지평선","deeply":"깊게","toolbox":"공구함/도구상자","marina":"정박지/마리나","tolerance":"관용/내성","surfing":"서핑/파도타기","creativity":"창의력","pursue":"추구하다/뒤쫓다","lightning":"번개","eyed":"눈이 ~인","grab":"붙잡다","inspector":"조사관/형사","brighton":"브라이턴","disable":"무력화하다/비활성화하다","snake":"뱀","lending":"대출/대여","oops":"이런!/아이고","nipple":"젖꼭지","xi":"크사이(글자)","trap":"덫/함정","lonely":"외로운","nonprofit":"비영리의","lancaster":"랭커스터","hereby":"이로써/이에","observe":"관찰하다/준수하다","berry":"산딸기/열매","collar":"옷깃/목줄","integrate":"통합하다/융합하다","bermuda":"버뮤다","confident":"자신 있는/확신하는","officially":"공식적으로","consortium":"컨소시엄/연합체","terrace":"테라스/계단식 단","bacteria":"박테리아/세균","seafood":"해산물","delicious":"맛있는","safely":"안전하게","durable":"내구성 있는/오래가는","mazda":"마쓰다","moisture":"수분/습기","hungarian":"헝가리의","nasdaq":"나스닥","uruguay":"우루과이","transform":"변형시키다/탈바꿈하다","timer":"타이머","verse":"운문/(노래)절","independently":"독립적으로","scratch":"긁다/긁힌 자국","alignment":"정렬/한 줄로 맞춤","rocket":"로켓","bullet":"총알","lace":"레이스/끈","nasty":"고약한/불쾌한","visibility":"가시성/가시거리","latitude":"위도/자유재량","ste":"성인(약자)/세인트","ugly":"못생긴/추한","mistress":"여주인/정부(情婦)","hart":"수사슴/하트(이름)","bernard":"버나드(이름)","forty":"마흔/40","attempted":"시도된/미수의","priest":"성직자/신부","queue":"줄/대기열","dx":"진단(약자)","trance":"무아지경/황홀경","bundle":"꾸러미/묶음","hammer":"망치","runner":"달리는 사람/주자","notion":"개념/생각","beneath":"~아래에","strengthen":"강화하다/튼튼히 하다","frederick":"프레더릭(이름)","medicaid":"저소득층 의료보험","infrared":"적외선(의)","seventh":"일곱번째","welsh":"웨일스의/웨일스어","belly":"배/복부","aggressive":"공격적인/적극적인","sculpture":"조각(품)","poly":"폴리/다수의","dod":"미 국방부","fist":"주먹","neo":"새로운/신(新)","pharmacology":"약리학","fitting":"적합한/피팅","consistently":"일관되게/꾸준히","elder":"연장자/손위의","sonic":"음속의/소리의","dig":"파다/캐다","taxi":"택시","punishment":"처벌/벌","appreciation":"감사/감상/가치 상승","subsequently":"그 후/이어서","zoning":"용도 지정/구역제","gravity":"중력/심각성","thumb":"엄지손가락","incorporate":"포함하다/법인화하다","treasurer":"회계 담당자/재무관","essence":"본질/정수","flooring":"바닥재","lightweight":"가벼운/경량의","ethiopia":"에티오피아","mighty":"강력한/위대한","humanity":"인류/인간성","transcription":"필사/전사","holmes":"홈스","galaxy":"은하(계)","chester":"체스터","dominant":"지배적인/우세한","twist":"비틀다/꼬다","specifics":"세부 사항(복수)","partially":"부분적으로","minimize":"최소화하다","darwin":"다윈","wilderness":"황야/야생","debut":"데뷔/첫 등장","deny":"부인하다/거부하다","trio":"삼중주/3인조","proceeding":"진행/(법적)절차","cube":"정육면체/세제곱","uncertainty":"불확실성","breakdown":"고장/붕괴/분석","marker":"표시(물)/마커","reconstruction":"재건/복원","subsidiary":"자회사/부수적인","clarity":"명확성/선명함","adelaide":"애들레이드","furnished":"가구가 갖춰진","monaco":"모나코","folding":"접이식의/접는","airfare":"항공 요금","beneficial":"유익한/이로운","vaccine":"백신","belize":"벨리즈","crap":"쓰레기/똥(속어)","volvo":"볼보","penny":"페니/동전","robust":"튼튼한/강건한","porter":"짐꾼/포터","jungle":"정글","rim":"테두리/가장자리","zen":"선(禪)","ivory":"상아","alpine":"고산의/알프스의","dis":"무시하다(속어)/분리(접두)","fabulous":"멋진/굉장한","thesaurus":"유의어 사전","battlefield":"전쟁터/싸움터","literally":"문자 그대로/정말로","ecological":"생태(계)의","oval":"타원형의","cooler":"냉각기/아이스박스","maritime":"해양의/바다의","periodic":"주기적인","overhead":"머리 위의/간접비","prospect":"전망/가능성","shipment":"수송/적하물","breeding":"번식/사육/교육","geographical":"지리적인","mozambique":"모잠비크","tension":"긴장/장력","benz":"벤츠","tier":"층/단계","manor":"영지/저택","envelope":"봉투","finishing":"마무리(의)","incoming":"들어오는/도착하는","eternal":"영원한","guam":"괌","cite":"인용하다/언급하다","aboriginal":"원주민의/토착의","rotation":"회전/순환","pig":"돼지","metric":"미터법의","compliant":"준수하는/순응하는","imagination":"상상력","joshua":"여호수아/조슈아","armenia":"아르메니아","varied":"다양한/가지각색의","actress":"여배우","mess":"엉망","assign":"배정하다/할당하다","aurora":"오로라/극광","milan":"밀라노","premiere":"개봉/초연","lender":"대출 기관/빌려주는 사람","shade":"그늘/색조","chorus":"합창/후렴","rhythm":"리듬/박자","digit":"숫자/자릿수","symphony":"교향곡","sudden":"갑작스러운","accepting":"받아들이는/수용적인","precipitation":"강수(량)","lyric":"가사/서정시","isolation":"고립/격리","approximate":"대략의/근사한","rope":"밧줄","carroll":"캐럴(이름)","rational":"이성적인/합리적인","dump":"버리다/덤프","warming":"따뜻해짐/온난화","incomplete":"불완전한/미완성의","chronicle":"연대기/기록","fountain":"분수/샘","legitimate":"합법적인/정당한","burner":"버너/화구","finnish":"핀란드의/핀란드어","gentle":"부드러운/온화한","footage":"영상/장면","howto":"방법 안내","entrepreneur":"기업가/사업가","freelance":"프리랜서의","duo":"2인조/듀오","devon":"데번","valuation":"평가/가치 산정","fog":"안개","characteristic":"특징/특유의","lobby":"로비/대기실","egyptian":"이집트의","tunisia":"튀니지","headline":"표제/헤드라인","punch":"주먹질/펀치","cowboy":"카우보이","narrative":"이야기/서술","bahrain":"바레인","karma":"업보/카르마","quantitative":"양적인/정량적인","subdivision":"세분/분할 구역","defeat":"패배/물리치다","distinction":"구별/탁월함","honduras":"온두라스","naughty":"버릇없는/장난기 있는","insured":"보험에 든/피보험자","harper":"하퍼(이름)","tattoo":"문신","shake":"흔들다/떨다","algebra":"대수학","holly":"호랑가시나무/홀리","mercy":"자비/연민","freely":"자유롭게","sunrise":"일출/해돋이","fur":"털/모피","nicaragua":"니카라과","timeline":"시간표/연대표","tar":"타르","readily":"손쉽게/기꺼이","fence":"울타리","nudist":"나체주의자","infinite":"무한한","relatives":"친척(복수)","clan":"씨족/가문","shame":"부끄러움/수치","revolutionary":"혁명적인","civilian":"민간인","remedy":"치료(법)/해결책","breathing":"호흡","briefly":"간단히/잠깐","aerospace":"항공우주(의)","flesh":"살/피부","retreat":"후퇴/은신처","barely":"간신히/거의 ~않다","wherever":"어디든지","rug":"양탄자/깔개","democrat":"민주당원/민주주의자","borough":"자치구","failing":"결점/~이 없으면","marble":"대리석/구슬","jesse":"제시(이름)","hull":"선체/껍질","surrey":"서리","highland":"고지(대)/하일랜드","meditation":"명상/묵상","macedonia":"마케도니아","instrumental":"도움이 되는/기악의","shed":"헛간/벗다","memo":"메모/회람","ham":"햄","tide":"조수/조류","hawaiian":"하와이의","partition":"칸막이/분할","invisible":"보이지 않는","funk":"펑크(음악)/두려움","magnet":"자석","porsche":"포르쉐","reel":"릴/감개","sheer":"순전한/얇은","commodity":"상품/물품","bind":"묶다/구속하다","rand":"랜드(남아공 화폐)","gothic":"고딕(양식)의","cylinder":"원기둥/실린더","witch":"마녀","indication":"표시/징후","eh":"응?","puppy":"강아지","acre":"에이커","revenge":"복수/앙갚음","consultancy":"컨설팅 회사/자문","patrol":"순찰","smell":"냄새(맡다)","pest":"해충/골칫거리","carnival":"카니발/축제","roughly":"대략/거칠게","sticker":"스티커","reef":"암초/산호초","divide":"나누다/분할하다","consecutive":"연속적인","satin":"새틴/공단","deserve":"~받을 만하다","promo":"홍보(물)/판촉","worried":"걱정하는","garbage":"쓰레기","beth":"베스(이름)","peninsula":"반도","chelsea":"첼시","boring":"지루한","reynolds":"레이놀즈(이름)","schema":"개요/도식","sofa":"소파","prefix":"접두사/머리에 붙이다","typing":"타자/타이핑","nerve":"신경","deficit":"적자/부족","boulder":"바위/큰 돌","pointing":"가리키는","renew":"갱신하다/재개하다","floppy":"흐물흐물한/플로피","texture":"질감/조직","jar":"항아리/병","thoroughly":"철저히/완전히","nottingham":"노팅엄","thunder":"천둥","tent":"텐트/천막","caution":"주의/조심","questionnaire":"설문지","qualification":"자격(증)/조건","miniature":"소형의/축소 모형","hack":"해킹하다/난도질하다","interstate":"주(州) 간의/고속도로","aerial":"공중의/항공의","hawk":"매","consequence":"결과/중요성","rebel":"반란자/반항하다","systematic":"체계적인/조직적인","hired":"고용된","makeup":"화장","textile":"직물/섬유","lamb":"새끼 양/양고기","tobago":"토바고","cos":"코사인","uzbekistan":"우즈베키스탄","magnitude":"규모/크기","hindu":"힌두교의","dh":"지명타자(약자)","vocabulary":"어휘","licking":"핥기","earthquake":"지진","geological":"지질학의","wicked":"사악한/짓궂은","roommate":"룸메이트/동거인","junk":"쓰레기/고물","wax":"왁스/밀랍","answering":"응답(하는)","impressed":"감명받은","slope":"경사(면)/비탈","reggae":"레게","conspiracy":"음모/공모","saturn":"토성/새턴","organizer":"주최자/정리 도구","nut":"견과/너트","allergy":"알레르기","sake":"~을 위해(for the sake of)","merit":"장점/공로","cumulative":"누적되는","tackle":"태클/씨름하다","amplifier":"증폭기/앰프","arbitrary":"임의의/독단적인","retrieve":"되찾다/검색하다","titanium":"티타늄","fairy":"요정","shaft":"축/자루/갱도","lean":"기대다/마른","occasional":"가끔의/이따금의","kitty":"새끼고양이","drain":"배수하다/하수구","monte":"몬테","blessed":"축복받은","reviewing":"검토(하는)/복습","cardiff":"카디프","cornwall":"콘월","potato":"감자","panic":"공황/공포","transsexual":"성전환자(의)","excuse":"변명/실례","basement":"지하실","onion":"양파","sandwich":"샌드위치","alto":"알토","informative":"유익한/정보를 주는","girlfriend":"여자친구","hierarchy":"위계/계층","reject":"거부하다/거절하다","italic":"이탤릭체의","merry":"즐거운/유쾌한","mil":"밀(천분의 1인치)","scuba":"스쿠버","gore":"유혈/피","complement":"보완하다/보충물","dash":"돌진/줄표(—)","passive":"수동적인/소극적인","valued":"소중한/평가된","cage":"우리/새장","checklist":"점검표/체크리스트","verde":"베르데","gazette":"관보/신문","extraction":"추출/발치","batman":"배트맨","elevation":"고도/높이","lap":"무릎/한 바퀴","calibration":"보정/눈금 측정","ping":"핑/신호음","textbook":"교과서","prerequisite":"전제 조건/선수과목","luther":"루터","frontier":"국경/변경/최전선","settle":"정착하다/해결하다","stopping":"멈추는","flux":"끊임없는 변화/유동","derby":"더비(경마)","peaceful":"평화로운","pontiac":"폰티악","scenic":"경치 좋은","renewable":"재생 가능한/갱신 가능한","intersection":"교차로/교차점","sewing":"바느질/재봉","consistency":"일관성/농도","conclude":"결론짓다/끝내다","munich":"뮌헨","propose":"제안하다/청혼하다","lighter":"라이터/더 가벼운","rage":"분노/격노","astrology":"점성술","pavilion":"누각/전시관","pillow":"베개","induction":"유도/취임/귀납","precisely":"정확히/바로","paraguay":"파라과이","steal":"훔치다","parcel":"소포/꾸러미","refined":"정제된/세련된","incidence":"발생(률)","boutique":"부티크/옷가게","acrylic":"아크릴(의)","tuner":"튜너/조율사","avon":"에이번","toddler":"아장아장 걷는 아기","flavor":"맛/풍미","alike":"비슷한/똑같이","hungry":"배고픈","blocked":"막힌/차단된","interference":"간섭/방해","palestine":"팔레스타인","undo":"되돌리다/취소하다","cadillac":"캐딜락","atmospheric":"대기의/분위기 있는","lesser":"더 적은/덜한","publicity":"홍보/널리 알려짐","marathon":"마라톤","ant":"개미","proposition":"제안/명제","pressing":"긴급한/누르는","apt":"적절한/~하기 쉬운","dressed":"옷을 입은","scout":"정찰병/스카우트","belfast":"벨파스트","niagara":"나이아가라","inf":"무한대(약자)","eos":"이오스/새벽의 여신","catalyst":"촉매/기폭제","allowance":"용돈/수당/허용량","duplicate":"복제(하다)/사본","wrist":"손목","civilization":"문명","heath":"히스(황야)","varying":"다양한/변화하는","validity":"유효성/타당성","trustee":"수탁자/이사","maui":"마우이","weighted":"가중치를 둔/치우친","yemen":"예멘","scholar":"학자","nickel":"니켈/5센트","internationally":"국제적으로","geology":"지질학","coating":"코팅/도장","wallet":"지갑","accomplish":"성취하다/완수하다","boating":"보트 타기/뱃놀이","drainage":"배수/하수","vegetarian":"채식주의자(의)","rouge":"연지/볼연지","yeast":"효모/이스트","yale":"예일(대학)","newfoundland":"뉴펀들랜드","sn":"일련번호(약자)","pas":"걸음(불어)/파스","clearing":"공터/청산","coated":"코팅된/입혀진","intend":"의도하다/작정하다","vegetation":"초목/식생","specially":"특별히","yukon":"유콘","bite":"물다/한 입","aquatic":"수생의/물의","infectious":"전염성의/옮기는","gig":"공연/일거리","gilbert":"길버트(이름)","sas":"특수 항공 부대","continuity":"연속성/지속","ensemble":"앙상블/합주단","insulin":"인슐린","assured":"확신하는/보장된","weed":"잡초/김매다","conscious":"의식이 있는/자각하는","accent":"억양/강세","eleven":"열하나/11","ambient":"주변의/은은한","mileage":"주행 거리/연비","prostate":"전립선","adaptor":"어댑터/접속기","pledge":"맹세(하다)/서약","vampire":"흡혈귀/뱀파이어","xerox":"제록스/복사","dice":"주사위/깍둑썰다","softball":"소프트볼","quad":"4중의/사각 안뜰","dock":"부두/선창","differently":"다르게","nextel":"넥스텔","framing":"틀 짜기/액자/누명","organized":"조직된/정돈된","blocking":"차단/막기","rwanda":"르완다","dispatch":"파견(하다)/발송","papua":"파푸아","hint":"힌트/암시","armor":"갑옷/장갑","reasoning":"추론/논리","picking":"고르기/채취","charitable":"자선의/너그러운","ccd":"전하결합소자","researcher":"연구원/연구자","watershed":"분수령/유역","nudity":"나체/벌거벗음","viral":"바이러스의/입소문의","laden":"가득 실은/짐을 진","realtor":"부동산 중개인","merge":"합병하다/병합하다","privilege":"특권/특혜","edgar":"에드거(이름)","chassis":"차대/섀시","estimation":"추정/평가","barn":"헛간/외양간","pushing":"미는","fleece":"양털/플리스","pediatric":"소아과의","fare":"요금/운임","pierce":"꿰뚫다/관통하다","dressing":"드레싱/소스/붕대","bald":"대머리의/벗겨진","craps":"크랩스(주사위 게임)","frost":"서리","mold":"곰팡이/틀/주조하다","dame":"여성/부인","sally":"샐리(이름)","drilling":"시추/드릴 작업","breach":"위반/(관계)단절","whale":"고래","benchmark":"기준(점)/벤치마크","idle":"한가한/놀고 있는","mustang":"머스탱/야생마","unauthorized":"무단의/허가받지 않은","antibody":"항체","competent":"유능한/적격의","momentum":"탄력/추진력","fin":"지느러미","io":"이오(목성의 위성)","pastor":"목사","calvin":"캘빈(이름)","shark":"상어","contributor":"기여자/기고가","grateful":"감사하는","emerald":"에메랄드/에메랄드빛","gradually":"점차/서서히","laughing":"웃는","cliff":"절벽/벼랑","desirable":"바람직한/탐나는","tract":"지대/(신체)관/소책자","ballet":"발레","journalist":"기자/언론인","abraham":"아브라함","bumper":"범퍼","garlic":"마늘","shine":"빛나다","senegal":"세네갈","explosion":"폭발","cove":"작은 만/후미","ozone":"오존","tariff":"관세/요금표","muscles":"근육(복수)","serum":"혈청/세럼","motherboard":"메인보드/마더보드","runtime":"실행 시간/런타임","focal":"초점의","bibliographic":"서지의/문헌의","vagina":"질(膣)","eden":"에덴/낙원","champagne":"샴페인","decimal":"소수의/십진의","dip":"살짝 담그다/내리막","samba":"삼바","hostel":"호스텔/숙소","mongolia":"몽골","penguin":"펭귄","magical":"마법의/신비로운","irrigation":"관개/물 대기","reprint":"재인쇄/증쇄","centered":"중심에 둔/집중된","flex":"구부리다/유연성","yearly":"매년의/연간의","penetration":"침투/관통","wound":"상처","belle":"미녀","conviction":"확신/유죄 판결","hash":"해시/잘게 썬 음식","hamburg":"함부르크","lazy":"게으른","dow":"다우(지수)","petite":"몸집이 작은","nomination":"지명/추천","empirical":"경험적인/실증적인","rotary":"회전식의/로터리","worm":"벌레/지렁이","discrete":"분리된/별개의","beginner":"초보자/초심자","polyester":"폴리에스터","cubic":"입방의/세제곱의","deaf":"귀먹은/청각장애의","sapphire":"사파이어","mats":"매트(복수)","remainder":"나머지/잔여","marking":"표시/채점","serbia":"세르비아","sheriff":"보안관","griffin":"그리핀(이름)","guyana":"가이아나","blah":"어쩌고저쩌고/시시한","mime":"무언극/마임","neighbor":"이웃","elect":"선출하다/선택된","concentrate":"집중하다/농축하다","intimate":"친밀한/은밀한","preston":"프레스턴","deadly":"치명적인","cunt":"(욕설)여성기","refrigerator":"냉장고","exclusion":"제외/배제","holocaust":"대학살/홀로코스트","keen":"열망하는/예리한","flyer":"전단지/(잘)나는 것","dosage":"복용량/투여량","navigator":"항해사/내비게이터","baking":"제빵/굽기","adaptive":"적응하는/적응성의","needle":"바늘","gg":"좋은 게임(약자)","cathedral":"대성당","nirvana":"열반/극락","destiny":"운명","generous":"관대한/넉넉한","climb":"오르다","blowing":"부는/불기","heated":"가열된/뜨거워진","hay":"건초","cardiovascular":"심혈관의","cardiac":"심장의","dover":"도버","accompanying":"동반하는/첨부된","vatican":"바티칸","brutal":"잔인한/혹독한","selective":"선택적인/까다로운","token":"토큰/표시/상징적인","zinc":"아연","sacrifice":"희생(하다)/제물","guru":"전문가/스승","isa":"개인종합자산관리계좌","removable":"제거 가능한/탈착식의","gibraltar":"지브롤터","levy":"부과(하다)/징수","anthropology":"인류학","aberdeen":"애버딘","malpractice":"의료 과실/부당 행위","educated":"교육받은/박식한","burke":"버크(이름)","necessity":"필요(성)/필수품","rendering":"표현/렌더링","inserted":"삽입된/끼워진","suburban":"교외의","hepatitis":"간염","nationally":"전국적으로","tomato":"토마토","andorra":"안도라","waterproof":"방수의","flush":"(물을)내리다/홍조","waiver":"포기(서)/면제","pale":"창백한/옅은","humanitarian":"인도주의의/인도적인","survivor":"생존자","alexandria":"알렉산드리아","moses":"모세","undertake":"착수하다/떠맡다","declare":"선언하다/신고하다","continuously":"계속해서/끊임없이","tear":"눈물/찢다","convertible":"전환 가능한/오픈카","stranger":"낯선 사람","nest":"둥지","pam":"팸(이름)","painful":"고통스러운/아픈","velvet":"벨벳","tribunal":"재판소/심판원","funky":"펑키한/특이한","nowhere":"아무데도","cop":"경찰","paragraphs":"문단(복수)","gale":"강풍/돌풍","dim":"어둑한/흐릿한","mattress":"매트리스/침대 요","likewise":"마찬가지로/또한","banana":"바나나","slovak":"슬로바키아의","reservoir":"저수지/저장소","idol":"우상/아이돌","bloody":"피투성이의/지독한","mixer":"믹서/혼합기","demographic":"인구 통계의","charming":"매력적인/멋진","tooth":"이/치아","disciplinary":"징계의/규율의","disclose":"공개하다/밝히다","washer":"세탁기/와셔","upset":"속상한","springer":"스프링거(이름)","beside":"~옆에","rebound":"되튀다/반등","mentor":"멘토/조언자","helicopter":"헬리콥터","pencil":"연필","freeze":"얼다/얼리다","abu":"아부","sphere":"구(球)/영역","moss":"이끼","concord":"콩코드/화합","graduated":"졸업한/눈금이 있는","surprising":"놀라운","walnut":"호두","ladder":"사다리","dramatically":"극적으로/급격히","cork":"코르크(마개)","workout":"운동/연습","mali":"말리","yugoslavia":"유고슬라비아","characterization":"성격 묘사/특징짓기","colon":"결장/쌍점(:)","purse":"지갑/핸드백","contamination":"오염","endangered":"멸종 위기의","compromise":"타협/절충","masturbation":"자위(행위)","optimize":"최적화하다","dome":"돔/둥근 지붕","expiration":"만료/만기","align":"정렬하다/맞추다","peripheral":"주변의/주변 장치","engaging":"매력적인/마음을 끄는","negotiation":"협상/교섭","crest":"꼭대기/볏/문장","confidentiality":"기밀(성)","welding":"용접","orgasm":"오르가슴/절정","deferred":"연기된/유예된","heel":"발뒤꿈치/굽","alloy":"합금","polished":"광택 나는/세련된","gently":"부드럽게/조심스럽게","controversial":"논란이 많은","blanket":"담요","bloom":"꽃이 피다/개화","recovered":"회복된/되찾은","surge":"급증/쇄도","frontpage":"1면/첫 페이지","possess":"소유하다/지니다","demanding":"까다로운/힘든","defensive":"방어적인/수비의","sip":"홀짝이다/한 모금","forbidden":"금지된","vanilla":"바닐라","deutschland":"독일(독일어)","picnic":"소풍/피크닉","spank":"엉덩이를 때리다","practitioner":"개업의/전문가","dumb":"멍청한/벙어리의","hollow":"속이 빈/움푹한","vault":"금고(실)/도약","securely":"안전하게/단단히","groove":"홈/그루브","revelation":"폭로/계시","pursuit":"추구/추격","delegation":"대표단/위임","backing":"지원/뒷받침","dee":"디(글자)","figured":"알아냈다","orbit":"궤도","niger":"니제르","bacon":"베이컨","heater":"난방기/히터","colony":"식민지/군집","cannon":"대포","circus":"서커스","enclosed":"동봉된/둘러싸인","temporarily":"일시적으로","transmit":"전송하다/전달하다","fatty":"지방이 많은/뚱뚱한","pressed":"눌린/다림질된","hunger":"배고픔/굶주림","sic":"원문대로/(개를)부추기다","municipality":"지방 자치체","detective":"형사/탐정","cement":"시멘트/굳히다","missile":"미사일","psychiatry":"정신의학","deborah":"데버라(이름)","glow":"빛나다/홍조","gabriel":"가브리엘(천사)","auditor":"감사관/청강생","aquarium":"수족관/어항","violin":"바이올린","prophet":"예언자/선지자","bracket":"괄호/(가격)구간/받침대","oxide":"산화물","magnificent":"웅장한/훌륭한","colleague":"동료","promptly":"즉시/정확히","adaptation":"적응/각색","enclosure":"동봉(물)/울타리","dividend":"배당금/이익","newark":"뉴어크","glucose":"포도당/글루코스","phantom":"유령/환영","norm":"규범/표준","westminster":"웨스트민스터","turtle":"거북","absorption":"흡수/몰두","fossil":"화석","hometown":"고향","apollo":"아폴로","persian":"페르시아의/페르시아어","communist":"공산주의자(의)","jade":"옥(玉)/비취","scoop":"국자/특종/한 숟갈","foul":"더러운/반칙","keno":"키노(복권 게임)","somalia":"소말리아","verbal":"언어의/구두의","blink":"눈을 깜박이다","presently":"현재/곧","novelty":"새로움/신기함","librarian":"사서","stockholm":"스톡홀름","tamil":"타밀어/타밀족","pose":"자세/포즈","fuzzy":"솜털의/흐릿한","indonesian":"인도네시아의","therapist":"치료사/상담사","promising":"유망한/촉망받는","relaxation":"휴식/이완","goat":"염소","render":"~하게 만들다/표현하다","thereafter":"그 후에","temporal":"시간의/관자놀이의","sail":"항해하다/돛","forge":"위조하다/구축하다/대장간","dense":"빽빽한/밀도 높은","brave":"용감한","forwarding":"전달/운송","awful":"끔찍한","nightmare":"악몽","southampton":"사우샘프턴","istanbul":"이스탄불","impose":"부과하다/강요하다","telescope":"망원경","asbestos":"석면","portsmouth":"포츠머스","pod":"꼬투리/(분리)캡슐","advancement":"발전/진보","harassment":"괴롭힘/희롱","willow":"버드나무","bolt":"볼트/빗장/번개","gage":"담보/측정기","whore":"매춘부/창녀","wagon":"마차/짐수레","knock":"두드리다","urge":"촉구하다/충동","replication":"복제/반복","inexpensive":"저렴한/값싼","roland":"롤런드(이름)","optimum":"최적의/최상의","neon":"네온","quilt":"누비이불/퀼트","creature":"생물/동물","ours":"우리의 것","syracuse":"시러큐스","refresh":"새로 고치다/생기를 되찾다","coordinated":"조정된/조화로운","maldives":"몰디브","firmware":"펌웨어","antarctica":"남극 대륙","cope":"대처하다/극복하다","shepherd":"양치기/목자","canberra":"캔버라","cradle":"요람/발상지","chancellor":"총리/총장","mambo":"맘보","lime":"라임/석회","flour":"밀가루","controversy":"논쟁/논란","legendary":"전설적인","choir":"합창단/성가대","jumping":"점프/뛰어오르는","polymer":"중합체/폴리머","hygiene":"위생","poultry":"가금류/닭고기","virtue":"미덕/장점","immunology":"면역학","mandate":"권한/지시/임무","departmental":"부서의/학과의","corpus":"말뭉치/집성","terminology":"전문 용어","gentleman":"신사","reproduce":"번식하다/재현하다","threatening":"위협적인","daisy":"데이지","halifax":"핼리팩스","cursor":"커서","assembled":"조립된/모인","crude":"조잡한/원유의","viking":"바이킹","myrtle":"머틀(이름)/도금양","cleanup":"청소/정리","yarn":"실/털실","knit":"뜨개질하다","mug":"머그잔","bother":"귀찮게 하다","budapest":"부다페스트","conceptual":"개념의/개념적인","bhutan":"부탄","redhead":"빨간 머리(사람)","translator":"번역가/통역사","tractor":"트랙터","allah":"알라(신)","continent":"대륙","unwrap":"포장을 풀다","longitude":"경도","resist":"저항하다/참다","pike":"창/강꼬치고기","insertion":"삽입","instrumentation":"계측(기)/기악 편성","constraint":"제약/제한","touched":"감동받은/만진","cologne":"쾰른/향수","ranger":"순찰 대원/레인저","insulation":"단열(재)/절연","marsh":"습지/늪","infringement":"침해/위반","bent":"구부러진/굽은","subjective":"주관적인","asylum":"망명/보호 시설","stake":"말뚝/지분","cocktail":"칵테일","arbor":"나무 그늘/정자","poison":"독","of":"~의","all":"모두","an":"하나의","us":"우리를","no":"아니오","also":"또한","these":"이것들","its":"그것의","go":"가다","tell":"말하다","good":"좋은","book":"책/예약하다","friend":"친구","part":"부분","question":"질문","fact":"사실","month":"달/월","lot":"많음","law":"법","minute":"분","body":"몸","parent":"부모/어버이","others":"다른 사람들","market":"시장","drug":"약/마약","police":"경찰","mind":"마음/정신","decision":"결정","fast":"빠른","empty":"빈","strong":"강한","bird":"새","moon":"달","mountain":"산","meal":"식사","angry":"화난","afraid":"두려운","does":"하다(3인칭)","during":"~동안","large":"큰","medical":"의료의","clothing":"의류/옷","ms":"~씨(여성 존칭)","wed":"결혼하다","wine":"와인","regarding":"~에 관하여","fiction":"소설/허구","scientific":"과학적인","intended":"의도된/예정된","equal":"동등한/같다","protocol":"규약/의정서/절차","dress":"드레스/옷을 입다","indeed":"정말로","audience":"청중/관객","agenda":"의제/안건","pregnancy":"임신","formal":"공식적인/격식 있는","ultra":"극도의/초(超)","significantly":"상당히/중요하게","calculate":"계산하다/산정하다","unlike":"~와 달리/같지 않은","outer":"바깥쪽의/외부의","toilet":"화장실/변기","designing":"설계하는/디자인","scientist":"과학자","taxation":"과세/세금","collapse":"붕괴(되다)/무너지다","watt":"와트","comparable":"비슷한/비교할 만한","grave":"무덤/심각한","unexpected":"예상치 못한/뜻밖의","consist":"구성되다/이루어지다","variance":"차이/불일치","allow":"허락하다","cause":"원인/일으키다","choose":"고르다","decide":"결정하다","describe":"묘사하다/설명하다","expect":"기대하다","follow":"따르다","happen":"일어나다","include":"포함하다","marry":"결혼하다","provide":"제공하다","reach":"닿다/도달하다","share":"나누다/공유하다","wait":"기다리다","careful":"조심스러운","famous":"유명한","fine":"괜찮은","important":"중요한","similar":"비슷한/유사한","terrible":"끔찍한","almost":"거의","maybe":"아마","often":"자주","perhaps":"아마","sure":"확실한","afternoon":"오후","weekend":"주말","birthday":"생일","street":"거리","garden":"정원","luggage":"짐/수하물","baggage":"수하물","customs":"세관","aisle":"통로","discount":"할인","fee":"수수료/요금","occupied":"사용 중인","vacant":"비어 있는","prescription":"처방전","symptom":"증상","appointment":"약속/예약","directions":"길 안내/방향","map":"지도","subway":"지하철","complaint":"불평/항의","withdraw":"인출하다"};
