package com.speakingroom.voice;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** The offline route has its own storage and exposes only local practice operations. */
public final class OfflinePracticeActivity extends Activity {
    private static final String HOST = "offline.appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String START_PAGE = ORIGIN + "/assets/index.html";
    private static final int MIC_PERMISSION = 1;
    private static final String SPEECH_UNAVAILABLE = "기기에서 영어 음성 인식을 사용할 수 없어요. 직접 입력으로 연습해주세요.";
    private static final Map<String, String> ASSET_HEADERS = assetHeaders();
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextToSpeech reader;
    private boolean readerReady;
    private LocalRecognition recognition;

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (!BuildConfig.OFFLINE_REVIEW && (!LearningAge.isSet(this) || LearningAge.allowsOnlineFeatures(this))) {
            finish();
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            new android.app.AlertDialog.Builder(this).setMessage("Android System WebView를 업데이트해주세요.")
                .setPositiveButton("확인", (dialog, button) -> finish()).setOnCancelListener(dialog -> finish()).show();
            return;
        }
        reader = new TextToSpeech(this, result -> main.post(() -> readerReady = setupLocalVoice(result)));
        web = new WebView(this);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setGeolocationEnabled(false);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                WebResourceResponse response = isPackagedAsset(uri) ? loader.shouldInterceptRequest(uri) : null;
                if (response == null || response.getData() == null) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        ASSET_HEADERS, new ByteArrayInputStream(new byte[0]));
                }
                response.setResponseHeaders(ASSET_HEADERS);
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !request.isForMainFrame() || !isPackagedAsset(uri)
                    || !("/assets/index.html".equals(uri.getPath()) || "/assets/privacy.html".equals(uri.getPath()));
            }
        });
        WebViewCompat.addWebMessageListener(web, "SpeakingRoomNative", Collections.singleton(ORIGIN), this::handleMessage);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher()
            .registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        setContentView(web);
        web.loadUrl(START_PAGE);
    }

    private static Map<String, String> assetHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'");
        headers.put("Cache-Control", "no-store");
        return Collections.unmodifiableMap(headers);
    }

    private static boolean isPackagedAsset(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null && uri.getPath() != null
            && uri.getPath().matches("/assets/[A-Za-z0-9._-]+");
    }

    private void handleMessage(WebView view, androidx.webkit.WebMessageCompat message, Uri origin,
                               boolean mainFrame, JavaScriptReplyProxy proxy) {
        if (!mainFrame || !ORIGIN.equals(origin.toString()) || !START_PAGE.equals(view.getUrl())) return;
        String id = "";
        try {
            String raw = message.getData();
            if (raw == null || raw.length() > 4096) return;
            JSONObject request = new JSONObject(raw);
            id = request.getString("id");
            switch (request.getString("action")) {
                case "status" -> reply(proxy, id, new JSONObject().put("practiceSpeech", onDeviceSpeechAvailable()), null);
                case "recognizeOffline" -> {
                    if (recognition != null) throw new IllegalStateException("마이크를 이미 사용 중이에요.");
                    if (!onDeviceSpeechAvailable()) throw new IllegalStateException(SPEECH_UNAVAILABLE);
                    recognition = new LocalRecognition(proxy, id);
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        recognition.start();
                    } else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION);
                }
                case "recognizeStop" -> {
                    if (recognition != null && recognition.engine != null) recognition.engine.stopListening();
                    reply(proxy, id, new JSONObject(), null);
                }
                case "recognizeCancel" -> {
                    cancelRecognition();
                    reply(proxy, id, new JSONObject(), null);
                }
                case "readOffline" -> {
                    JSONObject data = request.getJSONObject("data");
                    String text = data.getString("text").trim();
                    if (readerReady && !text.isEmpty() && text.length() <= 500 && recognition == null) {
                        reader.setSpeechRate((float)Math.max(0.4, Math.min(1.4, data.optDouble("rate", 1))));
                        reader.speak(text, TextToSpeech.QUEUE_FLUSH, null, "practice-example");
                    }
                    reply(proxy, id, new JSONObject().put("available", readerReady), null);
                }
                case "stopReadingOffline" -> {
                    if (readerReady) reader.stop();
                    reply(proxy, id, new JSONObject(), null);
                }
                default -> reply(proxy, id, null, "기기 내 연습에서는 사용할 수 없어요.");
            }
        } catch (Exception ignored) {
            reply(proxy, id, null, "기기 내 연습을 준비하지 못했어요. 직접 입력으로 계속할 수 있어요.");
        }
    }

    private boolean setupLocalVoice(int result) {
        if (isDestroyed() || reader == null || result != TextToSpeech.SUCCESS) return false;
        Set<Voice> voices = reader.getVoices();
        if (voices == null) return false;
        return voices.stream().filter(voice -> !voice.isNetworkConnectionRequired()
                && Locale.ENGLISH.getLanguage().equals(voice.getLocale().getLanguage())
                && !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))
            .sorted(java.util.Comparator.comparing(voice -> !Locale.US.equals(voice.getLocale())))
            .findFirst().map(voice -> reader.setVoice(voice) == TextToSpeech.SUCCESS).orElse(false);
    }

    private boolean onDeviceSpeechAvailable() {
        return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this);
    }

    private final class LocalRecognition implements RecognitionListener {
        final JavaScriptReplyProxy proxy;
        final String id;
        final Runnable timeout = () -> finish(null, SPEECH_UNAVAILABLE);
        SpeechRecognizer engine;
        long readyAt = -1, speechAt = -1;

        LocalRecognition(JavaScriptReplyProxy proxy, String id) {
            this.proxy = proxy;
            this.id = id;
        }

        void start() {
            if (Build.VERSION.SDK_INT < 31 || !onDeviceSpeechAvailable()) { finish(null, SPEECH_UNAVAILABLE); return; }
            try {
                if (readerReady) reader.stop();
                engine = SpeechRecognizer.createOnDeviceSpeechRecognizer(OfflinePracticeActivity.this);
                engine.setRecognitionListener(this);
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                main.postDelayed(timeout, 15000);
                engine.startListening(intent);
            } catch (RuntimeException ignored) { finish(null, SPEECH_UNAVAILABLE); }
        }

        @Override public void onReadyForSpeech(Bundle params) {
            if (recognition != this || readyAt >= 0) return;
            readyAt = SystemClock.elapsedRealtime();
            web.evaluateJavascript("window.srPracticeStarted?.(" + JSONObject.quote(id) + ")", null);
        }

        @Override public void onBeginningOfSpeech() {
            if (speechAt < 0) speechAt = SystemClock.elapsedRealtime();
        }

        @Override public void onEndOfSpeech() {
            if (recognition != this) return;
            main.removeCallbacks(timeout);
            main.postDelayed(timeout, 4000);
            web.evaluateJavascript("window.srPracticeCaptured?.(" + JSONObject.quote(id) + ")", null);
        }

        @Override public void onResults(Bundle results) {
            ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            try {
                JSONObject value = new JSONObject().put("text", matches == null || matches.isEmpty() ? "" : matches.get(0));
                if (readyAt >= 0 && speechAt >= readyAt) {
                    value.put("speechStartOffsetMs", speechAt - readyAt)
                        .put("captureDurationMs", SystemClock.elapsedRealtime() - readyAt);
                }
                finish(value, null);
            } catch (org.json.JSONException ignored) { finish(null, SPEECH_UNAVAILABLE); }
        }

        @Override public void onError(int error) {
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                finish(null, "잘 들리지 않았어요. 다시 말하거나 직접 입력해주세요.");
            } else {
                finish(null, SPEECH_UNAVAILABLE);
            }
        }

        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onPartialResults(Bundle results) {}
        @Override public void onEvent(int event, Bundle params) {}

        void finish(JSONObject value, String error) {
            if (recognition != this) return;
            recognition = null;
            main.removeCallbacks(timeout);
            if (engine != null) engine.destroy();
            reply(proxy, id, value, error);
        }
    }

    private void cancelRecognition() {
        if (recognition != null) recognition.finish(null, "음성 입력을 취소했어요.");
    }

    private void reply(JavaScriptReplyProxy proxy, String id, JSONObject result, String error) {
        if (isDestroyed()) return;
        try {
            JSONObject message = new JSONObject().put("id", id).put("ok", error == null);
            if (error == null) message.put("result", result);
            else message.put("error", error);
            proxy.postMessage(message.toString());
        } catch (Exception ignored) {}
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != MIC_PERMISSION || recognition == null) return;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) recognition.start();
        else recognition.finish(null, "마이크 사용을 허용하거나 직접 입력으로 연습해주세요.");
    }

    private void goBack() {
        if (!START_PAGE.equals(web.getUrl()) && web.canGoBack()) { web.goBack(); return; }
        web.evaluateJavascript("if(typeof goToSetup==='function')goToSetup()", null);
    }

    @Override public void onBackPressed() { if (web == null) super.onBackPressed(); else goBack(); }
    @Override protected void onStop() {
        if (recognition != null && recognition.engine != null) cancelRecognition();
        if (readerReady) reader.stop();
        super.onStop();
    }
    @Override protected void onDestroy() {
        cancelRecognition();
        main.removeCallbacksAndMessages(null);
        if (reader != null) reader.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
