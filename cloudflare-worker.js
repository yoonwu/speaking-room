// ============================================================
//  스피킹 룸 — Cloudflare Worker 프록시 v6
//  GET  /version   → 배포 확인용 ("worker-v6" 반환)
//  GET  /u?n=닉네임 → 저장된 학습 데이터 불러오기 ★ v6 신규
//  POST /u?n=닉네임 → 학습 데이터 저장 (기기 간 연동)  ★ v6 신규
//  GET  /board     → 전체 사용자 랭킹 요약 목록      ★ v6 신규
//  GET  /tts       → Azure Neural TTS (원어민 음성, 캐시)
//  POST /          → Anthropic Claude
//  POST /stt       → Azure STT
//  POST /pronounce → Azure 발음 채점
//
//  ⚠️ 이 파일은 저장소 보관용 사본입니다. 실제 배포는 Cloudflare 대시보드
//     (Workers & Pages → speaking-room → Edit code)에 붙여넣고 Save & Deploy.
//     비밀키는 코드에 없고 워커 환경변수(env)에 있음: ANTHROPIC_API_KEY,
//     AZURE_SPEECH_KEY, AZURE_SPEECH_REGION(기본 koreacentral)
//
//  ★ v6 추가 준비물 — KV 저장소 바인딩 (대시보드에서 1회 설정)
//     Workers & Pages → speaking-room → Settings → Bindings → Add → KV namespace
//     Variable name: USERDATA   /   KV namespace: 새로 만들기(예: speaking-room-data)
//     (바인딩이 없으면 /u 는 503을 돌려주고, 앱은 기기 저장만으로 정상 동작합니다)
// ============================================================
const WORKER_VERSION = "worker-v6";

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

    // ── ⓪-B 랭킹 목록 (v6 신규) ─────────────────────────────
    //  GET /board → [{n:닉네임, name:표시이름, xp, lv, streak, week, blocks, lvl, t}]
    if (request.method === "GET" && path === "/board") {
      const jsonHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" };
      try {
        if (!env.USERDATA) {
          return new Response(JSON.stringify({ error: "KV binding USERDATA not configured" }), { status: 503, headers: jsonHeaders });
        }
        const listed = await env.USERDATA.list({ prefix: "b:", limit: 300 });
        const rows = await Promise.all(listed.keys.map(async (k) => {
          try { const v = await env.USERDATA.get(k.name); return v ? JSON.parse(v) : null; } catch (e) { return null; }
        }));
        return new Response(JSON.stringify(rows.filter(Boolean)), { status: 200, headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders });
      }
    }

    // ── ⓪ 학습 데이터 저장/불러오기 (v6 신규) ───────────────
    //  GET  /u?n=닉네임  → {t: 저장시각, d: {키:값}}  (없으면 t:0, d:null)
    //  POST /u?n=닉네임  → 본문 {t, d} 저장. 직전 버전은 :prev 로 1개 보관
    if (path === "/u" && (request.method === "GET" || request.method === "POST")) {
      const jsonHeaders = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" };
      try {
        // 닉네임 정규화: 소문자 + 공백제거 (대소문자/공백 달라도 같은 계정)
        const nick = (url.searchParams.get("n") || "").trim().toLowerCase().replace(/\s+/g, "");
        if (!nick || nick.length > 24) {
          return new Response(JSON.stringify({ error: "bad nickname" }), { status: 400, headers: jsonHeaders });
        }
        if (!env.USERDATA) {
          return new Response(JSON.stringify({ error: "KV binding USERDATA not configured" }), { status: 503, headers: jsonHeaders });
        }
        const key = "u:" + nick;

        if (request.method === "GET") {
          const saved = await env.USERDATA.get(key);
          if (!saved) return new Response(JSON.stringify({ t: 0, d: null }), { status: 200, headers: jsonHeaders });
          return new Response(saved, { status: 200, headers: jsonHeaders });
        }

        // POST — 저장
        const raw = await request.text();
        if (raw.length > 4_000_000) {
          return new Response(JSON.stringify({ error: "too large" }), { status: 413, headers: jsonHeaders });
        }
        let body = null;
        try { body = JSON.parse(raw); } catch (e) {
          return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: jsonHeaders });
        }
        if (!body || typeof body !== "object" || !body.d || typeof body.d !== "object") {
          return new Response(JSON.stringify({ error: "bad payload" }), { status: 400, headers: jsonHeaders });
        }
        const t = Number(body.t) || Date.now();
        const store = JSON.stringify({ t, d: body.d });
        // 직전 버전 1개 백업 (실수로 덮어써도 복구 가능)
        try {
          const prev = await env.USERDATA.get(key);
          if (prev) ctx.waitUntil(env.USERDATA.put(key + ":prev", prev));
        } catch (e) {}
        await env.USERDATA.put(key, store);
        // 랭킹용 요약은 따로 작은 키로 (전체 데이터를 읽지 않고 순위표를 만들기 위해)
        if (body.sum && typeof body.sum === "object") {
          const sum = body.sum;
          const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0; };
          // 분야별 훈련 시간(분) — 알려진 분야만, 숫자로 정리
          const cats = {};
          if (sum.cats && typeof sum.cats === "object") {
            ["block", "drill", "listen", "vocab", "speak", "talk", "phonics"].forEach((c) => {
              const v = num(sum.cats[c]); if (v > 0) cats[c] = v;
            });
          }
          const row = {
            n: nick,
            name: String(sum.name || nick).slice(0, 12),
            xp: num(sum.xp), lv: num(sum.lv), streak: num(sum.streak),
            week: num(sum.week), blocks: num(sum.blocks), lvl: num(sum.lvl),
            mins: num(sum.mins), allMins: num(sum.allMins), cats, t,
          };
          // ⚠️ waitUntil 로 미루면 랭킹 화면이 '저장 직후' 부르는 /board 가 예전 요약을 읽는다.
          //    (본인 행만 옛날 값으로 보이던 원인) — 응답 전에 반드시 저장을 끝낸다.
          try { await env.USERDATA.put("b:" + nick, JSON.stringify(row)); } catch (e) {}
        }
        return new Response(JSON.stringify({ ok: true, t }), { status: 200, headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: jsonHeaders });
      }
    }

    // ── ① Azure Neural TTS ────────────────────────────────
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

    // ── ② Anthropic Claude ────────────────────────────────
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

    // ── ③ Azure STT ───────────────────────────────────────
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

    // ── ④ Azure 발음 채점 ──────────────────────────────────
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
