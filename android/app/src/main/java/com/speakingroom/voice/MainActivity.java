package com.speakingroom.voice;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import androidx.webkit.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Existing 3초영어 is the UI. Native code supplies OAuth and background voice only. */
public final class MainActivity extends Activity {
    private WebView web;
    private PlanClient plan;
    private volatile WebUpdater updater;
    private long pausedAt;
    private boolean loadingPage=true, checkingUpdate;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PermissionRequest microphoneRequest;
    static final String ORIGIN = "https://appassets.androidplatform.net";
    // Only packaged or verified owner releases run, under the same restricted origin.
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); plan = PlanClient.get(this);
        web = new WebView(this);
        updater = new WebUpdater(this, 5);
        android.widget.TextView loading=new android.widget.TextView(this);
        loading.setText("3초영어\n최신 학습 화면을 확인하고 있어요…"); loading.setGravity(android.view.Gravity.CENTER); loading.setTextSize(19); setContentView(loading);
        web.setOnApplyWindowInsetsListener((v, insets) -> { if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets b = insets.getInsets(android.view.WindowInsets.Type.systemBars()); v.setPadding(b.left, b.top, b.right, b.bottom); } return insets; });
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE); // Snapshot files are already cached and verified by WebUpdater.
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                Uri requested=request.getUrl();
                WebResourceResponse response = trusted(requested) ? updater.handle(requested.getPath().substring("/assets/".length())) : null;
                if(response==null) response = loader.shouldInterceptRequest(requested);
                if (response != null) {
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; img-src 'self' data: https:; font-src 'self' data: https:; media-src 'self' blob: data: https:; frame-src 'none'; object-src 'none'");
                    headers.put("Cache-Control", "no-store");
                    response.setResponseHeaders(headers);
                }
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (trusted(u) && request.isForMainFrame()) return false;
                if (request.isForMainFrame() && "https".equals(u.getScheme())) try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) { drainVoice(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!ORIGIN.equals(request.getOrigin().toString().replaceAll("/$", "")) || !trusted(Uri.parse(web.getUrl())) || VoiceService.running || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else { if(microphoneRequest!=null) microphoneRequest.deny(); microphoneRequest=request; requestMicrophonePermission(21); }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if(microphoneRequest==request) microphoneRequest=null; }
            @Override public boolean onJsAlert(WebView v, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("확인", (d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show(); return true;
            }
            @Override public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("확인", (d,w)->result.confirm()).setNegativeButton("취소", (d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show(); return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        WebViewCompat.addWebMessageListener(web, "SpeakingRoomNative", Collections.singleton(ORIGIN), (view, message, origin, mainFrame, reply) -> {
            if (!mainFrame || !ORIGIN.equals(origin.toString()) || !trusted(Uri.parse(view.getUrl()))) return;
            String id = "";
            try {
                String raw = message.getData(); if (raw == null || raw.length() > 8000000) throw new IOException("요청이 너무 큽니다.");
                JSONObject m = new JSONObject(raw); id = m.getString("id"); final String requestId = id;
                String action = m.getString("action"); JSONObject data = m.optJSONObject("data"); if (data == null) data = new JSONObject();
                final JSONObject args = data;
                switch (action) {
                    case "status": reply(reply, id, new JSONObject().put("connected", plan.connected()).put("ready", ready()).put("account", plan.label()).put("running", VoiceService.running).put("webRevision",updater.revision()).put("updateStatus",updater.status()), null); break;
                    case "webupdate":
                        if(VoiceService.running) throw new IOException("음성 대화를 멈춘 뒤 업데이트해주세요.");
                        reply(reply,id,new JSONObject(),null); checkWebUpdate(true); break;
                    case "settings": startActivity(new Intent(this, PlanSettingsActivity.class)); reply(reply, id, new JSONObject(), null); break;
                    case "infer":
                        if (VoiceService.running) throw new IOException("음성 대화를 멈춘 뒤 다른 AI 학습을 시작해주세요.");
                        if (!ready()) throw new IOException("구독 설정에서 모델 선택과 연결 테스트를 완료해주세요.");
                        io.execute(() -> { try {
                            JSONArray messages = args.getJSONArray("messages"); if (messages.length() > 100) throw new IOException("대화가 너무 깁니다.");
                            String text = plan.respond(model(), args.getString("instructions"), messages);
                            runOnUiThread(() -> { try { reply(reply, requestId, new JSONObject().put("text", text), null); } catch (Exception ignored) {} });
                        } catch (Exception e) { runOnUiThread(() -> reply(reply, requestId, null, PlanClient.safeMessage(e))); } }); break;
                    case "voice":
                        if (!ready()) throw new IOException("먼저 구독 연결 테스트를 완료해주세요.");
                        startVoice(args); reply(reply, id, new JSONObject(), null); break;
                    case "stop": stopService(new Intent(this, VoiceService.class)); reply(reply, id, new JSONObject(), null); break;
                    default: throw new IOException("지원하지 않는 요청입니다.");
                }
            } catch (Exception e) { reply(reply, id, null, PlanClient.safeMessage(e)); }
        });
        } else { new AlertDialog.Builder(this).setMessage("Android System WebView 또는 Chrome을 업데이트해주세요.").setPositiveButton("확인", (d,w)->finish()).show(); return; }
        VoiceService.observer = ignored -> runOnUiThread(this::drainVoice);
        if(Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::leaveScenario);
        io.execute(()->{ updater.refresh(); updater.pruneBeforeLoad(); runOnUiThread(()->{ if(isDestroyed())return; loadingPage=false; setContentView(web); web.loadUrl(ORIGIN+"/assets/index.html"); }); });
    }
    static boolean trusted(Uri u) { return u != null && "https".equals(u.getScheme()) && "appassets.androidplatform.net".equals(u.getHost()) && u.getPort()==-1 && u.getUserInfo()==null && u.getPath() != null && u.getPath().startsWith("/assets/"); }
    private String model() { return getSharedPreferences("native", MODE_PRIVATE).getString("model", ""); }
    private boolean ready() { return plan.connected() && !model().isEmpty() && plan.label().equals(getSharedPreferences("native", MODE_PRIVATE).getString("account", "")); }
    private void requestMicrophonePermission(int code) {
        boolean asked=getSharedPreferences("native",MODE_PRIVATE).getBoolean("micAsked",false);
        if(asked && !shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)) {
            if(microphoneRequest!=null){microphoneRequest.deny();microphoneRequest=null;}
            new AlertDialog.Builder(this).setTitle("마이크 권한이 필요해요")
                .setMessage("앱 설정의 권한 → 마이크에서 '앱 사용 중에만 허용'을 선택해주세요. 직접 입력으로도 연습할 수 있어요.")
                .setPositiveButton("앱 설정 열기",(d,w)->startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))))
                .setNegativeButton("나중에",null).show();return;
        }
        getSharedPreferences("native",MODE_PRIVATE).edit().putBoolean("micAsked",true).apply();
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},code);
    }
    private void startVoice(JSONObject args) throws Exception {
        if (VoiceService.running) throw new IOException("이미 음성 연습 중입니다.");
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestMicrophonePermission(20);
            throw new IOException("마이크 권한을 허용한 뒤 음성 시작을 다시 눌러주세요.");
        }
        Intent intent = new Intent(this, VoiceService.class).putExtra("model", model()).putExtra("topic", "current 3초영어 scenario");
        JSONArray history = args.getJSONArray("history"); if (history.length() == 0 || history.length() > 100) throw new IOException("먼저 기존 회화에서 상황을 선택하고 대화를 시작해주세요."); intent.putExtra("webHistory", history.toString()).putExtra("webInstructions", args.getString("instructions"));
        startForegroundService(intent);
    }
    private void reply(JavaScriptReplyProxy proxy, String id, JSONObject result, String error) {
        if (isDestroyed() || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try { JSONObject m = new JSONObject().put("id", id).put("ok", error == null); if (error != null) m.put("error", error); else m.put("result", result); proxy.postMessage(m.toString()); } catch (Exception ignored) {}
    }
    private void drainVoice() {
        if (web == null || !trusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
        JSONArray events = VoiceService.eventsSnapshot();
        if (events.length() == 0) return;
        web.evaluateJavascript("window.srNativeEvents?window.srNativeEvents(" + JSONObject.quote(events.toString()) + "):false", ack -> { if ("true".equals(ack)) VoiceService.ackEvents(events); });
    }
    private void checkWebUpdate(boolean explicit) {
        if(loadingPage || checkingUpdate || VoiceService.running) return;
        checkingUpdate=true;
        io.execute(()->{ WebUpdater next=new WebUpdater(this,5); next.refresh(); runOnUiThread(()->{
            checkingUpdate=false; if(isDestroyed() || VoiceService.running) return;
            if(!explicit && next.revision().equals(updater.revision())) return;
            // Re-check AFTER download: a lesson may have started while checking.
            web.evaluateJavascript("typeof state!=='undefined'&&!state.busy&&typeof curScreen!=='undefined'&&curScreen==='setup'&&typeof setup!=='undefined'&&setup.style.display!=='none'&&!document.getElementById('practiceSheet')&&!(typeof _modalOpen==='function'&&_modalOpen())&&!(typeof _topOverlay==='function'&&_topOverlay())", safe->{
                if(!"true".equals(safe)) { android.widget.Toast.makeText(this,"학습 화면 업데이트는 홈으로 돌아온 뒤 적용됩니다.",android.widget.Toast.LENGTH_SHORT).show(); return; }
                updater=next; web.clearCache(true); web.loadUrl(ORIGIN+"/assets/index.html");
            });
        }); });
    }
    @Override protected void onPause() { pausedAt=SystemClock.elapsedRealtime(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) { web.onResume(); VoiceService.observer = ignored -> runOnUiThread(this::drainVoice); web.evaluateJavascript("window.srNativeRefresh&&window.srNativeRefresh()", null); drainVoice(); if(pausedAt>0 && SystemClock.elapsedRealtime()-pausedAt>60000) checkWebUpdate(false); pausedAt=0; } }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if(request==21 && microphoneRequest!=null) { PermissionRequest pending=microphoneRequest; microphoneRequest=null; if(grants.length>0 && grants[0]==PackageManager.PERMISSION_GRANTED && trusted(Uri.parse(web.getUrl()))) pending.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); else pending.deny(); }
    }
    private void leaveScenario() { web.evaluateJavascript("if(typeof goToSetup==='function')goToSetup()", null); stopService(new Intent(this,VoiceService.class)); }
    @Override public void onBackPressed() { leaveScenario(); }
    @Override protected void onDestroy() { VoiceService.observer = null; stopService(new Intent(this,VoiceService.class)); if (web != null) web.destroy(); io.shutdownNow(); super.onDestroy(); }
}
