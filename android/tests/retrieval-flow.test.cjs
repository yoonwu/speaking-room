const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),ANSWER='Can I get some water?';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const wav=(()=>{const b=Buffer.alloc(684);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;})();

// Run the real four scripts, grader, reward and mastery code. Only browser and
// native I/O plus wall-clock time are simulated; no production function is replaced.
function setup({realtime=false,prepare,route,seed={}}={}){
 const records=new Map(Object.entries(seed)),elements=new Map(),native=[],captures=[],requests=[],timers=new Map();
 let now=Date.UTC(2026,10,7),sequence=0,random=71;
 const math=Object.create(Math);math.random=()=>{random=(random*1664525+1013904223)>>>0;return random/4294967296;};
 const element=()=>{const listeners=new Map();return {style:{},dataset:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,isConnected:true,addEventListener(name,callback){listeners.set(name,callback);},setAttribute(){},focus(){},remove(){this.isConnected=false;},insertBefore(){},appendChild(child){if(child.id)elements.set('#'+child.id,child);},showModal(){this.open=true;},close(){this.open=false;listeners.get('close')?.();this.onclose?.();},querySelector:selector=>get(selector),querySelectorAll(selector){if(selector!=='[data-word]')return [];return [...this.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].flatMap(([,attributes,text])=>{const word=attributes.match(/data-word="([^"]+)"/);if(!word)return [];const button=get('[data-word="'+word[1]+'"]');button.dataset.word=word[1];button.textContent=text.replace(/<[^>]*>/g,'');button.className=attributes.match(/class="([^"]*)"/)?.[1]||'';return [button];});},getTracks:()=>[]};};
 const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const clockDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const context={window:{addEventListener(){},srNativePracticeSpeech:true,srNativePracticePlayback:true,srNativePracticeStreaming:true,srNativePracticeMicReady:true,srNativePracticeRealtime:realtime,srNativePracticeBackgroundPreparation:realtime},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(child){if(child.id)elements.set('#'+child.id,child);}}},navigator:{},localStorage:{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value))},setTimeout:(fn,ms=0)=>{const id=++sequence;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),location:{reload(){}},console,Date:clockDate,Math:math,URL,Blob,AbortController,Response,atob:s=>Buffer.from(s,'base64').toString('binary')};
 context.fetch=async(url,options={})=>{const request={url:String(url),path:new URL(url,'https://app.test').pathname,options};requests.push(request);if(route){const response=await route(request);if(response!==undefined)return response;}if(request.path==='/practice-ai/status')return json({enabled:true,creditsVerified:true});if(request.path==='/practice-realtime/status')return json({available:realtime});return new Response('{}',{status:404});};
 context.window.srNativeRequest=(action,data,onCaptured,onReady)=>{
  native.push({action,data,at:now});
  if(action==='preparePracticeFast')return typeof prepare==='function'?Promise.resolve().then(()=>prepare(data)):Promise.resolve(prepare??{prepared:true,permissionGranted:true});
  if(['streamPractice','streamPracticeFast','recordPractice'].includes(action)){
   const pending=deferred(),capture={action,data,onCaptured,onReady,...pending,ready(){onReady?.();},end(){onCaptured?.();},complete(text=ANSWER,extra={}){onCaptured?.();pending.resolve({text,audioBase64:wav.toString('base64'),...extra});}};captures.push(capture);return pending.promise;
  }
  if(action==='status')return Promise.resolve({practiceSpeech:true,practicePlayback:true,practiceStreaming:true,practiceMicReady:true,practiceRealtime:realtime});
  return Promise.resolve({});
 };
 vm.createContext(context);for(const file of ['practice-data.js','practice-ai.js','practice.js','home-support.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 const run=source=>vm.runInContext(source,context),flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
 const advance=async ms=>{const end=now+ms;await flush();for(;;){let next;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();};
 const start=({intro=false,two=false}={})=>run(`startDrill([{frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:${JSON.stringify(ANSWER)},ko:'물 한 잔을 부탁해보세요.'},_intro:${intro}}${two?",{frame:TRAVEL_BY_ID.travel_cant_find,ex:{en:\"I can't find my phone.\",ko:'휴대폰을 못 찾겠다고 해보세요.'},_intro:false}":''}],'기본표현')`);
 const type=text=>{get('#autoType').onclick();const input=get('#autoInput');input.value=text;input.oninput();return input.onkeydown({key:'Enter',target:input,preventDefault(){}});};
 const lastEvent=()=>run('supportEvents().filter(e=>e.fid).at(-1)'),mastery=()=>run(`learningSentenceMastery(${JSON.stringify(ANSWER)})`);
 return {run,context,records,elements,native,captures,requests,get,flush,advance,start,type,lastEvent,mastery,get now(){return now;}};
}
function observeCues(h){const cues=[],param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});h.context.window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={};}resume(){return Promise.resolve();}createGain(){return {gain:param(),connect(){},disconnect(){}};}createOscillator(){const cue={frequency:param(),connect(){},disconnect(){},start(){cue.started=true;},stop(){}};cues.push(cue);return cue;}};return cues;}
function browserAudio(h){
 const state={loud:false,recognizers:[],recorders:[]},param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}}),connection=()=>({connect(){},disconnect(){}});
 delete h.context.window.srNativeRequest;for(const name of ['Speech','Playback','Streaming','MicReady','Realtime','BackgroundPreparation'])h.context.window['srNativePractice'+name]=false;
 h.context.navigator.mediaDevices={getUserMedia:async()=>({active:true,getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{readyState:'live',muted:false}]})};
 h.context.window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={};}resume(){return Promise.resolve();}createGain(){return {...connection(),gain:param()};}createOscillator(){return {...connection(),frequency:param(),start(){},stop(){}};}createMediaStreamSource(){return connection();}createAnalyser(){return {...connection(),getByteTimeDomainData(buffer){buffer.fill(state.loud?145:128);}};}};
 h.context.MediaRecorder=class{static isTypeSupported(){return false;}constructor(){this.state='inactive';this.mimeType='audio/wav';state.recorders.push(this);}start(){this.state='recording';}stop(){if(this.state==='inactive')return;this.state='inactive';this.ondataavailable?.({data:new Blob([wav],{type:'audio/wav'})});this.onstop?.();}};
 h.context.window.SpeechRecognition=class{constructor(){state.recognizers.push(this);}start(){}stop(){this.onend?.();}abort(){}final(text=ANSWER){const result=[{transcript:text}];result.isFinal=true;this.onresult?.({resultIndex:0,results:[result]});}};
 return state;
}
const actions=h=>h.get('.auto-actions').innerHTML;
async function nativeAnswer(h,options={}){
 const {press=0,preparation=0,onset=100,captureDuration=1500,recognition=0,text=ANSWER}=options;
 await h.advance(press);const pending=h.get('#autoMic').onclick();await h.flush();
 await h.advance(preparation);const capture=h.captures.at(-1);assert.ok(capture,'one native capture must have started');capture.ready();
 await h.advance(captureDuration);capture.end();await h.advance(recognition);
 const fields={captureDurationMs:captureDuration};if(!Object.hasOwn(options,'onset')||options.onset!==undefined)fields.speechStartOffsetMs=onset;
 capture.complete(text,fields);await pending;await h.flush();return capture;
}

test('a correct covered recall has only Next as the main action; a wrong recall keeps retry',async()=>{
 for(const correct of [true,false]){
  const h=setup();h.start();h.type('Can I get a towel?');assert.match(actions(h),/id="autoRetry"/);
  const pending=h.get('#autoRetry').onclick();await h.flush();const capture=h.captures[0];capture.ready();capture.complete(correct?ANSWER:'Can I get a towel?',{speechStartOffsetMs:100,captureDurationMs:1500});await pending;await h.flush();
  assert.equal(h.lastEvent().ok,correct);assert.match(actions(h),/id="autoNext"/);
  if(correct){assert.doesNotMatch(actions(h),/id="autoRetry"/);assert.equal((actions(h).match(/<button/g)||[]).length,1);}
  else assert.match(actions(h),/id="autoRetry"/);
  assert.equal(h.run('practiceReward().total'),10,'the initial typed pattern-only reward is the group allowance');assert.equal(h.lastEvent().xp,0,'covered retries do not add to a consumed partial allowance');
 }
});

test('a first introduction or hinted correct answer offers covered recall once and then advances cleanly',async()=>{
 for(const intro of [true,false]){
  const h=setup();h.start({intro});if(!intro)h.get('#autoWord').onclick();h.type(ANSWER);assert.equal(h.lastEvent().ok,true);assert.match(actions(h),/id="autoRetry"/);assert.equal(h.run('practiceReward().total'),15);
  const pending=h.get('#autoRetry').onclick();await h.flush();const capture=h.captures[0];capture.ready();capture.complete(ANSWER,{speechStartOffsetMs:100,captureDurationMs:1500});await pending;await h.flush();
  assert.doesNotMatch(actions(h),/id="autoRetry"/);assert.match(actions(h),/id="autoNext"/);assert.equal(h.run('practiceReward().total'),15,'correct learning recall cannot farm a second reward');assert.equal(h.lastEvent().fast,false);
 }
});

test('response time includes button delay plus actual native voice onset, excluding system preparation',async()=>{
 const cases=[
  {press:1000,onset:500,preparation:0,response:1500,fast:true},
  {press:2800,onset:200,preparation:0,response:3000,fast:true},
  {press:2800,onset:400,preparation:0,response:3200,fast:false},
  {press:3100,onset:0,preparation:0,response:3100,fast:false},
  {press:1000,onset:500,preparation:2500,response:1500,fast:true},
 ];
 for(const scenario of cases){
  const h=setup();h.start();await nativeAnswer(h,scenario);const event=h.lastEvent(),mastery=h.mastery();
  assert.equal(event.responseMs,scenario.response,JSON.stringify(scenario));assert.equal(event.withinThreeSeconds,scenario.fast);assert.equal(event.speedEligible,true);assert.equal(event.fast,scenario.fast);
  assert.equal(event.xp,scenario.fast?30:15);assert.equal(h.run('practiceReward().total'),scenario.fast?30:15);assert.equal(mastery.score,scenario.fast?18:10);assert.equal(mastery.fastStreak,scenario.fast?1:0);assert.equal(mastery.fullyLearned,false);
 }
});

test('a first pattern-only voice answer earns fifteen fast or ten slow with encouraging feedback but no full mastery',async()=>{
 for(const scenario of [{press:1000,onset:500,response:1500,xp:15},{press:2800,onset:400,response:3200,xp:10},{press:3100,onset:0,response:3100,xp:10},{press:1000,preparation:2500,onset:500,response:1500,xp:15}]){
  const h=setup();h.start();assert.equal(h.run(`travelGrade(autoDrill.items[0],'Can I get a towel?').blockHit`),true);await nativeAnswer(h,{...scenario,text:'Can I get a towel?'});const event=h.lastEvent();
  assert.equal(event.ok,false);assert.equal(event.expressionOnly,true);assert.equal(event.fast,false,'a fast partial is never a full fast answer');assert.equal(event.responseMs,scenario.response);assert.equal(event.xp,scenario.xp);assert.equal(h.run('practiceReward().total'),scenario.xp);assert.match(h.get('#autoStat').textContent,new RegExp('\\+'+scenario.xp+' XP'));assert.doesNotMatch(h.get('#autoStat').textContent,/\+0 XP/);
  assert.equal(h.mastery().score,0);assert.equal(h.mastery().correct,0);assert.equal(h.mastery().fastCorrect,0);assert.equal(h.mastery().fullyLearned,false);assert.equal(h.run(`travelStat('travel_can_i_get').ok`),0);assert.ok(h.run('missCount()>0'));assert.match(actions(h),/id="autoRetry"/);assert.equal(typeof h.get('[data-word="water"]').onclick,'function','the missed word remains available for focused practice');
 }
});

test('a pattern-only reward is one group allowance across covered retries, copied questions and duplicate delivery',async()=>{
 for(const fast of [true,false]){
  const h=setup();h.start();await nativeAnswer(h,{press:fast?1000:3100,onset:100,text:'Can I get a towel?'});const cap=fast?15:10,group=h.lastEvent().attemptGroupId;assert.equal(h.lastEvent().xp,cap);
  let pending=h.get('#autoRetry').onclick();await h.flush();h.captures.at(-1).ready();h.captures.at(-1).complete('Can I get a towel?',{speechStartOffsetMs:100,captureDurationMs:1000});await pending;assert.equal(h.lastEvent().expressionOnly,true);assert.equal(h.lastEvent().xp,0);assert.match(actions(h),/id="autoRetry"/);
  pending=h.get('#autoRetry').onclick();await h.flush();h.captures.at(-1).ready();h.captures.at(-1).complete(ANSWER,{speechStartOffsetMs:100,captureDurationMs:1000});await pending;assert.equal(h.lastEvent().ok,true);assert.equal(h.lastEvent().xp,0);assert.equal(h.run('practiceReward().total'),cap);assert.doesNotMatch(actions(h),/id="autoRetry"/);
  const count=h.run('supportEvents().length');h.run(`autoDrillFinish('Can I get some water?',{attemptId:'duplicate-partial-final'})`);assert.equal(h.run('supportEvents().length'),count);h.get('#autoNext').onclick();assert.equal(h.run('autoDrill.items[autoDrill.idx]._attemptGroupId'),group);h.type(ANSWER);assert.equal(h.lastEvent().xp,0);assert.equal(h.run('practiceReward().total'),cap);
 }
});

test('pattern-only practice preserves existing mastery points while breaking a full-answer fast streak',async()=>{
 const h=setup();h.start();await nativeAnswer(h,{press:100,onset:100});assert.equal(h.mastery().score,18);assert.equal(h.mastery().fastStreak,1);h.start();await nativeAnswer(h,{press:100,onset:100,text:'Can I get a towel?'});
 assert.equal(h.mastery().score,18,'partial mastery delta is zero');assert.equal(h.mastery().correct,1);assert.equal(h.mastery().fastCorrect,1);assert.equal(h.mastery().fastStreak,0);assert.equal(h.mastery().fullyLearned,false);assert.equal(h.lastEvent().ok,false);assert.equal(h.lastEvent().xp,15);
});

test('recognition completion and recording length cannot replace first actual voice onset',async()=>{
 const h=setup();h.start();await nativeAnswer(h,{press:1000,onset:150,captureDuration:2000,recognition:4500});const event=h.lastEvent();
 assert.equal(event.responseMs,1150);assert.equal(event.fast,true);assert.equal(event.xp,30);assert.ok(h.now-h.run('autoDrill.t0')>7000,'provider completion is much later than the answer onset');
});

test('browser answers use real VAD onset rather than tap, recognition completion or recording end',async()=>{
 for(const press of [1000,2800]){
  const h=setup(),audio=browserAudio(h);h.start();await h.advance(press);const pending=h.get('#autoMic').onclick();await h.advance(200);await pending;
  assert.equal(audio.recorders.length,1);assert.equal(h.run('qzRecording'),true);await h.advance(300);audio.loud=true;await h.advance(30);await h.advance(1800);
  audio.recognizers[0].final();await h.flush();const event=h.lastEvent();assert.ok(event);assert.equal(event.responseMs,press+330);assert.equal(event.speedEligible,true);assert.equal(event.fast,press===1000);assert.equal(event.xp,press===1000?30:15);
  assert.equal(h.requests.filter(request=>request.options.method==='POST').length,0,'the browser recognizer supplies text while the real VAD supplies onset');
 }
});

test('missing, invalid or out-of-capture native onset evidence never receives a fast reward',async()=>{
 for(const onset of [undefined,null,-1,NaN,Infinity,1501]){
  const h=setup();h.start();await nativeAnswer(h,{press:100,onset,captureDuration:1500});assert.equal(h.lastEvent().fast,false,String(onset));assert.equal(h.lastEvent().xp,15);assert.equal(h.mastery().fastCorrect,0);
 }
});

test('typed, introduced, hinted and retry answers cannot become fast mastery from a quick tap',async()=>{
 const typed=setup();typed.start();await typed.advance(100);typed.type(ANSWER);assert.equal(typed.lastEvent().typed,true);assert.equal(typed.lastEvent().fast,false);assert.equal(typed.lastEvent().xp,15);assert.equal(typed.mastery().fastCorrect,0);
 for(const kind of ['introduced','hinted','retry']){
  const h=setup();h.start({intro:kind==='introduced'});if(kind==='hinted')h.get('#autoWord').onclick();
  if(kind==='retry'){
   h.type('This is a towel.');const pending=h.get('#autoRetry').onclick();await h.flush();const capture=h.captures[0];capture.ready();capture.complete(ANSWER,{speechStartOffsetMs:100,captureDurationMs:1500});await pending;await h.flush();
  }else await nativeAnswer(h,{press:100,onset:100});
  assert.equal(h.lastEvent().fast,false,kind);assert.equal(h.lastEvent().xp,kind==='retry'?5:15);assert.equal(h.mastery().fastCorrect,0);
 }
});

test('question prewarm is background-only and cannot record, cue or request foreground permission',async()=>{
 const h=setup({realtime:true}),cues=observeCues(h);h.start();await h.flush();const background=h.native.filter(call=>call.action==='preparePracticeFast');
 assert.ok(background.length>0,'ready realtime question should prewarm');for(const call of background){assert.equal(call.data.background,true);assert.equal(call.data.expectedWords,5);}
 assert.equal(h.captures.length,0);assert.equal(cues.length,0);assert.equal(h.run('qzRecording||micPreparing'),false);assert.equal(h.run('supportEvents().length'),0);
});

test('a background-prepared microphone still validates foreground readiness and permission on the tap',async()=>{
 const h=setup({realtime:true,prepare:data=>data.background?{prepared:true,permissionGranted:true}:{prepared:false,permissionGranted:false,error:'마이크 사용을 허용해주세요.'}}),cues=observeCues(h);h.start();await h.flush();await h.advance(1000);await h.get('#autoMic').onclick();await h.flush();
 const foreground=h.native.filter(call=>call.action==='preparePracticeFast'&&call.data.background!==true);assert.equal(foreground.length,1);assert.equal(h.captures.length,0);assert.equal(cues.length,0);assert.match(h.get('#autoStat').textContent,/마이크 사용을 허용/);assert.equal(h.run('practiceReward().total'),0);
});

test('Next cancels the old background preparation and a late reply cannot capture or overwrite the new prompt',async()=>{
 const preparations=[],h=setup({realtime:true,prepare:data=>{const pending=deferred();preparations.push({data,...pending});return pending.promise;}}),cues=observeCues(h);h.start({two:true});await h.flush();
 h.type(ANSWER);await h.flush();const old=preparations.slice(),before=h.native.filter(call=>call.action==='recognizeCancel').length;h.get('#autoNext').onclick();await h.flush();
 assert.equal(h.run('autoDrill.idx'),1);assert.equal(h.run('autoDrill.items[1].ex.en'),"I can't find my phone.");assert.ok(h.native.filter(call=>call.action==='recognizeCancel').length>before,'new question cancels old prepared resources');
 const prompt=h.get('#sprintScroll').innerHTML;for(const pending of old)pending.resolve({prepared:true,permissionGranted:true});await h.flush();
 assert.equal(h.get('#sprintScroll').innerHTML,prompt);assert.equal(h.run('autoDrill.idx'),1);assert.equal(h.captures.length,0);assert.equal(cues.length,0);assert.equal(h.run('supportEvents().filter(e=>e.fid).length'),1);
});

test('profile changes discard a late timed native result before either learner can earn fast progress',async()=>{
 const h=setup();h.start();await h.advance(1000);const pending=h.get('#autoMic').onclick();await h.flush();const capture=h.captures[0];capture.ready();h.run(`learningProfileSwitch(learningProfileCreate('다른 학습자'))`);capture.complete(ANSWER,{speechStartOffsetMs:100,captureDurationMs:1500});await pending;await h.flush();
 assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.mastery().fastCorrect,0);h.run(`learningProfileSwitch('legacy')`);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.mastery().fastCorrect,0);
});

const sentenceProgress=h=>h.run(`JSON.stringify({idx:autoDrill?.idx,items:autoDrill?.items,results:autoDrill?.results,events:supportEvents(),reward:practiceReward(),mastery:learningSentenceMastery(${JSON.stringify(ANSWER)})})`);
function openAnswerWord(h,word='water'){
 const button=h.get('[data-word="'+word+'"]');assert.equal(typeof button.onclick,'function','the actual answer word button is wired');button.onclick();assert.match(h.get('#answerWordInfo').innerHTML,/id="practiceAnswerWord"/);return h.get('#practiceAnswerWord').onclick();
}

test('two spoken word misses highlight and save the word, including on a covered-recall answer',async()=>{
 const h=setup();h.start();await nativeAnswer(h,{text:'Can I get coffee?'});assert.equal(h.run('autoDrill.items[0]._wordMisses.water'),1);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water`),undefined);
 h.run(`hSet('speakingroom:answer_vocab',{water:{en:'water',ko:'저장한 물 뜻',practiceCorrect:4}})`);
 const pending=h.get('#autoRetry').onclick();await h.flush();h.captures[1].ready();h.captures[1].complete('Can I get coffee?');await pending;await h.flush();
 assert.equal(h.run('autoDrill.items[0].recall'),true);assert.equal(h.run('autoDrill.items[0]._wordMisses.water'),2);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.en`),'water');assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.misses`),2);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),4);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.ko`),'저장한 물 뜻');assert.match(h.get('[data-word="water"]').className,/word-needs-practice/);
 const before=sentenceProgress(h);openAnswerWord(h);assert.match(h.get('#sheetContent').innerHTML,/<h3>water<\/h3>/);h.get('#wordPracticeBack').onclick();assert.equal(sentenceProgress(h),before);assert.equal(h.run('activeWordPractice'),null);
});

test('typed mistakes and accepted whole-sentence alternatives do not create word-miss diagnoses',async()=>{
 const typed=setup();typed.start();typed.type('Can I get coffee?');assert.equal(typed.run('autoDrill.items[0]._wordMisses'),undefined);assert.equal(typed.run(`hGet('speakingroom:answer_vocab',{}).water`),undefined);
 const accepted=setup();accepted.start();await nativeAnswer(accepted,{text:'Could I have some water?'});assert.equal(accepted.lastEvent().ok,true);assert.equal(accepted.run('autoDrill.items[0]._wordMisses'),undefined);assert.equal(accepted.run(`Object.keys(hGet('speakingroom:answer_vocab',{})).length`),0);
});

test('word practice uses one explicit accuracy capture and returns to the same sentence without awarding sentence progress',async()=>{
 const h=setup();h.start();h.type('Can I get coffee?');h.run(`PracticeAI.setMode('meaning')`);const before=sentenceProgress(h),group=h.run('autoDrill.items[0]._attemptGroupId');openAnswerWord(h);await h.flush();
 assert.equal(h.captures.length,0,'opening or listening to a word never starts recording');h.get('#wordPracticeListen').onclick();await h.flush();assert.ok(h.requests.some(request=>request.path==='/tts'&&new URL(request.url).searchParams.get('text')==='water'));
 const pending=h.get('#wordPracticeMic').onclick();await h.flush();assert.equal(h.captures.length,1);assert.equal(h.captures[0].action,'streamPractice');assert.equal(h.captures[0].data.expectedWords,1);assert.deepEqual(Object.keys(h.captures[0].data),['expectedWords']);await h.get('#wordPracticeMic').onclick();assert.equal(h.captures.length,1,'duplicate taps cannot start a second word capture');
 h.captures[0].ready();h.captures[0].complete(' WATER! ',{speechStartOffsetMs:100,captureDurationMs:1000});await pending;await h.flush();assert.match(h.get('#wordPracticeStatus').textContent,/✓ water/);assert.match(h.get('#wordPracticeBack').textContent,/문장으로 돌아가 다시 말하기/);assert.equal(sentenceProgress(h),before);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),1);assert.equal(h.run('answerVoiceUrl'),null);assert.equal(h.requests.filter(request=>request.options.method==='POST').length,0,'focused word practice never calls GPT');
 assert.equal(h.run('PracticeAI.getMode()'),'meaning','word practice does not change the learner setting');h.run(`PracticeAI.setMode('accuracy')`);const returning=h.get('#wordPracticeBack').onclick();await h.flush();assert.equal(h.run('activeWordPractice'),null);assert.equal(h.run('autoDrill.idx'),0);assert.equal(h.run('autoDrill.items[0]._attemptGroupId'),group);assert.equal(h.run('autoDrill.items[0].recall'),true);assert.equal(h.captures.length,2);assert.equal(h.captures[1].data.expectedWords,5);assert.equal(h.run('autoDrill.results.length'),1);
 h.captures[1].ready();h.captures[1].complete();await returning;await h.flush();assert.equal(h.run('autoDrill.results.length'),2);assert.equal(h.run('practiceReward().total'),10,'word practice and sentence retry cannot add to the consumed partial allowance');assert.equal(h.lastEvent().xp,0);
});

test('word mismatch and silence remain focused and never change sentence XP, mastery or attempts',async()=>{
 for(const heard of ['coffee','waters','water please','']){
  const h=setup();h.start();h.type('Can I get coffee?');const before=sentenceProgress(h);openAnswerWord(h);const pending=h.get('#wordPracticeMic').onclick();await h.flush();h.captures[0].ready();h.captures[0].complete(heard);await pending;await h.flush();
  assert.equal(sentenceProgress(h),before,heard);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water?.practiceCorrect||0`),0);assert.ok(h.run('activeWordPractice'));assert.doesNotMatch(h.get('#wordPracticeStatus').textContent,/✓/);assert.doesNotMatch(h.get('#wordPracticeBack').textContent,/다시 말하기/);assert.match(h.get('#sheetContent').innerHTML,/문장으로 돌아가기/);h.get('#wordPracticeBack').onclick();assert.equal(sentenceProgress(h),before);
 }
});

test('closing word practice cancels capture before a late response can decode audio or alter the sentence',async()=>{
 for(const close of ['back','close','escape']){
  const h=setup();h.start();h.type('Can I get coffee?');const before=sentenceProgress(h),dialog=openAnswerWord(h),pending=h.get('#wordPracticeMic').onclick();await h.flush();h.captures[0].ready();const cancels=h.native.filter(call=>call.action==='recognizeCancel').length;
  if(close==='back')h.get('#wordPracticeBack').onclick();else if(close==='close')h.get('#sheetClose').onclick();else dialog.close();
  assert.equal(h.run('activeWordPractice'),null);assert.ok(h.native.filter(call=>call.action==='recognizeCancel').length>cancels);h.context.atob=()=>{throw Error('closed word audio must not be decoded');};h.captures[0].complete('water');await pending;await h.flush();assert.equal(sentenceProgress(h),before,close);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water?.practiceCorrect||0`),0);assert.equal(h.run('qzRecording||micPreparing'),false);
 }
});

test('changing learners during word capture closes the sheet and discards its late success in both profiles',async()=>{
 const h=setup();h.start();h.type('Can I get coffee?');const before=h.run('supportEvents().length');openAnswerWord(h);const pending=h.get('#wordPracticeMic').onclick();await h.flush();h.captures[0].ready();h.run(`learningProfileSwitch(learningProfileCreate('새 학습자'))`);h.context.atob=()=>{throw Error('previous learner word audio must not be decoded');};h.captures[0].complete('water');await pending;await h.flush();
 assert.equal(h.run('activeWordPractice'),null);assert.equal(h.run('autoDrill'),null);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water?.practiceCorrect||0`),0);h.run(`learningProfileSwitch('legacy')`);assert.equal(h.run('supportEvents().length'),before);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water?.practiceCorrect||0`),0);
});

test('word history survives reload and keeps the default learner separate from a newly created learner',async()=>{
 const h=setup();h.start();await nativeAnswer(h,{text:'Can I get coffee?'});const retry=h.get('#autoRetry').onclick();await h.flush();h.captures.at(-1).ready();h.captures.at(-1).complete('Can I get coffee?');await retry;openAnswerWord(h);
 let pending=h.get('#wordPracticeMic').onclick();await h.flush();h.captures.at(-1).ready();h.captures.at(-1).complete('water');await pending;h.get('#sheetClose').onclick();
 assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.misses`),2);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),1);
 const other=h.run(`learningProfileCreate('다른 단어 학습자')`);h.run(`learningProfileSwitch(${JSON.stringify(other)})`);assert.equal(h.run(`Object.keys(hGet('speakingroom:answer_vocab',{})).length`),0);h.start();h.type('Can I get coffee?');openAnswerWord(h);
 for(let i=0;i<2;i++){pending=h.get('#wordPracticeMic').onclick();await h.flush();h.captures.at(-1).ready();h.captures.at(-1).complete('water');await pending;}
 h.get('#sheetClose').onclick();const restored=setup({seed:Object.fromEntries(h.records)});assert.equal(restored.run('learningProfileId()'),other);assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),2);assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).water.misses||0`),0);
 restored.run(`learningProfileSwitch('legacy')`);assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).water.misses`),2);assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),1);assert.equal(restored.run(`JSON.parse(supportCollect()['speakingroom:answer_vocab']).water.practiceCorrect`),1);
});

test('word sync keeps both devices history, merges counters idempotently and uploads no unrelated recording storage',async()=>{
 let remote={water:{en:'water',ko:'이전 뜻',misses:5,practiceCorrect:1,lastT:100},coffee:{en:'coffee',ko:'커피',misses:2,practiceCorrect:1,lastT:150}};
 const h=setup({seed:{'speakingroom:answer_vocab':JSON.stringify({water:{en:'water',ko:'현재 뜻',misses:2,practiceCorrect:3,lastT:200},ticket:{en:'ticket',ko:'표',misses:2,lastT:180}}),'speakingroom:practice_recordings':JSON.stringify({audioBase64:'PRIVATE_RECORDING_MARKER'}),'speakingroom:last_voice':'PRIVATE_VOICE_MARKER','secret-token':'PRIVATE_TOKEN_MARKER'},route:request=>request.path==='/u'?json(request.options.method==='POST'?{ok:true}:{d:{'speakingroom:answer_vocab':JSON.stringify(remote)}}):undefined});
 const other=h.run(`learningProfileCreate('동기화에서 제외할 학습자')`);h.run(`learningProfileSwitch(${JSON.stringify(other)});hSet('speakingroom:answer_vocab',{phone:{en:'phone',ko:'다른 학습자만의 단어',practiceCorrect:9,lastT:500}});learningProfileSwitch('legacy')`);
 await h.run(`supportSync('synthetic-word-sync')`);let words=JSON.parse(h.run(`JSON.stringify(hGet('speakingroom:answer_vocab',{}))`));assert.equal(words.water.ko,'현재 뜻');assert.equal(words.water.lastT,200);assert.equal(words.water.misses,5);assert.equal(words.water.practiceCorrect,3);assert.ok(words.ticket);assert.ok(words.coffee);assert.equal(words.phone,undefined);
 remote={water:{en:'water',ko:'최신 뜻',misses:1,practiceCorrect:4,lastT:300}};await h.run(`supportSync('synthetic-word-sync')`);const merged=h.run(`JSON.stringify(hGet('speakingroom:answer_vocab',{}))`);await h.run(`supportSync('synthetic-word-sync')`);assert.equal(h.run(`JSON.stringify(hGet('speakingroom:answer_vocab',{}))`),merged,'repeating the same remote snapshot does not multiply counts');
 words=JSON.parse(merged);assert.equal(words.water.ko,'최신 뜻');assert.equal(words.water.misses,5);assert.equal(words.water.practiceCorrect,4);assert.ok(words.ticket);assert.ok(words.coffee);
 const uploads=h.requests.filter(request=>request.path==='/u'&&request.options.method==='POST');assert.equal(uploads.length,3);for(const upload of uploads){const payload=JSON.parse(upload.options.body),vocab=JSON.parse(payload.d['speakingroom:answer_vocab']);assert.ok(vocab.water);assert.equal(vocab.phone,undefined);assert.equal(payload.d['speakingroom:practice_recordings'],undefined);assert.equal(payload.d['speakingroom:last_voice'],undefined);assert.doesNotMatch(upload.options.body,/PRIVATE_|audioBase64|다른 학습자만의 단어/);}
 const restored=setup({seed:Object.fromEntries(h.records)});assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),4);restored.run(`learningProfileSwitch(${JSON.stringify(other)})`);assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).phone.practiceCorrect`),9);assert.equal(restored.run(`hGet('speakingroom:answer_vocab',{}).water`),undefined);
});

test('a word sync response arriving after a learner switch cannot import into either learner or upload',async()=>{
 const response=deferred(),h=setup({seed:{'speakingroom:answer_vocab':JSON.stringify({water:{en:'water',misses:2,practiceCorrect:1,lastT:200}})},route:request=>request.path==='/u'?response.promise:undefined});const pending=h.run(`supportSync('synthetic-late-word-sync')`);await h.flush();h.run(`learningProfileSwitch(learningProfileCreate('빈 단어장 학습자'))`);response.resolve(json({d:{'speakingroom:answer_vocab':JSON.stringify({water:{en:'water',misses:9,practiceCorrect:8,lastT:300}})}}));await assert.rejects(pending,/학습자가 변경/);
 assert.equal(h.run(`Object.keys(hGet('speakingroom:answer_vocab',{})).length`),0);assert.equal(h.requests.filter(request=>request.options.method==='POST').length,0);h.run(`learningProfileSwitch('legacy')`);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.misses`),2);assert.equal(h.run(`hGet('speakingroom:answer_vocab',{}).water.practiceCorrect`),1);
});
