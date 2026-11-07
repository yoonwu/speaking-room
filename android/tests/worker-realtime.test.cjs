const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Socket {
  constructor() { this.listeners = {}; this.sent = []; this.closed = []; this.accepted = false; }
  accept() { this.accepted = true; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed.push({ code, reason }); }
  emit(type, event = {}) { for (const listener of this.listeners[type] || []) listener(event); }
}
function load(fetch) {
  const pairs = [], timers = [];
  class Pair { constructor() { this[0] = new Socket(); this[1] = new Socket(); pairs.push(this); } }
  function WorkerResponse(body, options = {}) {
    if (options.status === 101) return { status: 101, headers: new Headers(options.headers), webSocket: options.webSocket };
    return new Response(body, options);
  }
  WorkerResponse.json = Response.json;
  const context = { fetch, Request, Response: WorkerResponse, Headers, ReadableStream, URL, FormData, File, TextEncoder, TextDecoder, AbortController,
    WebSocketPair: Pair, setTimeout(fn, ms) { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { if (timer) timer.cleared = true; }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../cloudflare-worker.js'), 'utf8').replace('export default {', 'globalThis.worker = {'), context);
  return { worker: context.worker, pairs, timers };
}
const env = { AZURE_SPEECH_KEY: 'private-azure-key', AZURE_SPEECH_REGION: 'koreacentral' };
function upgrade(query = '?language=en-US&format=detailed', headers = {}) {
  return new Request('https://example.test/practice-realtime' + query, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'USP', ...headers } });
}
async function connected() {
  const provider = new Socket(), loaded = load(async () => ({ status: 101, webSocket: provider, headers: new Headers({ 'Sec-WebSocket-Protocol': 'USP' }) }));
  const response = await loaded.worker.fetch(upgrade(), env, {});
  return { ...loaded, provider, server: loaded.pairs[0][1], response };
}

test('realtime availability requires the existing Azure key and a safe region', async () => {
  let calls = 0; const { worker } = load(async () => { calls++; });
  for (const [config, available] of [[env, true], [{}, false], [{ ...env, AZURE_SPEECH_REGION: 'evil.test/path' }, false]]) {
    const response = await worker.fetch(new Request('https://example.test/practice-realtime/status'), config, {}), body = await response.json();
    assert.equal(body.available, available); assert.equal(body.version, 'worker-v10'); assert.ok(!JSON.stringify(body).includes(env.AZURE_SPEECH_KEY));
  }
  assert.equal(calls, 0);
});

test('upgrade connects only to fixed Azure host with server key, stripping all client auth and unknown query', async () => {
  const provider = new Socket(); let called = 0;
  const { worker, pairs } = load(async (address, options) => {
    called++; const url = new URL(address);
    assert.equal(url.origin, 'https://koreacentral.stt.speech.microsoft.com');
    assert.equal(url.pathname, '/speech/recognition/conversation/cognitiveservices/v1');
    assert.equal(url.searchParams.get('language'), 'en-US'); assert.equal(url.searchParams.get('format'), 'detailed');
    assert.equal(url.searchParams.get('X-ConnectionId'), '0123456789abcdef0123456789abcdef');
    assert.equal(url.searchParams.get('profanity'), 'masked'); assert.equal(url.searchParams.get('endSilenceTimeoutMs'), '500');
    for (const name of ['subscription-key', 'authorization', 'target', 'endpoint', 'unknown']) assert.equal(url.searchParams.has(name), false);
    assert.equal(options.headers['Ocp-Apim-Subscription-Key'], env.AZURE_SPEECH_KEY); assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Upgrade, 'websocket'); assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
    assert.equal(options.headers['Sec-WebSocket-Protocol'], 'USP');
    return { status: 101, webSocket: provider, headers: new Headers({ 'Sec-WebSocket-Protocol': 'USP' }) };
  });
  const response = await worker.fetch(upgrade('?language=en-US&format=detailed&X-ConnectionId=0123456789abcdef0123456789abcdef&profanity=masked&endSilenceTimeoutMs=500&subscription-key=client-fake-key&authorization=consumer-token&target=water&endpoint=https://evil.test&unknown=sdk-metadata', { Authorization: 'Bearer client-token', 'Ocp-Apim-Subscription-Key': 'client-fake-key' }), env, {});
  assert.equal(response.status, 101); assert.equal(response.webSocket, pairs[0][0]); assert.equal(pairs[0][1].accepted, true); assert.equal(provider.accepted, true);
  assert.equal(response.headers.get('Sec-WebSocket-Protocol'), 'USP');
  assert.equal(provider.binaryType, 'arraybuffer'); assert.equal(pairs[0][1].binaryType, 'arraybuffer'); assert.equal(called, 1);
});

test('non-upgrade, unsupported language, invalid timeouts and duplicate query fail before upstream', async () => {
  let calls = 0; const { worker } = load(async () => { calls++; });
  const regular = await worker.fetch(new Request('https://example.test/practice-realtime'), env, {}); assert.equal(regular.status, 426);
  const unsupported = await worker.fetch(upgrade('', { 'Sec-WebSocket-Protocol': 'other' }), env, {}); assert.equal(unsupported.status, 400);
  for (const query of ['?language=ko-KR', '?format=simple', '?endSilenceTimeoutMs=99999', '?initialSilenceTimeoutMs=-1', '?X-ConnectionId=invalid', '?format=detailed&format=detailed']) {
    const response = await worker.fetch(upgrade(query), env, {}); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'bad_query');
  }
  assert.equal(calls, 0);
});

test('bidirectional text/binary frames retain order; close cleans up both peers and timer', async () => {
  const { server, provider, timers } = await connected(), bytes = new Uint8Array([1, 2, 3]).buffer;
  server.emit('message', { data: 'speech.config' }); server.emit('message', { data: bytes });
  assert.deepEqual(provider.sent, ['speech.config', bytes]);
  provider.emit('message', { data: 'speech.hypothesis' }); provider.emit('message', { data: 'speech.phrase' });
  assert.deepEqual(server.sent, ['speech.hypothesis', 'speech.phrase']);
  provider.emit('close', { code: 1000 }); assert.equal(provider.closed.length, 1); assert.equal(server.closed.length, 1);
  assert.equal(timers.find(timer => timer.ms === 30000).cleared, true);
  server.emit('message', { data: bytes }); assert.equal(provider.sent.length, 2);
});

test('client binary audio is capped at one MiB and small text at sixteen KiB per frame', async () => {
  const binary = await connected();
  binary.server.emit('message', { data: new Uint8Array(600000).buffer });
  binary.server.emit('message', { data: new Uint8Array(600000).buffer });
  assert.equal(binary.provider.sent.length, 1); assert.equal(binary.server.closed[0].code, 1009); assert.equal(binary.provider.closed[0].code, 1009);
  const text = await connected(); text.server.emit('message', { data: 'x'.repeat(16385) });
  assert.equal(text.provider.sent.length, 0); assert.equal(text.server.closed[0].code, 1009);
});

test('provider response cap, transport errors and thirty-second lifetime close both peers', async () => {
  const oversized = await connected(); oversized.provider.emit('message', { data: new Uint8Array(2097153).buffer });
  assert.equal(oversized.server.sent.length, 0); assert.equal(oversized.server.closed[0].code, 1009);
  const broken = await connected(); broken.server.emit('error'); assert.equal(broken.provider.closed[0].code, 1011);
  const timeout = await connected(); timeout.timers.find(timer => timer.ms === 30000).fn();
  assert.equal(timeout.server.closed[0].code, 1000); assert.equal(timeout.provider.closed[0].reason, 'time limit');
});

test('provider rejection and exceptions never expose upstream error bodies, keys or credential headers', async () => {
  for (const fetch of [async () => ({ status: 401, headers: new Headers(), text: async () => env.AZURE_SPEECH_KEY }), async () => { throw Error(env.AZURE_SPEECH_KEY); }]) {
    const { worker } = load(fetch), response = await worker.fetch(upgrade(), env, {});
    assert.equal(response.status, 502); const raw = await response.text(); assert.ok(!raw.includes(env.AZURE_SPEECH_KEY));
    assert.equal(JSON.parse(raw).error, 'realtime_upstream_unavailable'); assert.equal(response.headers.get('Ocp-Apim-Subscription-Key'), null);
  }
});

test('Azure can omit the protocol header after a successful upgrade while the proxy negotiates client USP', async () => {
  const provider = new Socket(), { worker } = load(async () => ({ status: 101, webSocket: provider, headers: new Headers() }));
  const response = await worker.fetch(upgrade(), env, {}); assert.equal(response.status, 101); assert.equal(provider.closed.length, 0);
  assert.equal(response.headers.get('Sec-WebSocket-Protocol'), 'USP'); assert.equal(provider.accepted, true);
});

test('safe handshake diagnostics expose status and protocol classification only, never header values or errors', async () => {
  for (const [status, selected, socket, expected] of [[401, null, false, 'absent'], [101, 'private-azure-key', true, 'other']]) {
    const provider = socket ? new Socket() : undefined;
    const headers = new Headers(); if (selected) headers.set('Sec-WebSocket-Protocol', selected);
    const { worker } = load(async () => ({ status, webSocket: provider, headers }));
    const response = await worker.fetch(upgrade(), env, {}), raw = await response.text(), body = JSON.parse(raw);
    assert.equal(response.status, 502); assert.equal(body.stage, 'upstream_handshake'); assert.equal(body.upstreamStatus, status); assert.equal(body.upstreamProtocol, expected); assert.equal(body.upstreamSocket, socket); assert.ok(!raw.includes(env.AZURE_SPEECH_KEY));
  }
  const { worker } = load(async () => { throw Error('private-azure-key'); }), response = await worker.fetch(upgrade(), env, {}), body = await response.json();
  assert.equal(body.stage, 'fetch'); assert.equal(body.upstreamStatus, null); assert.equal(body.upstreamProtocol, 'unknown'); assert.equal(body.upstreamSocket, false); assert.ok(!JSON.stringify(body).includes(env.AZURE_SPEECH_KEY));
});

test('Workers-supported manual redirects never follow an alternate destination with the Azure key', async () => {
  let calls = 0;
  const { worker } = load(async (address, options) => {
    calls++; assert.equal(options.redirect, 'manual'); assert.equal(new URL(address).hostname, 'koreacentral.stt.speech.microsoft.com');
    return { status: 302, headers: new Headers({ Location: 'https://untrusted.example.test/' }) };
  });
  const response = await worker.fetch(upgrade(), env, {}), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.stage, 'upstream_handshake'); assert.equal(body.upstreamStatus, 302); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(body).includes(env.AZURE_SPEECH_KEY));
});
