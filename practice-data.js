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
  const keyHit = !K.key.length || keyMissing.length<K.key.length;
  /* 프레임에 ~ 가 있으면 뒤에 뭔가는 붙여야 한다(Can I get ~?).
     문장 자체가 프레임이면(Hello. / How long does it take?) 그대로 말해도 정답이다. */
  const openFrame=/~/.test(String((it.frame&&it.frame.frame)||""));
  let ok = myOk ? true
           : frameOk && ((K.needKey && K.key.length) ? keyHit : (openFrame ? extra>0 : true));
  /* 같은 상황을 다르게 말해도 맞는 경우가 있다 (짐 기다릴 때 will it be? 도 자연스러움).
     예문 하나만 정답으로 보면 맞는 영어를 틀렸다고 가르치게 된다. */
  let altUsed=null;
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
