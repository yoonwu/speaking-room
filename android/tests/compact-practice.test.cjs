const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const root=path.resolve(__dirname,'../..');
function setup(seed={}){
 const records=new Map(Object.entries(seed)),elements=new Map();
 function element(){return {style:{},hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,addEventListener(){},setAttribute(){},focus(){},remove(){},insertBefore(){},querySelector:()=>element(),querySelectorAll:()=>[],getTracks:()=>[]};}
 const get=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s);};
 const context={window:{addEventListener(){}},document:{querySelector:get,querySelectorAll:()=>[],createElement:element,body:{appendChild(){}}},navigator:{},localStorage:{getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)},setTimeout:()=>1,clearTimeout(){},fetch:async()=>({ok:false,status:404}),location:{reload(){}},console,Date,Math,URL,Blob};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'practice-data.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'practice.js'),'utf8'),context);vm.runInContext('speakEn=()=>{}',context);return {run:s=>vm.runInContext(s,context),context,records,elements};
}
test('travel grading keeps accepting meaningful variants and rejecting the wrong requested item',()=>{const {run}=setup();assert.equal(run(`travelGrade({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get another towel?'}},'Can I get one more towel?').ok`),true);assert.equal(run(`travelGrade({frame:TRAVEL_BY_ID.travel_can_i_get,ex:{en:'Can I get another towel?'}},'Can I get a fork?').ok`),false);});
test('only selected travel expressions are sampled, with no unrelated learning modes',()=>{const {run}=setup();const ids=run(`travelBuildItems(10,[TRAVEL_FRAMES[0]]).map(it=>it.frame.id)`);assert.equal(new Set(ids).size,1);assert.equal(ids[0],run('TRAVEL_FRAMES[0].id'));for(const name of ['startAutoDrill','startVocab','openPhonics','rankOpen','startReactDrill','openSpeakHub','awardXP'])assert.equal(run(`typeof ${name}`),'undefined');});
test('wrong answers are saved and recur later, and three correct answers graduate the sentence',()=>{const {run}=setup();run(`startDrill(travelBuildItems(5,[TRAVEL_FRAMES[0]]),'여행 표현');autoDrillFinish('banana',{typed:true});`);assert.equal(run('autoDrill.items.length'),6);assert.equal(run('missList().length'),1);run(`const failed=autoDrill.items[0];missRecord(failed,true);missRecord(failed,true);missRecord(failed,true);`);assert.equal(run('missList().length'),0);});
test('revealed answers remain practice attempts and are scheduled again',()=>{const {run}=setup();run(`startDrill(travelBuildItems(5,[TRAVEL_FRAMES[0]]),'여행 표현');autoDrill.items[0]._hintUsed=true;autoDrillFinish(autoDrill.items[0].ex.en,{typed:true});`);assert.equal(run('autoDrill.results[0].ok'),true);assert.equal(run('autoDrill.results[0].perfect'),false);assert.equal(run('autoDrill.items.length'),6);});
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
