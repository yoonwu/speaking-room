const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const root=path.resolve(__dirname,'../..');
function setup(seed={},options={}){
 const records=new Map(Object.entries(seed)),elements=new Map();
 function element(){return {style:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,addEventListener(){},setAttribute(){},focus(){},remove(){},insertBefore(){},querySelector:()=>element(),querySelectorAll:()=>[],getTracks:()=>[]};}
 const get=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s);};
 const context={window:{addEventListener(){},srNativePracticePlayback:false,...options.window},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},navigator:{},localStorage:{getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)},setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:false,status:404}),location:{reload(){}},console,Date,Math,URL,Blob,AbortController,Response};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'practice-data.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'practice-session.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'practice.js'),'utf8'),context);if(!options.realSpeech)vm.runInContext('speakEn=()=>{}',context);return {run:s=>vm.runInContext(s,context),context,records,elements};
}
test('travel grading keeps accepting meaningful variants and rejecting the wrong requested item',()=>{const {run}=setup();assert.equal(run(`travelGrade({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get another towel?'}},'Can I get one more towel?').ok`),true);assert.equal(run(`travelGrade({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get another towel?'}},'Can I get a fork?').ok`),false);});
test('only selected travel expressions are sampled, with no unrelated learning modes',()=>{const {run}=setup();const ids=run(`travelBuildItems(10,[TRAVEL_FRAMES[0]]).map(it=>it.frame.id)`);assert.equal(new Set(ids).size,1);assert.equal(ids[0],run('TRAVEL_FRAMES[0].id'));for(const name of ['startAutoDrill','startVocab','openPhonics','rankOpen','startReactDrill','openSpeakHub','awardXP'])assert.equal(run(`typeof ${name}`),'undefined');});
test('wrong answers enter the mistake list without extending the planned session, and three correct answers graduate the sentence',()=>{const {run}=setup();run(`startDrill(travelBuildItems(5,[TRAVEL_FRAMES[0]]),'여행 표현');autoDrillFinish('banana',{typed:true});`);assert.equal(run('autoDrill.items.length'),5);assert.equal(run('autoDrill.plannedCount'),5);assert.equal(run('missList().length'),1);run(`const failed=autoDrill.items[0];missRecord(failed,true);missRecord(failed,true);missRecord(failed,true);`);assert.equal(run('missList().length'),0);});
test('revealed answers remain practice attempts without adding questions',()=>{const {run}=setup();run(`startDrill(travelBuildItems(5,[TRAVEL_FRAMES[0]]),'여행 표현');autoDrill.items[0]._hintUsed=true;autoDrillFinish(autoDrill.items[0].ex.en,{typed:true});`);assert.equal(run('autoDrill.results[0].ok'),true);assert.equal(run('autoDrill.results[0].perfect'),false);assert.equal(run('autoDrill.items.length'),5);assert.equal(run('autoDrill.plannedCount'),5);});
test('existing travel, selection, and mistake records survive initialization',()=>{const old={'speakingroom:travelrepeat':JSON.stringify({travel_can_i_get:{ok:9,seen:9,introduced:true}}),'speakingroom:travel_study':JSON.stringify(['travel_can_i_get']),'speakingroom:travel_miss':JSON.stringify({'Can I get a towel?':{fid:'travel_can_i_get',miss:2,streak:0}}),'speakingroom:prof':JSON.stringify({xp:99})};const {records}=setup(old);for(const [k,v]of Object.entries(old))assert.equal(records.get(k),v);});
test('an AI reply arriving after leaving cannot replace the home or a new lesson',async()=>{const {run,context,elements}=setup();let resolve;context.delayed=new Promise(r=>resolve=r);run('callClaude=()=>delayed;state.scn=SURVIVAL[0];');const pending=run('startSession()');run('goToSetup()');resolve({content:[{type:'text',text:'Late reply'}]});await pending;assert.equal(run('curScreen'),'setup');assert.equal(run('state.busy'),false);assert.equal(run('state.convo.length'),0);assert.equal(elements.get('#threadInner').innerHTML,'');});

test('all 761 situations retain their answers and accept their full-sentence alternatives',()=>{
 const {run}=setup();const report=run(`TRAVEL_ALL_FRAMES.flatMap(frame=>frame.items.map(ex=>{const it={frame,ex};return {en:ex.en,answers:travelAnswerAlternatives(it),fail:travelAnswerAlternatives(it).filter(a=>!travelGrade(it,a).ok)};}))`);
 assert.equal(report.length,761);for(const row of report)assert.deepEqual([...row.fail],[],row.en);assert.ok(report.reduce((n,r)=>n+r.answers.length,0)>2700);
});
test('equivalent intentions pass without accepting wrong objects, numbers or polarity',()=>{
 const {run}=setup();const grade=(id,en,heard)=>run(`travelGrade({frame:TRAVEL_BY_ID[${JSON.stringify('travel_')}+${JSON.stringify(id)}],ex:{en:${JSON.stringify(en)}}},${JSON.stringify(heard)}).ok`);
 for(const [id,en,heard] of [
 ['do_you_have','Do you have an English menu?','Is there an English menu?'],
 ['is_there','Is there wifi in the room?','Do you have Wi-Fi in the room?'],
 ['can_i_get','Can I get two tickets?','Could I have two tickets please?'],
 ['pay_by_card','Can I pay by card?','Do you accept credit cards?'],
 ['how_much','How much is this shirt?',"What's the price of this shirt?"],
 ['do_i_need_to','Do I need to book in advance?','Do I have to book in advance?'],
 ['problem_with',"There's a problem with the wifi.",'Something is wrong with the wifi.'],
 ['say_again_slowly','Could you say that again, more slowly?','Could you repeat that more slowly?']
 ])assert.equal(grade(id,en,heard),true,heard);
 for(const [id,en,heard] of [
 ['can_i_get','Can I get two tickets?','Could I have three tickets?'],
 ['can_i_get','Can I get hot water?','Can I get iced water?'],
 ['can_i_get','Can I get a child seat?','Can I get a seat?'],
 ['can_you','Can you turn on the light?','Can you turn off the light?'],
 ['can_you','Can you open the door?','Can you close the door?'],
 ['does_that_mean',"Does that mean I can't order?",'Does that mean I can order?'],
 ['have_reservation','I have a reservation.','Is there a reservation?'],
 ['how_do_i_get_to','How do I get to the airport?','Where is the airport?'],
 ['say_again_slowly','Could you say that again, more slowly?','Could you repeat that?']
 ])assert.equal(grade(id,en,heard),false,heard);
});

 test('Android practice uses native recognition without WebView media APIs',async()=>{const {run,context}=setup();context.window.srNativePracticeSpeech=true;context.window.srNativeRequest=async action=>{assert.equal(action,'recognize');return {text:'I ordered two slices.'};};context.received=[];await run('micFillCb((text,meta)=>received.push(text))');assert.deepEqual(context.received,['I ordered two slices.']);assert.equal(run('qzRecording'),false);});
 test('native microphone failure clears recording and keeps its specific error',async()=>{const {run,context}=setup();context.window.srNativePracticeSpeech=true;context.window.srNativeRequest=async()=>{throw Error('network unavailable');};context.received=[];await run('micFillCb((text,meta)=>received.push(meta.sttErr))');assert.deepEqual(context.received,['network unavailable']);assert.equal(run('qzRecording'),false);});
 test('leaving practice discards a late native recognition result',async()=>{const {run,context}=setup();let resolve;context.window.srNativePracticeSpeech=true;context.window.srNativeRequest=action=>action==='recognize'?new Promise(r=>resolve=r):Promise.resolve({});context.received=[];const pending=run('micFillCb(text=>received.push(text))');run('stopMicrophone()');resolve({text:'Late answer'});await pending;assert.equal(context.received.length,0);assert.equal(run('qzRecording'),false);});

test('older Android installs get an update explanation rather than a web permission error',async()=>{const {run,context}=setup();context.window.srNativeRequest=async action=>{assert.equal(action,'status');return {};};context.received=[];await run('micFillCb((text,meta)=>received.push(meta.sttErr))');assert.match(context.received[0],/0\.5\.3/);assert.equal(run('qzRecording'),false);});

test('answer explains prepositions in context and retains original word meanings',()=>{const {run}=setup();assert.equal(run("prepNotes('Is there an extra charge for late checkout?')[0].w"),'for');assert.equal(run("prepNotes('I think I left the light on.')[0].t"),'켜짐·꺼짐 상태');assert.match(run("FREQ_DICT.charge"),/요금/);});

test('native recognition supplies the same recorded audio without a second microphone request',async()=>{const {run,context}=setup();context.atob=s=>Buffer.from(s,'base64').toString('binary');context.window.srNativePracticeSpeech=true;context.received=[];const bytes=Buffer.alloc(644,1);context.window.srNativeRequest=async(action,args)=>{assert.equal(action,'recognize');assert.equal(args.recordAnswer,true);return {text:'Can I get water?',audioBase64:bytes.toString('base64')};};await run(`micFillCb((text,meta)=>received.push({text,blob:meta.recordingBlob}),'Can I get water?')`);assert.equal(context.received[0].blob.size,644);assert.deepEqual(Buffer.from(await context.received[0].blob.arrayBuffer()),bytes);});

test('web device recognition retains recorded chunks before returning its fast transcription',async()=>{const {run,context}=setup();context.MediaRecorder=class{constructor(){this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}};context.audioChunk=new Blob([new Uint8Array(650)],{type:'audio/webm'});context.received=[];run(`getBestMime=()=>'';micStreamGet=async()=>({});micStreamIdle=()=>{};micLiveStart=()=>null;micLiveWait=async()=>({text:'Can I get water?'});vadArm=()=>{};sttRecognize=()=>{throw Error('Unexpected second recognition');};`);await run(`micFillCb((text,meta)=>received.push({text,blob:meta.recordingBlob}),'Can I get water?')`);run('qzMR.ondataavailable({data:audioChunk});');await run('qzMR.onstop()');assert.equal(context.received[0].text,'Can I get water?');assert.equal(context.received[0].blob.size,650);});

test('answer playback stops and releases audio when leaving, and a typed answer cannot replay a previous recording',async()=>{const {run,context,records}=setup();const revoked=[],players=[];context.URL={createObjectURL:()=> 'blob:current-answer',revokeObjectURL:url=>revoked.push(url)};context.Audio=class{constructor(url){this.url=url;this.paused=false;players.push(this);}async play(){}pause(){this.paused=true;}};context.clip=new Blob([new Uint8Array(650)]);run(`startDrill(travelBuildItems(3,[TRAVEL_FRAMES[0]]),'기본표현');autoDrillFinish(autoDrill.items[0].ex.en,{recordingBlob:clip});`);await run('listenMyVoice()');assert.equal(players[0].url,'blob:current-answer');run('goToSetup()');assert.equal(players[0].paused,true);assert.deepEqual(revoked,['blob:current-answer']);run(`startDrill(travelBuildItems(3,[TRAVEL_FRAMES[0]]),'기본표현');autoDrillFinish(autoDrill.items[0].ex.en,{typed:true});`);assert.equal(run('answerVoiceUrl'),null);assert.ok([...records.values()].every(v=>!String(v).includes('blob:current-answer')));});

test('cancelled recognition discards audio before decoding or displaying it',async()=>{const {run,context}=setup();let resolve;context.atob=()=>{throw Error('Late audio must not be decoded');};context.window.srNativePracticeSpeech=true;context.window.srNativeRequest=action=>action==='recognize'?new Promise(r=>resolve=r):Promise.resolve({});context.received=[];const pending=run(`micFillCb((text,meta)=>received.push(meta),'Can I get water?')`);run('stopMicrophone()');resolve({text:'Can I get water?',audioBase64:'unused'});await pending;assert.equal(context.received.length,0);assert.equal(run('answerVoiceUrl'),null);});

test('microphone cues bracket a completed native answer once, and cancellation or failure never sounds complete',async()=>{
 for(const outcome of ['success','cancel','error']){
  const {run,context}=setup();let resolve,reject;context.cues=[];context.answers=[];
  run('micBeep=()=>cues.push("start");micBeepEnd=()=>cues.push("end")');context.window.srNativePracticeSpeech=true;
  context.window.srNativeRequest=action=>action==='recognize'?new Promise((yes,no)=>{resolve=yes;reject=no;}):Promise.resolve({});
  const pending=run('micFillCb((text,meta)=>answers.push({text,meta}))');assert.deepEqual(context.cues,['start']);
  if(outcome==='cancel')run('stopMicrophone()');
  if(outcome==='error')reject(Error('permission denied'));else resolve({text:'Can I get water?'});
  await pending;assert.deepEqual(context.cues,outcome==='success'?['start','end']:['start']);
  assert.equal(context.answers.length,outcome==='cancel'?0:1);assert.equal(run('qzRecording||micPreparing'),false);
 }
});

test('device final recognition automatically stops the recording without another click, preserving recorded audio',async()=>{
 const {run,context}=setup();const recognizers=[],recorders=[];context.cues=[];context.answers=[];let finished;
 const done=new Promise(resolve=>finished=resolve);context.finished=finished;
 context.window.SpeechRecognition=class{constructor(){recognizers.push(this);}start(){}stop(){this.onend?.();}abort(){}};
 context.MediaRecorder=class{constructor(){recorders.push(this);this.state='inactive';this.mimeType='audio/webm';this.stops=0;}start(){this.state='recording';}stop(){if(this.state==='inactive')throw Error('duplicate stop');this.stops++;this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(650)])});this.onstop();}};
 run(`micBeep=()=>cues.push('start');micBeepEnd=()=>cues.push('end');getBestMime=()=>'';micStreamGet=async()=>({});micStreamIdle=()=>{};vadArm=()=>{};sttRecognize=()=>{throw Error('unexpected upload');};`);
 await run(`micFillCb((text,meta)=>{answers.push({text,meta});finished();},'Can I get water?')`);
 recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'Can I get'}],{isFinal:false})]});assert.equal(recorders[0].stops,0);
 recognizers[0].onresult({resultIndex:0,results:[Object.assign([{transcript:'Can I get water?'}],{isFinal:true})]});await done;
 assert.equal(recorders[0].stops,1);assert.equal(context.answers.length,1);assert.equal(context.answers[0].text,'Can I get water?');assert.equal(context.answers[0].meta.recordingBlob.size,650);assert.deepEqual(context.cues,['start','end']);
 recognizers[0].onend();assert.equal(recorders[0].stops,1);
});

test('a second press while microphone permission is pending cannot start two recordings',async()=>{
 const {run,context}=setup();let grant;context.opens=0;context.cues=[];
 run(`micBeep=()=>cues.push('start');micStreamGet=()=>{opens++;return new Promise(resolve=>grantMic=resolve);};`);
 const pending=run('micFillCb(()=>{})');await run('micFillCb(()=>{})');assert.equal(context.opens,1);assert.deepEqual(context.cues,['start']);
 run('stopMicrophone();grantMic({})');await pending;assert.equal(run('micPreparing||qzRecording'),false);
});

function audioClock(context,voiceAt){
 let now=0,sequence=0,resumes=0,disconnects=0;const tasks=new Map(),oscillators=[];
 context.Date=class extends Date{static now(){return now;}};
 context.setTimeout=(fn,ms=0)=>{const id=++sequence;tasks.set(id,{at:now+ms,fn});return id;};context.clearTimeout=id=>tasks.delete(id);
 const node=()=>({connect(){},disconnect(){disconnects++;}}),param=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
 context.window.AudioContext=class{constructor(){this.state='suspended';this.currentTime=0;this.destination={};}resume(){resumes++;this.state='running';return Promise.resolve();}createMediaStreamSource(){return node();}createAnalyser(){return {...node(),getByteTimeDomainData(buf){for(let i=0;i<buf.length;i++)buf[i]=128+(voiceAt(now)?(i%2?20:-20):0);}};}createGain(){return {...node(),gain:param()};}createOscillator(){const oscillator={...node(),frequency:param(),start(){oscillator.started=true;},stop(){oscillator.stopped=true;}};oscillators.push(oscillator);return oscillator;}};
 return {advance(ms){const end=now+ms;for(;;){let next=null;for(const [id,task]of tasks)if(task.at<=end&&(!next||task.at<next[1].at))next=[id,task];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=end;},get resumes(){return resumes;},get disconnects(){return disconnects;},oscillators};
}

test('silence detection resumes suspended audio, tolerates pauses, then stops without animation frames',()=>{
 const {run,context}=setup(),clock=audioClock(context,t=>(t>=300&&t<750)||(t>=1100&&t<1550));context.stops=0;
 run('cancelVAD=attachVAD({},()=>stops++,{silenceMs:600,maxSilenceMs:1400,expectWords:2,maxMs:25000,noSpeechMs:7000})');
 assert.equal(clock.resumes,1);clock.advance(1150);assert.equal(context.stops,0);clock.advance(700);assert.equal(context.stops,0);clock.advance(1000);assert.equal(context.stops,1);assert.ok(clock.disconnects>=2);clock.advance(30000);assert.equal(context.stops,1);
});

test('cancelling during the silence tail prevents late auto-submit and no-speech input also ends automatically',()=>{
 const first=setup(),clock=audioClock(first.context,t=>t>=300&&t<900);first.context.stops=0;
 first.run('cancelVAD=attachVAD({},()=>stops++,{silenceMs:600,maxMs:25000,noSpeechMs:7000})');clock.advance(1600);first.run('cancelVAD()');clock.advance(1000);assert.equal(first.context.stops,0);
 const second=setup(),quiet=audioClock(second.context,()=>false);second.context.stops=0;
 second.run('attachVAD({},()=>stops++,{maxMs:25000,noSpeechMs:7000})');quiet.advance(7500);assert.equal(second.context.stops,1);
});

test('both restored cues generate connected audio and reuse a running context for the microphone',()=>{
 const {run,context}=setup(),clock=audioClock(context,()=>false);run('micBeep();micBeepEnd()');assert.equal(clock.oscillators.length,2);assert.equal(clock.resumes,1);assert.ok(clock.oscillators.every(o=>o.started&&o.stopped));
});

test('capture completion sounds immediately while transcription is pending and cannot start a second recording',async()=>{
 const {run,context}=setup();let transcribe;context.cues=[];context.answers=[];context.opens=0;context.phases=[];
 context.MediaRecorder=class{constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(650)])});return this.onstop();}};
 context.transcription=new Promise(resolve=>transcribe=resolve);
 run(`micBeep=()=>cues.push('start');micBeepEnd=()=>cues.push('end');micStreamGet=async()=>{opens++;return {};};getBestMime=()=>'';micStreamIdle=()=>{};micLiveStart=()=>null;vadArm=()=>{};sttRecognize=()=>transcription;`);
 await run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I get water?',()=>phases.push('processing'))`);
 const pending=run('qzMR.stop()');assert.deepEqual(context.cues,['start','end']);assert.deepEqual(context.phases,['processing']);assert.equal(context.answers.length,0);
 await run('micFillCb(()=>{})');assert.equal(context.opens,1);
 transcribe({ok:true,json:async()=>({DisplayText:'Can I get water?'})});await pending;
 assert.equal(context.answers.length,1);assert.deepEqual(context.cues,['start','end']);assert.equal(run('micPreparing||qzRecording'),false);
});

test('installed app captures WAV and uses the server without invoking the failing device recognizer',async()=>{
 const {run,context}=setup(),actions=[],uploads=[];const audio=Buffer.alloc(644,1);context.atob=s=>Buffer.from(s,'base64').toString('binary');
 context.window.srNativePracticeSpeech=true;context.window.srNativePracticePlayback=true;
 context.window.srNativeRequest=async action=>{actions.push(action);assert.equal(action,'recordPractice');return {audioBase64:audio.toString('base64')};};
 context.fetch=async(url,options)=>{uploads.push({url,options});return new Response(JSON.stringify({DisplayText:'Can I get water?'}),{status:200});};context.answers=[];context.cues=[];context.phases=[];
 run(`micBeep=()=>cues.push('start');micBeepEnd=()=>cues.push('end');recordedToWav=()=>{throw Error('A native WAV must not wait for Web Audio');};`);
 await run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I get water?',()=>phases.push('processing'))`);
 assert.deepEqual(actions,['recordPractice']);assert.equal(uploads.length,1);assert.match(uploads[0].url,/\/stt$/);assert.equal(uploads[0].options.headers['Content-Type'],'audio/wav');
 assert.deepEqual(Buffer.from(await uploads[0].options.body.arrayBuffer()),audio);assert.equal(context.answers[0].text,'Can I get water?');assert.equal(context.answers[0].meta.recordingBlob.size,644);assert.deepEqual(context.cues,['start','end']);assert.deepEqual(context.phases,['processing']);assert.equal(run('qzRecording||micPreparing'),false);
});

test('native recording automatically stops at its bound even when background noise prevents silence detection',async()=>{
 const {run,context}=setup(),clock=audioClock(context,()=>false),actions=[];let captured;context.atob=s=>Buffer.from(s,'base64').toString('binary');context.window.srNativePracticeSpeech=true;context.window.srNativePracticePlayback=true;
 context.window.srNativeRequest=action=>{actions.push(action);if(action==='recordPractice')return new Promise(resolve=>captured=resolve);if(action==='recognizeStop')captured({audioBase64:Buffer.alloc(644,1).toString('base64')});return Promise.resolve({});};context.answers=[];
 run(`micBeep=()=>{};practiceTranscribe=async()=> 'Can I get water?'`);const pending=run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I get water?')`);
 clock.advance(7999);assert.deepEqual(actions,['recordPractice']);clock.advance(1);await pending;
 assert.deepEqual(actions,['recordPractice','recognizeStop']);assert.equal(context.answers[0].text,'Can I get water?');assert.equal(run('qzRecording||micPreparing'),false);
});

test('a nonresponsive native recording times out and releases the listening state',async()=>{
 const {run,context}=setup(),clock=audioClock(context,()=>false),actions=[];context.window.srNativePracticeSpeech=true;context.window.srNativePracticePlayback=true;
 context.window.srNativeRequest=action=>{actions.push(action);return action==='recordPractice'?new Promise(()=>{}):Promise.resolve({});};context.answers=[];
 run('micBeep=()=>{}');const pending=run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I get water?')`);clock.advance(13001);await pending;
 assert.deepEqual(actions,['recordPractice','recognizeStop','recognizeCancel']);assert.match(context.answers[0].meta.sttErr,/녹음이 응답하지/);assert.equal(run('qzRecording||micPreparing'),false);
});

test('cancelling native PCM capture never uploads or displays the late recording',async()=>{
 const {run,context}=setup();let captured;context.window.srNativePracticeSpeech=true;context.window.srNativePracticePlayback=true;
 context.window.srNativeRequest=action=>action==='recordPractice'?new Promise(resolve=>captured=resolve):Promise.resolve({});context.fetch=async()=>{throw Error('Late recording must not be uploaded');};context.answers=[];
 const pending=run('micFillCb((text,meta)=>answers.push({text,meta}))');run('stopMicrophone()');captured({audioBase64:'unused'});await pending;assert.equal(context.answers.length,0);assert.equal(run('qzRecording||micPreparing'),false);
});

test('server transcription can fall back after Azure fails and retains the real transcript',async()=>{
 const {run,context}=setup(),calls=[];
 context.fetch=async url=>{calls.push(url);return new Response(JSON.stringify(/\/stt$/.test(url)?{error:'temporarily unavailable'}:{DisplayText:'I cannot find my phone.'}),{status:/\/stt$/.test(url)?503:200});};
 const text=await run(`practiceTranscribe(new Blob([new Uint8Array(644)]),'audio/wav',{spoke:true,startAt:0,stopAt:2000},'',{preferAzure:true})`);
 assert.equal(text,'I cannot find my phone.');assert.equal(calls.length,2);assert.match(calls[0],/\/stt$/);assert.match(calls[1],/\/stt2$/);
});

test('fresh native capabilities choose PCM capture even when ChatGPT is not connected',async()=>{
 const {run,context}=setup(),actions=[];delete context.window.srNativePracticePlayback;context.window.srNativePracticeSpeech=true;context.atob=s=>Buffer.from(s,'base64').toString('binary');context.answers=[];
 context.window.srNativeRequest=async action=>{actions.push(action);if(action==='status')return {practiceSpeech:true,practicePlayback:true,connected:false,ready:false};assert.equal(action,'recordPractice');return {audioBase64:Buffer.alloc(644,1).toString('base64')};};
 run(`practiceTranscribe=async()=> 'Can I get water?'`);await run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I get water?')`);
 assert.deepEqual(actions,['status','recordPractice']);assert.equal(context.answers[0].text,'Can I get water?');
});

test('the start cue finishes before native capture so it cannot trigger speech detection',async()=>{
 const {run,context}=setup(),clock=audioClock(context,()=>false),actions=[];context.window.srNativePracticeSpeech=true;context.window.srNativePracticePlayback=true;context.atob=s=>Buffer.from(s,'base64').toString('binary');
 context.window.srNativeRequest=async action=>{actions.push(action);assert.equal(action,'recordPractice');return {audioBase64:Buffer.alloc(644,1).toString('base64')};};run(`practiceTranscribe=async()=> 'Can I get water?'`);
 const pending=run(`micFillCb(()=>{},'Can I get water?')`);assert.deepEqual(actions,[]);clock.advance(199);assert.deepEqual(actions,[]);clock.advance(1);await pending;assert.deepEqual(actions,['recordPractice']);
});

test('streaming native audio finishes capture before its final transcript and preserves replay without a second upload',async()=>{
 const {run,context}=setup();let complete;context.answers=[];context.cues=[];context.atob=s=>Buffer.from(s,'base64').toString('binary');
 Object.assign(context.window,{srNativePracticeSpeech:true,srNativePracticePlayback:true,srNativePracticeStreaming:true});
 context.fetch=()=>{throw Error('A streamed transcript must not upload the same audio again');};
 context.window.srNativeRequest=(action,data,onCaptured)=>{assert.equal(action,'streamPractice');onCaptured();onCaptured();return new Promise(resolve=>complete=resolve);};
 run(`micBeep=()=>cues.push('start');micBeepEnd=()=>cues.push('end');`);
 const pending=run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I leave my bags here?')`);
 assert.equal(run('qzRecording'),false);assert.equal(run('micPreparing'),true);assert.deepEqual(context.cues,['start','end']);assert.equal(context.answers.length,0);
 complete({text:'Can I leave my bags here?',audioBase64:Buffer.alloc(644,1).toString('base64')});await pending;
 assert.equal(context.answers.length,1);assert.equal(context.answers[0].text,'Can I leave my bags here?');assert.equal(context.answers[0].meta.recordingBlob.size,644);assert.equal(run('qzRecording||micPreparing'),false);assert.equal(context.window.srLastSpeechTiming.phase,'complete');assert.deepEqual(context.cues,['start','end']);
});

test('streaming failure and successful NoMatch never trigger a hidden second server wait',async()=>{
 for(const result of [{text:'',streamError:'음성 인식 응답이 늦어요. 다시 말해주세요.'},{text:''}]){
  const {run,context}=setup();context.answers=[];context.atob=s=>Buffer.from(s,'base64').toString('binary');Object.assign(context.window,{srNativePracticeSpeech:true,srNativePracticePlayback:true,srNativePracticeStreaming:true});
  context.fetch=()=>{throw Error('Unexpected second transcription request');};context.window.srNativeRequest=async(action,data,onCaptured)=>{assert.equal(action,'streamPractice');onCaptured();return {...result,audioBase64:Buffer.alloc(644,1).toString('base64')};};
  await run(`micFillCb((text,meta)=>answers.push({text,meta}),'Can I get water?')`);assert.equal(context.answers.length,1);assert.equal(context.answers[0].text,'');assert.equal(context.answers[0].meta.sttErr,result.streamError);assert.equal(run('qzRecording||micPreparing'),false);
 }
});

function referenceAudioHarness({delayedTts=false,hungBody=false,fallback=false,timed=false,gestureOnly=false,initialSpeed=30}={}){
 const fallbacks=[],platform=fallback?{speechSynthesis:{cancel(){},speak(utterance){fallbacks.push(utterance);}},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}}:{};
 const app=setup({}, {realSpeech:true,window:platform}),{context}=app,sources=[],requests=[],signals=[],native=[];let finishRecognition,finishTts,htmlPlays=0;
 const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
 let now=0,sequence=0;const timers=new Map();
 if(timed){context.setTimeout=(fn,ms=0)=>{const id=++sequence;timers.set(id,{at:now+ms,fn});return id;};context.clearTimeout=id=>timers.delete(id);}
 const clock={async advance(ms){const end=now+ms;await flush();for(;;){let next;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();},get pending(){return timers.size;}};
 context.atob=s=>Buffer.from(s,'base64').toString('binary');
 context.currentSpeed=initialSpeed;context.alGet=()=>({speed:context.currentSpeed});
 const create=context.document.createElement;context.document.createElement=(...args)=>Object.assign(create(...args),{isConnected:true});
 Object.assign(context.window,{srNativePracticeSpeech:true,srNativePracticePlayback:true,srNativePracticeStreaming:true});
 context.window.AudioContext=class{
  constructor(){this.state='suspended';this.destination={};}resume(){if(gestureOnly&&!context.userGesture)return new Promise(()=>{});return Promise.resolve().then(()=>{this.state='running';});}
  decodeAudioData(bytes,success){assert.ok(bytes.byteLength>=200);const buffer={decodedMp3:true};success?.(buffer);return Promise.resolve(buffer);}
  createBufferSource(){const source={connect(){},disconnect(){},start(){assert.equal(source.buffer.decodedMp3,true);source.started=true;},stop(){source.stopped=true;}};sources.push(source);return source;}
 };
 context.Audio=class{async play(){htmlPlays++;throw Object.assign(Error('user gesture required'),{name:'NotAllowedError'});}pause(){}};
 const response=()=>({ok:true,status:200,headers:{get:()=> 'audio/mpeg'},blob:async()=>new Blob([new Uint8Array(300)],{type:'audio/mpeg'})});
 context.fetch=async(url,options)=>{const parsed=new URL(url);requests.push(parsed);signals.push(options.signal);assert.equal(parsed.pathname,'/tts','reference text must only go to speech synthesis');if(hungBody)return {...response(),blob:()=>new Promise(resolve=>finishTts=()=>resolve(new Blob([new Uint8Array(300)],{type:'audio/mpeg'})))};if(delayedTts)return new Promise(resolve=>finishTts=()=>resolve(response()));return response();};
 context.window.srNativeRequest=(action,data,onCaptured)=>{native.push({action,data});if(action==='streamPractice'){onCaptured();return new Promise(resolve=>finishRecognition=heard=>resolve({text:heard,audioBase64:Buffer.alloc(644,1).toString('base64')}));}return Promise.resolve({});};
 app.run(`micBeep=()=>{micAudioReady();};micBeepEnd=()=>{};startDrill([{frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get some water?',ko:'물을 달라고 하세요.'},_intro:false}],'기본표현');`);
 return {...app,sources,requests,signals,native,flush,clock,fallbacks,get htmlPlays(){return htmlPlays;},finish(heard){finishRecognition(heard);},releaseTts(){finishTts();}};
}

test('a correct or incorrect streamed answer automatically plays the real reference audio once despite HTML autoplay rejection',async()=>{
 for(const [heard,correct]of [['Can I get some water?',true],['Can I get a towel?',false]]){
  const h=referenceAudioHarness();await h.flush();assert.equal(h.sources.length,0,'prefetch must remain silent');
  const pending=h.elements.get('#autoMic').onclick();await h.flush();assert.equal(h.sources.length,0,'no reference is played while recording or recognizing');
  h.finish(heard);await pending;await h.flush();
  assert.equal(h.run('autoDrill.results[0].ok'),correct);assert.equal(h.sources.filter(s=>s.started).length,1);assert.equal(h.htmlPlays,0);
  assert.equal(h.requests.length,1,'prefetch and automatic playback share the same MP3 request');assert.equal(h.requests[0].searchParams.get('text'),'Can I get some water?');
  const captureData=h.native.filter(call=>call.action==='streamPractice').map(call=>call.data);assert.ok(captureData.length);for(const data of captureData){assert.deepEqual(Object.keys(data),['expectedWords']);assert.ok(Number.isInteger(data.expectedWords));assert.equal(Object.values(data).some(v=>typeof v==='string'),false,'only a local length hint, never an answer phrase, reaches the native end detector');}
  h.run("autoDrillFinish('Can I get some water?',{})");await h.flush();assert.equal(h.sources.length,1,'a duplicate result cannot speak twice');
  h.elements.get('#answerListen').onclick();await h.flush();assert.equal(h.sources.filter(s=>s.started).length,2);assert.equal(h.sources[0].stopped,true);assert.equal(h.requests.length,1);
  h.elements.get('#answerLoop').onclick();await h.flush();assert.equal(h.sources.filter(s=>s.started).length,3);assert.equal(h.sources[1].stopped,true);assert.ok(h.run('answerLoopTimer'));
  h.elements.get('#answerLoop').onclick();assert.equal(h.run('answerLoopTimer'),null);assert.equal(h.requests.length,1,'repeat playback reuses the prefetched audio');
  h.elements.get('#answerSay').onclick();await h.flush();assert.equal(h.sources[2].stopped,true,'retry cancels reference playback');assert.equal(h.sources.length,3);
 }
});

test('leaving after a streamed result prevents late prefetched reference audio from starting or falling back',async()=>{
 const h=referenceAudioHarness({delayedTts:true});const pending=h.elements.get('#autoMic').onclick();await h.flush();h.finish('Can I get some water?');await pending;await h.flush();
 assert.equal(h.sources.length,0);h.run('goToSetup()');h.releaseTts();await h.flush();
 assert.equal(h.sources.length,0);assert.equal(h.htmlPlays,0);assert.equal(h.run('curScreen'),'setup');assert.equal(h.requests.length,1);
});

test('adaptive speed changes after grading reuse the prefetched rate and the next question snapshots the new rate',async()=>{
 const h=referenceAudioHarness({initialSpeed:10});await h.flush();const firstRate=h.requests[0].searchParams.get('rate');
 h.run(`autoDrill.items.push({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get a towel?',ko:'수건을 달라고 하세요.'},_intro:false});autoDrill.plannedCount=2;recordPractice=()=>{currentSpeed=50;return {xp:0};};`);
 const pending=h.elements.get('#autoMic').onclick();await h.flush();h.finish('Can I get some water?');await pending;await h.flush();
 assert.equal(h.requests.length,1,'grading must not refetch the same reference at a newly adapted speed');assert.equal(h.sources.filter(s=>s.started).length,1);
 h.elements.get('#answerListen').onclick();await h.flush();assert.equal(h.requests.length,1);
 h.elements.get('#autoNext').onclick();await h.flush();assert.equal(h.requests.length,2);assert.equal(h.requests[1].searchParams.get('text'),'Can I get a towel?');assert.ok(Number(h.requests[1].searchParams.get('rate'))>Number(firstRate));
 assert.equal(h.sources.filter(s=>s.started).length,2,'drawing the next question only prefetches, without reading it aloud');
});

test('a hung prefetched MP3 body is aborted at eight seconds, falls back once, and cannot play late or after leaving',async()=>{
 for(const leave of [false,true]){
  const h=referenceAudioHarness({hungBody:true,timed:true,fallback:true});await h.flush();
  const pending=h.elements.get('#autoMic').onclick();await h.flush();h.finish('Can I get some water?');await pending;await h.flush();
  assert.equal(h.requests.length,1,'grading shares the existing hung prefetch');assert.equal(h.fallbacks.length,0);assert.equal(h.sources.length,0);
  if(leave)h.run('goToSetup()');
  await h.clock.advance(7999);assert.equal(h.signals[0].aborted,false);assert.equal(h.fallbacks.length,0);
  await h.clock.advance(1);assert.equal(h.signals[0].aborted,true);assert.equal(h.run('_svPending.size'),0);assert.equal(h.clock.pending,0);
  assert.equal(h.fallbacks.length,leave?0:1);if(!leave)assert.equal(h.fallbacks[0].text,'Can I get some water?');
  h.releaseTts();await h.flush();assert.equal(h.sources.length,0);assert.equal(h.run('_svCache.size'),0);assert.equal(h.fallbacks.length,leave?0:1,'late provider bytes cannot replay the reference or re-run fallback');
 }
});

test('typing or manually replaying a first native answer unlocks audio during the gesture before the MP3 await',async()=>{
 for(const typed of [true,false]){
  const h=referenceAudioHarness({gestureOnly:true});await h.flush();assert.equal(h.run('_micAudio.state'),'suspended');
  h.context.userGesture=true;
  if(typed){h.elements.get('#autoType').onclick();h.elements.get('#autoInput').value='Can I get some water?';h.elements.get('#autoInput').onkeydown({key:'Enter',target:h.elements.get('#autoInput'),preventDefault(){}});}
  else h.run(`speakEn('Can I get some water?')`);
  h.context.userGesture=false;await h.flush();
  assert.equal(h.run('_micAudio.state'),'running');assert.equal(h.sources.filter(s=>s.started).length,1);assert.equal(h.htmlPlays,0);
  assert.equal(h.requests.length,1);assert.equal(h.native.some(call=>call.action==='streamPractice'),false);
 }
});

test('a denied AudioContext resume never traps native playback waiting for an unresolved resume promise',async()=>{
 const h=referenceAudioHarness({gestureOnly:true});await h.flush();let finished=false;
 const pending=h.run(`svSpeak('Can I get some water?',levelRate())`).then(ok=>{finished=true;assert.equal(ok,false);});
 await h.flush();assert.equal(finished,true);assert.equal(h.sources.length,0);assert.equal(h.htmlPlays,1);await pending;
});

// Advance wall time and all promise continuations together, without waiting for
// real network time. Requests retain abort signals even when a server responds late.
function sttHarness(){
 const app=setup(),{context}=app,tasks=new Map(),calls=[];let now=1000000,sequence=0;
 context.Date=class extends Date{static now(){return now;}};
 context.setTimeout=(fn,ms=0)=>{const id=++sequence;tasks.set(id,{at:now+ms,fn});return id;};context.clearTimeout=id=>tasks.delete(id);
 const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
 const clock={get now(){return now-1000000;},get pending(){return tasks.size;},async advance(ms){
  const end=now+ms;await flush();
  for(;;){let next=null;for(const [id,task]of tasks)if(task.at<=end&&(!next||task.at<next[1].at))next=[id,task];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();await flush();}
  now=end;await flush();
 }};
 const routes={};context.fetch=(url,options)=>{
  const route=routes[new URL(url).pathname]||{},call={path:new URL(url).pathname,at:clock.now,signal:options.signal};calls.push(call);
  return new Promise((resolve,reject)=>{
   let headTimer,bodyTimer,bodyReject;const bytes=Buffer.from(JSON.stringify(route.data||{DisplayText:call.path==='/stt'?'primary transcript':'backup transcript'}));
   if(route.head!=null)headTimer=context.setTimeout(()=>resolve({status:route.status||200,headers:{'Content-Type':'application/json'},arrayBuffer:()=>new Promise((done,fail)=>{
    bodyReject=fail;
    bodyTimer=context.setTimeout(()=>done(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),route.body||0);
   })}),route.head);
   options.signal.addEventListener('abort',()=>{call.abortedAt=clock.now;if(!route.ignoreAbort){context.clearTimeout(headTimer);context.clearTimeout(bodyTimer);const error=Object.assign(Error('aborted'),{name:'AbortError'});reject(error);if(bodyReject)bodyReject(error);}},{once:true});
  });
 };
 const start=()=>{let outcome;const done=app.run(`sttRecognize(new Blob([new Uint8Array(644)]),'audio/wav',{preferAzure:true})`).then(value=>{outcome={value,at:clock.now};},error=>{outcome={error,at:clock.now};});return {done,get outcome(){return outcome;}};};
 return {...app,routes,calls,clock,start};
}

test('native fast primary response finishes without starting or leaving a backup timer',async()=>{
 const h=sttHarness();h.routes['/stt']={head:100,body:100};const request=h.start();
 await h.clock.advance(200);assert.ok(request.outcome?.value);assert.equal(request.outcome.at,200);assert.equal((await request.outcome.value.json()).DisplayText,'primary transcript');
 await h.clock.advance(10000);assert.deepEqual(h.calls.map(c=>c.path),['/stt']);assert.equal(h.clock.pending,0);await request.done;
});

test('native slow primary starts a backup after two seconds and a fully read backup wins before ten seconds',async()=>{
 const h=sttHarness();h.routes['/stt']={head:100,body:6000,ignoreAbort:true};h.routes['/stt2']={head:100,body:100};const request=h.start();
 await h.clock.advance(1999);assert.deepEqual(h.calls.map(c=>c.path),['/stt']);assert.equal(request.outcome,undefined);
 await h.clock.advance(201);assert.equal(request.outcome.at,2200);assert.equal((await request.outcome.value.json()).DisplayText,'backup transcript');
 assert.deepEqual(h.calls.map(c=>[c.path,c.at]),[['/stt',0],['/stt2',2000]]);assert.equal(h.calls[0].signal.aborted,true);
 await h.clock.advance(6000);assert.equal(request.outcome.at,2200);assert.equal(h.run('_sttVia'),'관대');assert.equal(h.clock.pending,0);await request.done;
});

test('native primary failure starts the backup immediately instead of waiting for its hedge delay',async()=>{
 const h=sttHarness();h.routes['/stt']={head:50,status:503};h.routes['/stt2']={head:100};const request=h.start();
 await h.clock.advance(150);assert.equal(request.outcome.at,150);assert.equal((await request.outcome.value.json()).DisplayText,'backup transcript');assert.deepEqual(h.calls.map(c=>[c.path,c.at]),[['/stt',0],['/stt2',50]]);assert.equal(h.clock.pending,0);await request.done;
});

test('native hung providers share a seven second deadline rather than serial ten second waits and an Azure retry',async()=>{
 const h=sttHarness(),request=h.start();await h.clock.advance(6999);assert.equal(request.outcome,undefined);
 await h.clock.advance(1);assert.match(request.outcome?.error?.message||'',/응답이 늦어요/);assert.equal(request.outcome.at,7000);assert.deepEqual(h.calls.map(c=>c.path),['/stt','/stt2']);assert.ok(h.calls.every(c=>c.signal.aborted));assert.equal(h.clock.pending,0);
 await h.clock.advance(23000);assert.equal(h.calls.length,2);assert.equal(request.outcome.at,7000);await request.done;
 assert.ok(h.run('_sttSoftOff-Date.now()')>4*60000);const next=h.start();await h.clock.advance(7000);assert.match(next.outcome.error.message,/응답이 늦어요/);assert.deepEqual(h.calls.map(c=>c.path),['/stt','/stt2','/stt']);assert.equal(h.clock.pending,0);await next.done;
});

test('native primary success cancels a pending healthy backup without imposing a failure cooldown',async()=>{
 const h=sttHarness();h.routes['/stt']={head:2400};h.routes['/stt2']={head:5000};const first=h.start();await h.clock.advance(2400);
 assert.equal((await first.outcome.value.json()).DisplayText,'primary transcript');assert.equal(h.calls[1].signal.aborted,true);assert.equal(h.run('_sttSoftOff'),0);assert.equal(h.clock.pending,0);await first.done;
 h.routes['/stt']={};h.routes['/stt2']={head:100};const next=h.start();await h.clock.advance(2100);assert.equal((await next.outcome.value.json()).DisplayText,'backup transcript');assert.deepEqual(h.calls.map(c=>c.path),['/stt','/stt2','/stt','/stt2']);assert.equal(h.clock.pending,0);await next.done;
});

test('native secondary backoff prevents backup requests and both HTTP failures return promptly',async()=>{
 const h=sttHarness();h.routes['/stt']={head:50,status:503};h.routes['/stt2']={head:50,status:429,data:{error:'insufficient_quota'}};const first=h.start();
 await h.clock.advance(100);assert.match(first.outcome.error.message,/429/);assert.equal(first.outcome.at,100);assert.ok(h.run('_sttSoftOff-Date.now()')>=29*60000);await first.done;
 h.routes['/stt']={};const next=h.start();await h.clock.advance(7000);assert.match(next.outcome.error.message,/응답이 늦어요/);assert.deepEqual(h.calls.map(c=>c.path),['/stt','/stt2','/stt']);assert.equal(h.clock.pending,0);await next.done;
});
