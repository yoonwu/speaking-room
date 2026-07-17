// ============================================================
//  스피킹 룸 — Cloudflare Worker 프록시 v5
//  GET  /version   → 배포 확인용 ("worker-v5" 반환)
//  GET  /tts       → Azure Neural TTS (원어민 음성, 캐시) ★ v5 신규
//  POST /          → Anthropic Claude
//  POST /stt       → Azure STT
//  POST /pronounce → Azure 발음 채점
//
//  ⚠️ 이 파일은 저장소 보관용 사본입니다. 실제 배포는 Cloudflare 대시보드
//     (Workers & Pages → speaking-room → Edit code)에 붙여넣고 Save & Deploy.
//     비밀키는 코드에 없고 워커 환경변수(env)에 있음: ANTHROPIC_API_KEY,
//     AZURE_SPEECH_KEY, AZURE_SPEECH_REGION(기본 koreacentral)
// ============================================================
const WORKER_VERSION = "worker-v5";

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Pronunciation-Text, X-Pronunciation-Text-B64",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    // 배포 확인용
    if (request.method === "GET" && path === "/version") {
      return new Response(WORKER_VERSION, { headers: { ...cors, "Content-Type": "text/plain" } });
    }

    // ── ⓪ Azure Neural TTS (v5 신규) ──────────────────────
    //  GET /tts?text=...&voice=en-US-JennyNeural&rate=0.95
    //  같은 문장은 Cloudflare 캐시에서 즉시 반환 (Azure 호출은 문장당 1회)
    if (request.method === "GET" && path === "/tts") {
      try {
        const text = (url.searchParams.get("text") || "").slice(0, 300).trim();
        if (!text) return new Response("no text", { status: 400, headers: cors });
        let voice = url.searchParams.get("voice") || "en-US-JennyNeural";
        if (!/^[A-Za-z]{2}-[A-Za-z]{2}-[A-Za-z0-9]+Neural$/.test(voice)) voice = "en-US-JennyNeural";
        let rate = parseFloat(url.searchParams.get("rate") || "1");
        if (!(rate >= 0.4 && rate <= 1.4)) rate = 1;

        // 캐시 키 정규화 (파라미터 순서 고정)
        const cacheKey = new Request(url.origin + "/tts?v=" + encodeURIComponent(voice) + "&r=" + rate.toFixed(2) + "&t=" + encodeURIComponent(text), { method: "GET" });
        const cache = caches.default;
        const hit = await cache.match(cacheKey);
        if (hit) {
          const h = new Headers(hit.headers);
          Object.entries(cors).forEach(([k, v]) => h.set(k, v));
          return new Response(hit.body, { status: 200, headers: h });
        }

        const region = env.AZURE_SPEECH_REGION || "koreacentral";
        const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const ratePct = Math.round((rate - 1) * 100);
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voice}"><prosody rate="${ratePct >= 0 ? "+" : ""}${ratePct}%">${esc(text)}</prosody></voice></speak>`;

        const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "speaking-room",
          },
          body: ssml,
        });
        if (!r.ok) {
          return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "text/plain" } });
        }
        const audio = await r.arrayBuffer();
        const resp = new Response(audio, { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000" } });
        // 캐시에 저장 (응답 복제)
        try { ctx.waitUntil(cache.put(cacheKey, resp.clone())); } catch (e) {}
        return resp;
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

    // ── ① Anthropic Claude ────────────────────────────────
    if (path === "/" || path === "/anthropic") {
      try {
        const body = await request.text();
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body,
        });
        return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // ── ② Azure STT ───────────────────────────────────────
    if (path === "/stt") {
      try {
        const audio = await request.arrayBuffer();
        const region = env.AZURE_SPEECH_REGION || "koreacentral";
        const contentType = request.headers.get("Content-Type") || "audio/wav";
        const r = await fetch(
          `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=simple`,
          { method: "POST", headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY, "Content-Type": contentType, "Accept": "application/json" }, body: audio }
        );
        // raw 그대로 전달 (json 파싱 실패로 인한 500 방지)
        return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // ── ③ Azure 발음 채점 ──────────────────────────────────
    if (path === "/pronounce") {
      try {
        let refText = "";
        const b64 = request.headers.get("X-Pronunciation-Text-B64");
        if (b64) { try { refText = decodeURIComponent(escape(atob(b64))); } catch(e){ refText=""; } }
        else { refText = request.headers.get("X-Pronunciation-Text") || ""; }
        const audio = await request.arrayBuffer();
        const region = env.AZURE_SPEECH_REGION || "koreacentral";
        const contentType = request.headers.get("Content-Type") || "audio/wav";
        // UTF-8 안전 base64
        const b64utf8 = (str)=>{ const bytes=new TextEncoder().encode(str); let bin=""; for(const b of bytes) bin+=String.fromCharCode(b); return btoa(bin); };
        const assessConfig = b64utf8(JSON.stringify({
          ReferenceText: refText,
          GradingSystem: "HundredMark",
          Granularity: "Phoneme",
          Dimension: "Comprehensive",
          EnableMiscue: true
        }));
        const r = await fetch(
          `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`,
          { method: "POST", headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY, "Content-Type": contentType, "Accept": "application/json", "Pronunciation-Assessment": assessConfig }, body: audio }
        );
        return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    return new Response("Not Found", { status: 404, headers: cors });
  },
};
