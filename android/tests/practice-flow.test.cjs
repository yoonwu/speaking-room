const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const enabled={ok:true,enabled:true,creditsVerified:true};
const wav=(()=>{const b=Buffer.alloc(684);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(Math.round(Math.sin(i/11)*900),i);return b;})();

// All app scripts execute unchanged. Only browser/Android I/O is simulated.
function setup({seed={},route,status=enabled,realtime=false,immediate=false,prepare}={}){
 const records=new Map(Object.entries(seed)),elements=new Map(),requests=[],native=[],captures=[],timers=new Map();
 let now=Date.UTC(2026,10,7),sequence=0,random=71;
 const math=Object.create(Math);math.random=()=>{random=(random*1664525+1013904223)>>>0;return random/4294967296;};
 const element=()=>({style:{},dataset:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,isConnected:true,addEventListener(){},setAttribute(){},focus(){},remove(){this.isConnected=false;},insertBefore(){},appendChild(){},showModal(){},querySelector:selector=>get(selector),querySelectorAll:()=>[],getTracks:()=>[]});
 const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const clockDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const context={window:{addEventListener(){},srNativePracticeSpeech:true,srNativePracticePlayback:true,srNativePracticeStreaming:true,srNativePracticeMicReady:true,srNativePracticeRealtime:realtime,srNativePracticeBackgroundPreparation:realtime,srNativePracticeImmediateCapture:immediate},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},navigator:{},localStorage:{getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,String(value))},setTimeout:(fn,ms=0)=>{const id=++sequence;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),location:{reload(){}},console,Date:clockDate,Math:math,URL,Blob,AbortController,Response,atob:s=>Buffer.from(s,'base64').toString('binary')};
 context.fetch=async(url,options={})=>{const request={url:String(url),path:new URL(url,'https://app.test').pathname,options};requests.push(request);if(route){const response=await route(request);if(response!==undefined)return response;}if(request.path==='/practice-ai/status')return json(status);if(request.path==='/practice-realtime/status')return json({available:realtime});return json({ok:false},404);};
 context.window.srNativeRequest=(action,data,onCaptured,onReady)=>{
  native.push({action,data});
  if(action==='preparePracticeFast')return typeof prepare==='function'?Promise.resolve().then(()=>prepare(data)):Promise.resolve(prepare??{prepared:true,permissionGranted:true});
  if(['streamPractice','streamPracticeFast','recordPractice'].includes(action)){
   const pending=deferred(),capture={action,data,onCaptured,onReady,...pending,ready(){onReady?.();},end(){onCaptured?.();},complete(text='Can I get some water?',extra={}){onCaptured?.();pending.resolve({text,audioBase64:wav.toString('base64'),...extra});}};captures.push(capture);return pending.promise;
  }
  if(action==='status')return Promise.resolve({practiceSpeech:true,practicePlayback:true,practiceStreaming:true,practiceMicReady:true,practiceRealtime:realtime,practiceImmediateCapture:immediate});
  return Promise.resolve({});
 };
 vm.createContext(context);for(const file of ['practice-data.js','practice-ai.js','practice-session.js','practice.js','home-support.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 const run=source=>vm.runInContext(source,context);
 const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
 const advance=async ms=>{const end=now+ms;await flush();for(;;){let next;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();};
 const start=(en='Can I get some water?',frameId='travel_can_i_get')=>run(`startDrill([{frame:TRAVEL_BY_ID[${JSON.stringify(frameId)}],ex:{en:${JSON.stringify(en)},ko:'상황을 보고 영어로 말하세요.'},_intro:false}],'기본표현')`);
 const type=text=>{get('#autoType').onclick();const input=get('#autoInput');input.value=text;input.oninput();return input.onkeydown({key:'Enter',target:input,preventDefault(){}});};
 return {run,context,records,requests,native,captures,elements,get,flush,advance,start,type,get now(){return now;},posts:()=>requests.filter(r=>r.options.method==='POST')};
}

function observeProductionCues(h){
 const oscillators=[],param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
 h.context.window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={};}resume(){return Promise.resolve();}createGain(){return {gain:param(),connect(){},disconnect(){}};}createOscillator(){const oscillator={frequency:param(),connect(){},disconnect(){},start(){oscillator.started=true;},stop(){}};oscillators.push(oscillator);return oscillator;}};
 return oscillators;
}

test('retry starts one capture immediately and listening appears only after the native ready event',async()=>{
 const h=setup();h.start();h.type('This is a towel.');await h.flush();assert.equal(h.run('autoDrill.results[0].ok'),false);
 const retry=h.get('#autoRetry').onclick,at=h.now,pending=retry();
 assert.equal(h.captures.length,1);assert.equal(h.now,at,'there is no countdown before retry capture');assert.equal(h.run('autoDrill.items[0].recall'),true);assert.notEqual(h.get('#autoMic').textContent,'■ 듣는 중');assert.equal(h.run('qzRecording'),false);assert.equal(h.run('micPreparing'),true);assert.equal(typeof h.captures[0].onReady,'function');
 await retry();assert.equal(h.captures.length,1,'a duplicate old button handler cannot open another microphone');
 await h.advance(349);assert.notEqual(h.get('#autoMic').textContent,'마이크 연결 중…','short preparation does not flash a loading label');await h.advance(1);assert.equal(h.get('#autoMic').textContent,'마이크 연결 중…');
 h.captures[0].ready();assert.equal(h.get('#autoMic').textContent,'■ 듣는 중');assert.equal(h.run('qzRecording'),true);assert.equal(h.run('micPreparing'),false);
 h.captures[0].end();assert.equal(h.get('#autoMic').textContent,'말소리 인식 중…');assert.equal(h.run('qzRecording'),false);
 h.captures[0].complete();await pending;await h.flush();assert.equal(h.run('autoDrill.results.length'),2);assert.equal(h.run('autoDrill.results[1].ok'),true);assert.equal(h.run('practiceReward().total'),5);
});

test('SDK preparation does not consume the speaking window or the post-capture result deadline',async()=>{
 const h=setup({realtime:true});h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();const capture=h.captures[0];assert.equal(capture.action,'streamPracticeFast');await h.advance(4000);assert.equal(h.get('#autoMic').textContent,'마이크 연결 중…');capture.ready();await h.advance(7999);assert.equal(h.native.filter(r=>r.action==='recognizeStop').length,0,'the full eight-second speaking window begins at microphone readiness');await h.advance(1);assert.equal(h.native.filter(r=>r.action==='recognizeStop').length,1);capture.end();await h.advance(4500);assert.equal(h.run('autoDrill.results.length'),0);assert.equal(h.get('#autoMic').textContent,'말소리 인식 중…','the allowed provider tail must remain active after bounded SDK preparation');capture.complete();await pending;await h.flush();assert.equal(h.run('autoDrill.results[0].ok'),true);assert.equal(h.run('practiceReward().total'),30);
});

test('a hung native result releases the practice screen six seconds after capture ends and ignores a late final',async()=>{
 const h=setup({realtime:true});h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();const capture=h.captures[0];capture.ready();await h.advance(1200);capture.end();
 assert.equal(h.context.window.srLastSpeechTiming.phase,'recognition');const cancellations=h.native.filter(r=>r.action==='recognizeCancel').length;
 await h.advance(5999);assert.equal(h.get('#autoMic').textContent,'말소리 인식 중…');
 await h.advance(1);await pending;assert.equal(h.native.filter(r=>r.action==='recognizeCancel').length,cancellations+1);
 assert.equal(h.context.window.srLastSpeechTiming.phase,'error');assert.equal(h.context.window.srLastSpeechTiming.recognitionMs,6000);assert.equal(h.run('qzRecording||micPreparing'),false);assert.equal(h.posts().length,0);
 capture.complete();await h.flush();assert.equal(h.run('supportEvents().length'),0);
});

test('real start-cue synthesis waits for SDK preparation, finishes before capture, and does not reopen on duplicate taps',async()=>{
 const prepared=deferred(),h=setup({realtime:true,prepare:()=>prepared.promise}),cues=observeProductionCues(h);h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();assert.equal(h.native.filter(r=>r.action==='preparePracticeFast'&&r.data.background!==true).length,1);assert.equal(h.captures.length,0);assert.equal(cues.length,0,'no speak-now cue is generated while the SDK is not ready');await h.get('#autoMic').onclick();assert.equal(h.native.filter(r=>r.action==='preparePracticeFast'&&r.data.background!==true).length,1);await h.advance(4000);assert.equal(cues.length,0);prepared.resolve({prepared:true,permissionGranted:true});await h.flush();assert.equal(cues.length,1);assert.equal(cues[0].started,true);assert.equal(h.captures.length,0);await h.advance(199);assert.equal(h.captures.length,0);await h.advance(1);assert.equal(h.captures.length,1);assert.equal(h.captures[0].action,'streamPracticeFast');h.captures[0].ready();h.captures[0].complete();await pending;assert.equal(h.run('autoDrill.results[0].ok'),true);
});

test('cancelling SDK preparation cannot sound a late start cue or open the microphone',async()=>{
 const prepared=deferred(),h=setup({realtime:true,prepare:()=>prepared.promise}),cues=observeProductionCues(h);h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();h.run('goToSetup()');prepared.resolve({prepared:true,permissionGranted:true});await pending;await h.advance(1000);assert.equal(cues.length,0);assert.equal(h.captures.length,0);assert.equal(h.posts().length,0);assert.equal(h.run('supportEvents().length'),0);
});

test('permission denied during SDK preparation ends once without another permission or capture request',async()=>{
 const h=setup({realtime:true,prepare:{prepared:false,permissionGranted:false,error:'마이크 사용을 허용해주세요.'}}),cues=observeProductionCues(h);h.start();await h.flush();await h.get('#autoMic').onclick();await h.flush();assert.equal(h.native.filter(r=>r.action==='preparePracticeFast'&&r.data.background!==true).length,1);assert.equal(h.captures.length,0);assert.equal(cues.length,0);assert.equal(h.posts().length,0);assert.equal(h.run('micPreparing||qzRecording'),false);assert.match(h.get('#autoStat').textContent,/마이크 사용을 허용/);
});

test('hung permission or SDK preparation times out at thirty seconds and cannot start from a late prepared reply',async()=>{
 const prepared=deferred(),h=setup({realtime:true,prepare:()=>prepared.promise}),cues=observeProductionCues(h);h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();const cancels=h.native.filter(r=>r.action==='recognizeCancel').length;await h.advance(29999);assert.equal(h.run('micPreparing'),true);assert.equal(cues.length,0);assert.equal(h.captures.length,0);await h.advance(1);await pending;assert.equal(h.native.filter(r=>r.action==='recognizeCancel').length,cancels+1);assert.equal(h.run('micPreparing||qzRecording'),false);assert.equal(cues.length,0);assert.equal(h.captures.length,0);assert.equal(h.posts().length,0);assert.match(h.get('#autoStat').textContent,/마이크 사용 준비가 늦어요/);prepared.resolve({prepared:true,permissionGranted:true});await h.advance(1000);assert.equal(cues.length,0);assert.equal(h.captures.length,0);assert.equal(h.run('supportEvents().length'),0);
});

test('a network preparation failure falls back to the established stream before one cue and one microphone',async()=>{
 for(const prepare of [{prepared:false,permissionGranted:true},()=>{throw Error('SDK network unavailable');}]){
  const h=setup({realtime:true,prepare}),cues=observeProductionCues(h);h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();assert.equal(h.native.filter(r=>r.action==='preparePracticeFast'&&r.data.background!==true).length,1);assert.equal(cues.length,1);assert.equal(h.captures.length,0);await h.advance(200);assert.equal(h.captures.length,1);assert.equal(h.captures[0].action,'streamPractice');h.captures[0].ready();h.captures[0].complete();await pending;assert.equal(h.posts().length,0);assert.equal(h.run('autoDrill.results[0].ok'),true);assert.equal(h.run('PracticeAI.realtimeReady()'),false);
 }
});

test('first wrong then immediate and explicitly copied retries share one five-XP allowance while mastery still grows',async()=>{
 const h=setup();h.run(`startDrill(Array.from({length:2},()=>({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get some water?',ko:'물 한 잔을 부탁해보세요.'},_intro:false})),'기본표현');autoDrill.items[1]._attemptGroupId=autoDrill.items[0]._attemptGroupId;`);const group=h.run('autoDrill.items[0]._attemptGroupId');h.type('This is a towel.');assert.equal(h.run('practiceReward().total'),0);
 const pending=h.get('#autoRetry').onclick(),capture=h.captures.at(-1);capture.ready();capture.complete();await pending;await h.flush();
 assert.equal(h.run('practiceReward().total'),5);assert.equal(h.run('autoDrill.results.length'),2);assert.equal(h.run(`learningSentenceMastery('Can I get some water?').score`),4);assert.doesNotMatch(h.get('.auto-actions').innerHTML,/id="autoRetry"/,'a correct covered recall offers only the next main action');
 const before=h.run('supportEvents().length');h.run(`autoDrillFinish('Can I get some water?',{attemptId:'duplicate-delivery'})`);assert.equal(h.run('supportEvents().length'),before,'a duplicate final cannot award twice');
 assert.equal(h.run('autoDrill.items.length'),2,'wrong and retry answers do not insert another copy');h.get('#autoNext').onclick();assert.equal(h.run('autoDrill.items[autoDrill.idx]._attemptGroupId'),group);h.type('Can I get some water?');
 assert.equal(h.run('practiceReward().total'),5);assert.equal(h.run('autoDrill.results.length'),3);assert.equal(h.run(`learningSentenceMastery('Can I get some water?').score`),8);assert.deepEqual([...h.run('autoDrill.results.map(x=>x.xp)')],[0,5,0]);
});

test('twenty-eight planned questions keep their denominator after wrong answers and repeated same-question retries',async()=>{
 const h=setup();h.run(`startDrill(Array.from({length:28},()=>({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get some water?',ko:'물 한 잔을 부탁해보세요.'},_intro:false})),'기본표현');`);
 const groups=[...h.run('autoDrill.items.map(it=>it._attemptGroupId)')];assert.equal(new Set(groups).size,28);assert.equal(h.run('autoDrill.plannedCount'),28);
 for(let index=0;index<28;index++){
  assert.equal(h.run('autoDrill.idx'),index);assert.equal(h.run('autoDrill.items.length'),28);assert.equal(h.run('autoDrill.plannedCount'),28);assert.match(h.get('#sprintScroll').innerHTML,new RegExp('>'+String(index+1)+' / 28</span>'));
  h.type('This is a towel.');assert.equal(h.run('autoDrill.items.length'),28,'an incorrect answer never grows the session');
  if(index===14){
   for(const text of ['This is a towel.','Can I get a towel?','Can I get some water?']){
    const pending=h.get('#autoRetry').onclick();await h.flush();const capture=h.captures.at(-1);capture.ready();capture.complete(text,{speechStartOffsetMs:100,captureDurationMs:1000});await pending;await h.flush();assert.equal(h.run('autoDrill.idx'),14);assert.equal(h.run('autoDrill.items.length'),28);assert.equal(h.run('autoDrill.plannedCount'),28);assert.match(h.get('#sprintScroll').innerHTML,/>15 \/ 28<\/span>/);
   }
   assert.doesNotMatch(h.get('.auto-actions').innerHTML,/id="autoRetry"/,'a full correct retry leaves Next as the only main action');assert.equal(h.run('supportEvents().filter(e=>e.fid).reduce((sum,e)=>sum+e.xp,0)'),5,'the one retry bonus is separate from the daily ten-attempt goal bonus');
  }
  assert.deepEqual([...h.run('autoDrill.items.map(it=>it._attemptGroupId)')],groups,'only the initially planned questions remain');h.get('#autoNext').onclick();
 }
 assert.equal(h.run('autoDrill'),null,'Next completes the session immediately after the twenty-eighth question');assert.equal(h.run('supportEvents().filter(e=>e.fid).length'),31,'all three extra attempts belong to the original fifteenth question');assert.match(h.get('#sprintScroll').innerHTML,/연습 완료/);assert.match(h.get('#sprintScroll').innerHTML,/28<small> \/ 28<\/small>/);
});

test('leaving or switching learners discards a late native result before decoding, scoring or displaying it',async()=>{
 for(const switchProfile of [false,true]){
  const h=setup();h.start();const pending=h.get('#autoMic').onclick();h.captures[0].ready();const next=h.run(`learningProfileCreate('다른 학습자')`);
  if(switchProfile)h.run(`learningProfileSwitch(${JSON.stringify(next)})`);else h.run('goToSetup()');
  h.context.atob=()=>{throw Error('cancelled audio must not be decoded');};h.captures[0].complete();await pending;await h.flush();
  assert.equal(h.run('autoDrill'),null);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run(`learningSentenceMastery('Can I get some water?').seen`),0);
  if(switchProfile){h.run(`learningProfileSwitch('legacy')`);assert.equal(h.run('practiceReward().total'),0);}
 }
});

test('pronunciation mode defaults to accuracy and persists independently per learner across reload',()=>{
 const h=setup();assert.equal(h.run('PracticeAI.getMode()'),'accuracy');h.run(`PracticeAI.setMode('meaning');const another=learningProfileCreate('두 번째');learningProfileSwitch(another)`);assert.equal(h.run('PracticeAI.getMode()'),'accuracy');h.run(`PracticeAI.setMode('meaning')`);
 const restored=setup({seed:Object.fromEntries(h.records)});assert.equal(restored.run('PracticeAI.getMode()'),'meaning');restored.run(`PracticeAI.setMode('accuracy');learningProfileSwitch('legacy')`);assert.equal(restored.run('PracticeAI.getMode()'),'meaning');restored.run('learningProfileSwitch(another=learningProfileList().find(x=>x.id!=="legacy").id)');assert.equal(restored.run('PracticeAI.getMode()'),'accuracy');
});

test('meaning-mode native capture posts the original WAV without target hints and accepts a clear paraphrase locally',async()=>{
 const h=setup({realtime:true,route:r=>r.path==='/practice-ai/transcribe'?json({ok:true,transcript:"I'd like some water.",usage:{model:'gpt-4o-mini-transcribe',estimatedUsd:.00001,calls:1}}):undefined});
 h.run(`PracticeAI.setMode('meaning')`);h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();assert.equal(h.captures.length,1);assert.equal(h.captures[0].action,'recordPractice','meaning mode must not send the same audio through Azure streaming');assert.deepEqual(Object.keys(h.captures[0].data),['expectedWords']);assert.equal(typeof h.captures[0].data.expectedWords,'number');
 h.captures[0].ready();h.captures[0].complete();await pending;await h.flush();const posts=h.posts();assert.equal(posts.length,1);assert.equal(posts[0].path,'/practice-ai/transcribe');assert.equal(new URL(posts[0].url).search,'');assert.equal(posts[0].options.headers['Content-Type'],'audio/wav');assert.ok(posts[0].options.body instanceof Blob);assert.deepEqual(Buffer.from(await posts[0].options.body.arrayBuffer()),wav);assert.ok(!JSON.stringify(posts[0].options.headers).includes('water'));assert.equal(h.run('autoDrill.results[0].ok'),true);assert.equal(h.run('practiceReward().total'),30);assert.equal(h.run('PracticeAI.usage().transcribe'),1);assert.equal(h.run('PracticeAI.usage().judge'),0);
});

test('a realtime stream failure reuses the one original recording for bounded Azure-only fallback then avoids the failed fast path',async()=>{
 const fallback=deferred(),h=setup({realtime:true,route:r=>r.path==='/stt'?fallback.promise:undefined});h.start();await h.flush();assert.equal(h.run('PracticeAI.realtimeReady()'),true);const pending=h.get('#autoMic').onclick();await h.flush();assert.equal(h.captures[0].action,'streamPracticeFast');h.captures[0].ready();h.captures[0].complete('',{streamError:'실시간 연결에 실패했어요.'});await h.flush();
 assert.equal(h.captures.length,1,'fallback must reuse PCM instead of reopening the microphone');assert.equal(h.posts().length,1);const request=h.posts()[0];assert.equal(request.path,'/stt');assert.equal(request.options.headers['Content-Type'],'audio/wav');assert.deepEqual(Buffer.from(await request.options.body.arrayBuffer()),wav);assert.equal(h.run('PracticeAI.realtimeReady()'),false);
 await h.advance(2100);assert.equal(h.posts().length,1,'the normal two-second OpenAI hedge must be disabled for this fallback');fallback.resolve(json({DisplayText:'Can I get some water?'}));await pending;await h.flush();assert.equal(h.run('autoDrill.results[0].ok'),true);assert.equal(h.run('practiceReward().total'),30);assert.equal(h.captures.length,1);
 h.start();await h.flush();const second=h.get('#autoMic').onclick();assert.equal(h.captures[1].action,'streamPractice','subsequent capture during cooldown uses the previous streaming route');h.captures[1].ready();h.captures[1].complete();await second;await h.flush();assert.equal(h.posts().length,1);assert.equal(h.run('autoDrill.results[0].ok'),true);
 await h.advance(12000);h.start();await h.flush();const recovered=h.get('#autoMic').onclick();await h.flush();
 assert.equal(h.captures[2].action,'streamPracticeFast','one error cannot keep subsequent sessions on the slower route for minutes');h.captures[2].ready();h.captures[2].complete();await recovered;
});

test('unavailable realtime status keeps the established native stream with no second capture or transcription request',async()=>{
 const h=setup({realtime:true,route:r=>{if(r.path==='/practice-realtime/status')throw Error('status network failure');}});h.start();await h.flush();assert.equal(h.run('PracticeAI.realtimeReady()'),false);const pending=h.get('#autoMic').onclick();assert.equal(h.captures.length,1);assert.equal(h.captures[0].action,'streamPractice');h.captures[0].ready();h.captures[0].complete();await pending;await h.flush();assert.equal(h.posts().length,0);assert.equal(h.captures.length,1);assert.equal(h.run('autoDrill.results[0].ok'),true);
});

const backgroundCalls=h=>h.native.filter(call=>call.action==='preparePracticeFast'&&call.data.background===true);
const cancelCalls=h=>h.native.filter(call=>call.action==='recognizeCancel').length;
const nativeReady={prepared:true,permissionGranted:true,immediateCaptureReady:true};
function startPrewarmLesson(h,{sameFrame=false}={}){
 const items=[['travel_can_i_get','Can I get some water?'],...(sameFrame?[['travel_can_i_get','Can I get another towel?']]:[]),['travel_where_is','Where is the gate?']];
 h.run(`startDrill(${JSON.stringify(items)}.map(([id,en])=>({frame:TRAVEL_BY_ID[id],ex:{en,ko:'상황을 보고 영어로 말하세요.'},_intro:false})),'기본표현')`);
}
async function finishPrewarmAnswer(h,heard){
 const pending=h.get('#autoMic').onclick();await h.flush();const capture=h.captures.at(-1);assert.equal(capture.action,'streamPracticeFast');capture.ready();capture.complete(heard);await pending;await h.flush();
}

test('immediate native prewarm starts before unknown backend status resolves but respects known unavailability',async()=>{
 const status=deferred(),h=setup({realtime:true,immediate:true,route:request=>request.path==='/practice-realtime/status'?status.promise:undefined});h.start();await h.flush();
 const probe=h.requests.find(request=>request.path==='/practice-realtime/status'),preload=backgroundCalls(h)[0];assert.ok(probe);assert.equal(probe.options.signal.aborted,false);assert.equal(h.run('PracticeAI.realtimeReady()'),false);assert.ok(preload,'native warm-up does not wait for status');assert.deepEqual(plain(preload.data),{background:true,expectedWords:5});assert.equal(h.captures.length,0);
 status.resolve(json({available:true}));await h.flush();assert.equal(h.run('PracticeAI.realtimeReady()'),true);
 const off=setup({realtime:true,immediate:true,route:request=>request.path==='/practice-realtime/status'?json({available:false}):undefined});await off.run('PracticeAI.prepareRealtime()');off.start();await off.flush();assert.equal(backgroundCalls(off).length,0);
 const pending=off.get('#autoMic').onclick();await off.flush();assert.equal(off.captures[0].action,'streamPractice');assert.equal(off.native.some(call=>call.action==='preparePracticeFast'&&call.data.immediate),false);off.captures[0].ready();off.captures[0].complete();await pending;
});

test('a normal result prewarms the actual next question after a same-frame swap and Next retains that preparation',async()=>{
 const warm=deferred(),h=setup({realtime:true,immediate:true,prepare:data=>data.background&&data.expectedWords===4?warm.promise:nativeReady});startPrewarmLesson(h,{sameFrame:true});await h.flush();
 await finishPrewarmAnswer(h,'Can I get some water?');assert.equal(h.run('autoDrill.idx'),0);assert.doesNotMatch(h.get('.auto-actions').innerHTML,/id="autoRetry"/);assert.equal(backgroundCalls(h).at(-1)?.data.expectedWords,4,'the result warms the next distinct frame before Next is pressed');
 warm.resolve(nativeReady);await h.flush();const before=cancelCalls(h);h.get('#autoNext').onclick();await h.flush();assert.equal(h.run('autoDrill.items[autoDrill.idx].ex.en'),'Where is the gate?');assert.equal(cancelCalls(h),before,'Next preserves the already-prepared matching item');
 const pending=h.get('#autoMic').onclick();await h.flush();assert.equal(h.captures.length,2);assert.equal(h.captures[1].action,'streamPracticeFast');assert.equal(h.captures[1].data.expectedWords,4);assert.equal(cancelCalls(h),before);assert.ok(h.native.some(call=>call.action==='preparePracticeFast'&&call.data.immediate===true&&call.data.expectedWords===4));h.captures[1].ready();h.captures[1].complete('Where is the gate?');await pending;
});

test('a result with covered recall prioritizes the same question and starts it without cancelling its preparation',async()=>{
 const warm=deferred();let answerPhase=false;const h=setup({realtime:true,immediate:true,prepare:data=>data.background&&answerPhase?warm.promise:nativeReady});startPrewarmLesson(h);await h.flush();const initial=backgroundCalls(h).length;answerPhase=true;
 await finishPrewarmAnswer(h,'This is a towel.');assert.match(h.get('.auto-actions').innerHTML,/id="autoRetry"/);const resultWarm=backgroundCalls(h).slice(initial);assert.ok(resultWarm.length);assert.ok(resultWarm.every(call=>call.data.expectedWords===5),'retry remains the primary prepared action');
 warm.resolve(nativeReady);await h.flush();const before=cancelCalls(h);const retry=h.get('#autoRetry').onclick();await h.flush();assert.equal(h.run('autoDrill.idx'),0);assert.equal(h.run('autoDrill.items[0].recall'),true);assert.equal(cancelCalls(h),before);assert.equal(h.captures.length,2);assert.equal(h.captures[1].action,'streamPracticeFast');assert.equal(h.captures[1].data.expectedWords,5);h.captures[1].ready();h.captures[1].complete();await retry;
});

test('skipping a pending recall preparation cancels it and a late reply cannot replace the next question’s warm-up',async()=>{
 const old=deferred();let answerPhase=false;const h=setup({realtime:true,immediate:true,prepare:data=>data.background&&data.expectedWords===5&&answerPhase?old.promise:nativeReady});startPrewarmLesson(h);await h.flush();answerPhase=true;await finishPrewarmAnswer(h,'This is a towel.');assert.equal(backgroundCalls(h).at(-1)?.data.expectedWords,5);
 const before=cancelCalls(h);h.get('#autoNext').onclick();await h.flush();assert.equal(h.run('autoDrill.items[autoDrill.idx].ex.en'),'Where is the gate?');assert.ok(cancelCalls(h)>before,'Next cancels a preparation reserved for recall');assert.equal(backgroundCalls(h).at(-1)?.data.expectedWords,4);
 const requests=h.native.length;old.resolve(nativeReady);await h.flush();assert.equal(h.native.length,requests,'abandoned completion cannot restart or cancel another preparation');assert.equal(h.captures.length,1);assert.equal(h.run('autoDrill.idx'),1);
});

test('leaving or switching learners discards a late status and preparation without rewarming the abandoned question',async()=>{
 for(const leave of ["goToSetup()","learningProfileSwitch(learningProfileCreate('다른 학습자'))"]){
  const status=deferred(),old=deferred();let waitOld=true;const h=setup({realtime:true,immediate:true,prepare:data=>data.background&&waitOld?old.promise:nativeReady,route:request=>request.path==='/practice-realtime/status'?status.promise:undefined});h.start();await h.flush();assert.equal(backgroundCalls(h).length,1);const before=cancelCalls(h);h.run(leave);assert.ok(cancelCalls(h)>before);
  const requests=h.native.length;status.resolve(json({available:true}));old.resolve(nativeReady);await h.flush();assert.equal(h.native.length,requests);assert.equal(h.run('autoDrill'),null);assert.equal(h.captures.length,0);
  waitOld=false;h.start();await h.flush();assert.equal(backgroundCalls(h).length,2,'a new lesson still requests its own preparation even for the same word count');
 }
});

test('an abandoned foreground permission timeout cannot cancel a newer learner’s active capture',async()=>{
 const old=deferred();let holdOld=true;const h=setup({realtime:true,immediate:true,prepare:data=>!data.background&&holdOld?old.promise:nativeReady});h.start();await h.flush();const abandoned=h.get('#autoMic').onclick();await h.flush();
 await h.advance(29900);assert.equal(h.captures.length,0);assert.equal(h.run('micPreparing'),true);h.run("learningProfileSwitch(learningProfileCreate('다른 학습자'))");holdOld=false;h.start();await h.flush();const current=h.get('#autoMic').onclick();await h.flush();assert.equal(h.captures.length,1);h.captures[0].ready();assert.equal(h.run('qzRecording'),true);
 const before=cancelCalls(h);await h.advance(100);await abandoned;assert.equal(cancelCalls(h),before,'the old 30-second timer must not send a native cancel for the current capture');assert.equal(h.run('qzRecording'),true);assert.equal(h.run('supportEvents().length'),0);
 old.resolve(nativeReady);await h.flush();assert.equal(h.captures.length,1);h.captures[0].complete();await current;assert.equal(h.run('autoDrill.results[0].ok'),true);
});

test('a late SDK error and hung REST fallback share six seconds from capture end with no extra capture or paid backup',async()=>{
 const delayed=deferred(),h=setup({realtime:true,route:r=>r.path==='/stt'?delayed.promise:undefined});h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();const capture=h.captures[0];capture.ready();capture.end();await h.advance(2600);
 capture.complete('',{streamError:'실시간 연결 실패'});await h.flush();const fallback=h.posts()[0];assert.equal(fallback.path,'/stt');await h.advance(3399);assert.equal(h.posts().length,1);assert.equal(fallback.options.signal.aborted,false);await h.advance(1);await pending;
 assert.equal(fallback.options.signal.aborted,true);assert.equal(h.context.window.srLastSpeechTiming.recognitionMs,6000);assert.equal(h.posts().length,1);assert.equal(h.captures.length,1);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.run('qzRecording||micPreparing'),false);assert.match(h.get('#autoStat').textContent,/음성 인식 응답이 늦어요/);delayed.resolve(json({DisplayText:'Can I get some water?'}));await h.flush();assert.equal(h.run('supportEvents().length'),0);
});

test('a successful realtime NoMatch remains unscorable without triggering Azure fallback or another microphone',async()=>{
 const h=setup({realtime:true});h.start();await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();assert.equal(h.captures[0].action,'streamPracticeFast');h.captures[0].ready();h.captures[0].complete('');await pending;await h.flush();assert.equal(h.posts().length,0);assert.equal(h.captures.length,1);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);
});

test('the observed segmented repetition passes unchanged while a changed object or negation still fails',async()=>{
 for(const [heard,ok,xp]of [["I can't find my. My phone.",true,30],["I can't find my. My ticket.",false,20],["I can find my. My phone.",false,0]]){
  const h=setup({realtime:true});h.start("I can't find my phone.",'travel_cant_find');await h.flush();const pending=h.get('#autoMic').onclick();await h.flush();h.captures[0].ready();h.captures[0].complete(heard);await pending;await h.flush();assert.equal(h.run('autoDrill.results[0].ok'),ok,heard);assert.equal(h.run('autoDrill.results[0].heard'),heard);assert.equal(h.run('practiceReward().total'),xp);assert.equal(h.posts().length,0);
 }
});

test('typed meaning-mode polarity, object and quantity errors are rejected locally while silence is unscorable',async()=>{
 for(const [expected,heard,retry,xp]of [['Can I get some water?',"I don't want any water.",false,0],['Can I get some water?','Can I get coffee?',false,20],['Can I get two tickets?','Can I get three tickets?',false,20],['Can I get some water?','',true,0],['Can I get some water?','워터 주세요',true,0]]){
  const h=setup();h.run(`PracticeAI.setMode('meaning')`);h.start(expected);if(heard)h.type(heard);else h.run(`autoDrillFinish('',{typed:true})`);await h.flush();assert.equal(h.posts().length,0,heard);assert.equal(h.captures.length,0);assert.equal(h.run('practiceReward().total'),xp,heard);assert.equal(h.run('autoDrill.results.length'),retry?0:1,heard);if(!retry)assert.equal(h.run('autoDrill.results[0].ok'),false,heard);assert.equal(h.run(`learningSentenceMastery(${JSON.stringify(expected)}).seen`),retry?0:1,heard);
 }
});

test('raw Korean transcription becomes NoMatch without target replacement, judge calls or scoring',async()=>{
 const h=setup({route:r=>r.path==='/practice-ai/transcribe'?json({ok:true,transcript:'캔 아이 겟 섬 워터'}):undefined});h.run(`PracticeAI.setMode('meaning');practiceTranscriptText=()=>{throw Error('semantic evidence must never be target-replaced')}`);h.start();const pending=h.get('#autoMic').onclick();await h.flush();h.captures[0].ready();h.captures[0].complete();await pending;await h.flush();assert.equal(h.posts().length,1);assert.equal(h.posts()[0].path,'/practice-ai/transcribe');assert.equal(h.run('autoDrill.results.length'),0);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);assert.match(h.get('#autoStat').textContent,/잘 들리지/);
});

test('only an ambiguous meaning goes to the judge with the explicit two-sentence contract',async()=>{
 const h=setup({route:r=>r.path==='/practice-ai/judge'?json({ok:true,pass:true,retry:false,reason:'equivalent',usage:{model:'gpt-4.1-nano',calls:1,estimatedUsd:.00001}}):undefined});h.run(`PracticeAI.setMode('meaning')`);h.start();assert.equal(h.run(`PracticeAI.localDecision(autoDrill.items[0],'Water would be nice.').decided`),false);h.type('Water would be nice.');await h.flush();assert.equal(h.posts().length,1);const request=h.posts()[0],body=JSON.parse(request.options.body);assert.equal(request.path,'/practice-ai/judge');assert.deepEqual(Object.keys(body).sort(),['expected','requestId','transcript']);assert.equal(body.expected,'Can I get some water?');assert.equal(body.transcript,'Water would be nice.');assert.ok(body.requestId);assert.equal(h.run('autoDrill.results[0].ok'),true);assert.equal(h.run('practiceReward().total'),30);
});

test('a hung semantic judge ends at seven seconds with no score and cannot award from its late response',async()=>{
 const delayed=deferred(),h=setup({route:r=>r.path==='/practice-ai/judge'?delayed.promise:undefined});h.run(`PracticeAI.setMode('meaning')`);h.start();h.type('Water would be nice.');await h.flush();assert.equal(h.run('pendingReply'),true);const request=h.posts()[0];assert.equal(request.path,'/practice-ai/judge');await h.advance(6999);assert.equal(h.run('pendingReply'),true);await h.advance(1);assert.equal(h.run('pendingReply'),false);assert.equal(request.options.signal.aborted,true);assert.equal(h.run('supportEvents().length'),0);assert.match(h.get('#autoStat').textContent,/점수와 숙련도는 바뀌지/);delayed.resolve(json({pass:true,retry:false}));await h.flush();assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);
});

test('the credit gate rejects semantic capture before opening the microphone or making a paid request',async()=>{
 const h=setup({status:{ok:true,enabled:false,creditsVerified:false,reason:'credits_unverified'}});h.run(`PracticeAI.setMode('meaning')`);h.start();await h.get('#autoMic').onclick();await h.flush();assert.equal(h.captures.length,0);assert.equal(h.posts().length,0);assert.equal(h.run('micPreparing||qzRecording'),false);assert.match(h.get('#autoStat').textContent,/크레딧/);h.run(`PracticeAI.setMode('accuracy')`);const pending=h.get('#autoMic').onclick();assert.equal(h.captures.length,1);h.captures[0].ready();h.captures[0].complete();await pending;assert.equal(h.run('practiceReward().total'),30);
});

test('leaving or changing learner during a semantic decision prevents stale progress in either profile',async()=>{
 for(const switchProfile of [false,true]){
  const delayed=deferred(),h=setup({route:r=>r.path==='/practice-ai/judge'?delayed.promise:undefined});h.run(`PracticeAI.setMode('meaning')`);h.start();h.type('Water would be nice.');await h.flush();const request=h.posts()[0];if(switchProfile)h.run(`learningProfileSwitch(learningProfileCreate('새 학습자'))`);else h.run('goToSetup()');assert.equal(request.options.signal.aborted,true);delayed.resolve(json({pass:true,retry:false,usage:{model:'fake',calls:1}}));await h.flush();assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.run('PracticeAI.usage().calls'),0);if(switchProfile){h.run(`learningProfileSwitch('legacy')`);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('PracticeAI.usage().calls'),0);}
 }
});

test('the lesson exit button cancels an in-flight judge and keeps the completed-session screen',async()=>{
 const delayed=deferred(),h=setup({route:r=>r.path==='/practice-ai/judge'?delayed.promise:undefined});h.run(`PracticeAI.setMode('meaning')`);h.start();h.type('Water would be nice.');await h.flush();const request=h.posts()[0];h.get('#autoExit').onclick();const done=h.get('#sprintScroll').innerHTML;assert.match(done,/다음에 이어서 연습/);assert.equal(request.options.signal.aborted,true);delayed.resolve(json({pass:true,retry:false}));await h.flush();assert.equal(h.run('supportEvents().length'),0);assert.equal(h.run('practiceReward().total'),0);assert.equal(h.get('#sprintScroll').innerHTML,done);
});

test('deduplicated assessment requests store usage metadata once without audio or transcript in usage or sync',async()=>{
 const usage={model:'test-model',calls:1,estimatedUsd:.00001,elapsedMs:12,audio:'private-audio-marker',transcript:'private-transcript-marker'},h=setup({route:r=>r.path==='/practice-ai/transcribe'?json({transcript:'Water would be nice.',usage}):r.path==='/practice-ai/judge'?json({pass:true,retry:false,usage}):undefined});h.context.sample=new Blob([wav],{type:'audio/wav'});h.start();
 await h.run(`Promise.all([PracticeAI.transcribe(sample,{},'same-stt'),PracticeAI.transcribe(sample,{},'same-stt')])`);await h.run(`Promise.all([PracticeAI.judge(autoDrill.items[0],'Water would be nice.','same-judge'),PracticeAI.judge(autoDrill.items[0],'Water would be nice.','same-judge')])`);await h.run(`PracticeAI.transcribe(sample,{},'same-stt');PracticeAI.judge(autoDrill.items[0],'Water would be nice.','same-judge')`);await h.flush();assert.equal(h.posts().length,2);assert.deepEqual(plain(h.run('PracticeAI.usage()')),{calls:2,transcribe:1,judge:1,estimatedUsd:.00002});const events=plain(h.run(`hGet('speakingroom:grading_usage_v1',{})`));assert.equal(Object.keys(events).length,2);for(const event of Object.values(events))assert.deepEqual(Object.keys(event).sort(),['calls','elapsedMs','estimatedUsd','kind','model','t']);const serialized=JSON.stringify(events);assert.doesNotMatch(serialized,/private-|Water|water|RIFF|transcript|audio/);assert.equal(plain(h.run('supportCollect()'))['speakingroom:grading_usage_v1'],undefined);
});
