const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function loadWorker(fetch){
  const context={fetch,Request,Response,Headers,ReadableStream,URL,FormData,File,console};
  vm.createContext(context);
  const source=fs.readFileSync(path.resolve(__dirname,'../../cloudflare-worker.js'),'utf8');
  vm.runInContext(source.replace('export default {','globalThis.worker = {'),context);
  return context.worker;
}
function speechRequest(body,contentType='audio/wav'){
  return new Request('https://example.test/stt',{method:'POST',headers:{'Content-Type':contentType},body,duplex:'half'});
}
const env={AZURE_SPEECH_KEY:'test-only-placeholder',AZURE_SPEECH_REGION:'koreacentral'};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

test('speech upload reaches Azure before the microphone stream ends, retaining chunk order and backpressure',async()=>{
  let incoming,closed=false,started=false,firstSeen,secondSeen;
  const firstReady=new Promise(resolve=>firstSeen=resolve),secondReady=new Promise(resolve=>secondSeen=resolve);
  const input=new ReadableStream({start(controller){incoming=controller;controller.enqueue(new Uint8Array([82,73,70,70]));}});
  const request=speechRequest(input);
  const worker=loadWorker(async(url,options)=>{
    started=true;
    assert.match(url,/https:\/\/koreacentral\.stt\.speech\.microsoft\.com\//);
    assert.equal(new URL(url).searchParams.get('format'),'detailed','retain the lexical form instead of only formatted display text');
    assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'audio/wav');
    assert.equal(options.headers['Ocp-Apim-Subscription-Key'],env.AZURE_SPEECH_KEY);
    const reader=options.body.getReader();
    firstSeen(await reader.read());assert.equal(closed,false,'first audio arrives while recording is still open');
    secondSeen(await reader.read());
    assert.equal((await reader.read()).done,true);
    return Response.json({DisplayText:'Can I get water?'});
  });
  const pending=worker.fetch(request,env,{});
  try{
    assert.equal(started,true,'upstream fetch must not wait for request.arrayBuffer()');
    assert.deepEqual(Array.from((await firstReady).value),[82,73,70,70]);
    incoming.enqueue(new Uint8Array([1,2,3,4]));
    assert.deepEqual(Array.from((await secondReady).value),[1,2,3,4]);
  }finally{closed=true;incoming.close();}
  const response=await pending;
  assert.equal(response.status,200);assert.equal((await response.json()).DisplayText,'Can I get water?');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(response.headers.get('Ocp-Apim-Subscription-Key'),null);
});

test('speech response exposes provider bytes without buffering the entire response',async()=>{
  let provider,returned;
  const output=new ReadableStream({start(controller){provider=controller;controller.enqueue(new TextEncoder().encode('{"DisplayText":'));}});
  const worker=loadWorker(async()=>new Response(output,{status:200}));
  const pending=worker.fetch(speechRequest(new Uint8Array([1,2])),env,{}).then(response=>returned=response);
  try{
    await flush();assert.ok(returned,'proxy headers must be available before provider body closes');
    const reader=returned.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),'{"DisplayText":');
    provider.enqueue(new TextEncoder().encode('"water"}'));provider.close();provider=null;
    assert.equal(new TextDecoder().decode((await reader.read()).value),'"water"}');
    assert.equal((await reader.read()).done,true);
  }finally{if(provider)provider.close();await pending;}
});

test('provider errors retain HTTP status, raw response and CORS without exposing the upstream key',async()=>{
  const worker=loadWorker(async()=>new Response('provider quota exceeded',{status:429}));
  const response=await worker.fetch(speechRequest(new Uint8Array([1,2]),'audio/ogg'),env,{});
  assert.equal(response.status,429);assert.equal(await response.text(),'provider quota exceeded');
  assert.equal(response.headers.get('Content-Type'),'application/json');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(response.headers.get('Ocp-Apim-Subscription-Key'),null);
});

test('transport errors preserve the existing JSON error and CORS response',async()=>{
  const worker=loadWorker(async()=>{throw Error('upstream unavailable');});
  const response=await worker.fetch(speechRequest(new Uint8Array([1,2])),env,{});
  assert.equal(response.status,500);assert.match((await response.json()).error,/upstream unavailable/);
  assert.equal(response.headers.get('Content-Type'),'application/json');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
});

test('preflight is cached for ten minutes and version identifies the streaming proxy',async()=>{
  let calls=0;const worker=loadWorker(async()=>{calls++;throw Error('unexpected upstream call');});
  const preflight=await worker.fetch(new Request('https://example.test/stt',{method:'OPTIONS'}),env,{});
  assert.equal(preflight.status,200);assert.equal(preflight.headers.get('Access-Control-Max-Age'),'600');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'*');
  assert.match(preflight.headers.get('Access-Control-Allow-Methods'),/POST/);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Content-Type/);
  const version=await worker.fetch(new Request('https://example.test/version'),env,{});
  assert.equal(await version.text(),'worker-v11');assert.equal(calls,0);
});
