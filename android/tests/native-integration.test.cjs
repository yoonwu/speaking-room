const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function setup(){
  const elements=new Map(),calls=[];
  const element=()=>({style:{},appendChild(){},querySelector(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},showModal(){},close(){},click(){}});
  const values=new Map([['progress','saved'],['sr_gh_pat','private'],['access_token','private']]);
  const context={window:{SpeakingRoomNative:{postMessage(raw){const m=JSON.parse(raw);calls.push(m);context.window.SpeakingRoomNative.onmessage({data:JSON.stringify({id:m.id,ok:true,result:{}})});}}},document:{createElement:element,head:element(),body:element(),getElementById:()=>element()},setTimeout:()=>1,clearTimeout(){},state:{convo:[],engine:'survival',ttsOn:true},stage:{style:{}},setBusy(){},addMeTurn(t){calls.push(['user',t])},addCoachTurn(t){calls.push(['assistant',t,context.state.ttsOn])},questBump(){calls.push(['quest'])},stripUsedMarker:raw=>({clean:raw.split('⟦')[0],ids:['ordered'],turnEval:{ok:true}}),convoRecordUsedBlocks(){calls.push(['blocks'])},convoRecordVerbTargets(){calls.push(['verbs'])},convoRecordTurnEval(){calls.push(['eval'])},convoTrackBlocks(){},goToSetup(){},localStorage:{get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},location:{reload(){calls.push(['reload'])}},confirm:()=>true};
  vm.runInNewContext(fs.readFileSync(path.join(root,'android-native.js'),'utf8'),context);
  return {context,elements,calls,values};
}
test('voice turns update original conversation and learning metrics once without web TTS',()=>{
  const {context,calls}=setup(); const events=JSON.stringify([{id:1,kind:'user',text:'I ordered two slices.'},{id:2,kind:'assistant',raw:'Let me check.⟦USED:ordered⟧',user:'I ordered two slices.'}]);
  context.window.srNativeEvents(events);context.window.srNativeEvents(events);
  assert.equal(context.state.convo.length,2);assert.equal(calls.filter(c=>c[0]==='blocks').length,1);
  assert.equal(calls.find(c=>c[0]==='assistant')[2],false);assert.equal(context.state.ttsOn,true);
});
test('help answers do not count as learner skill evidence',()=>{
  const {context,calls}=setup();context.window.srNativeEvents(JSON.stringify([{id:1,kind:'assistant',raw:'I ordered two slices.',user:'example please',help:true}]));
  assert.equal(context.state.convo.length,1);assert.equal(calls.filter(c=>['blocks','verbs','eval'].includes(c[0])).length,0);
});
test('progress export excludes developer and account credentials',async()=>{
  const {elements,calls}=setup();await elements.get('#srExportProgress').onclick();
  const backup=JSON.parse(calls.find(c=>c.action==='backup').data.text);assert.deepEqual(backup.records,{progress:'saved'});
});
test('invalid credential-containing imports leave progress untouched',async()=>{
  const {elements,values}=setup();await elements.get('#srProgressFile').onchange({target:{files:[{size:100,text:async()=>JSON.stringify({format:'speaking-room-progress',version:1,records:{progress:'changed',access_token:'bad'}})}]}});
  assert.equal(values.get('progress'),'saved');
});
test('native provider calls do not use the hosted Claude proxy',async()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),start=html.indexOf('async function callClaude('),end=html.indexOf('\n}',start)+2;
  assert.ok(start>=0);const context={window:{SpeakingRoomNative:{},srNativeRequest:async(action,data)=>{assert.equal(action,'infer');assert.equal(data.instructions,'scenario');return {text:'Hello'};}},fetch:()=>{throw new Error('Hosted proxy used');}};
  vm.runInNewContext(html.slice(start,end),context);assert.equal((await context.callClaude('scenario',[{role:'user',content:'Hi'}])).content[0].text,'Hello');
});
