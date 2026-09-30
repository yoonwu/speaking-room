package com.speakingroom.voice;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import android.speech.*;
import android.speech.tts.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

public final class VoiceService extends Service implements RecognitionListener {
    static final String STOP = "stop", REPEAT = "repeat";
    static volatile String status = "대기 중";
    static volatile boolean running;
    static volatile java.util.function.Consumer<String> observer;
    private static final java.util.ArrayDeque<JSONObject> events = new java.util.ArrayDeque<>();
    private static long eventId;
    static synchronized JSONArray eventsSnapshot() { JSONArray result = new JSONArray(); for (JSONObject e : events) result.put(e); return result; }
    static synchronized void ackEvents(JSONArray received) { long last = received.optJSONObject(received.length()-1).optLong("id"); while (!events.isEmpty() && events.peek().optLong("id") <= last) events.remove(); }
    private void event(JSONObject value) { synchronized (VoiceService.class) { try { value.put("id", ++eventId); events.add(value); } catch(JSONException ignored) {} while(events.size()>100) events.remove(); } java.util.function.Consumer<String> view=observer; if(view!=null)view.accept(status); }
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private PowerManager.WakeLock wake;
    private PlanClient client;
    private String model, topic, lastReply;
    private boolean active, speaking, listening, ttsReady;
    private int generation, turns, silenceRetries;
    private JSONArray history = new JSONArray();
    private JSONArray reviewQuestions = new JSONArray();
    private boolean review;
    private String utterance;
    private int utteranceNumber;
    private String webInstructions;
    private boolean integrated;
    private final Runnable timeout = () -> finish("연습 시간이 끝났습니다.");

    @Override public void onCreate() {
        super.onCreate();
        client = PlanClient.get(this);
        audio = (AudioManager)getSystemService(AUDIO_SERVICE);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("voice", "영어 음성 연습", NotificationManager.IMPORTANCE_LOW));
        wake = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "speakingroom:lesson");
        tts = new TextToSpeech(this, result -> main.post(() -> {
            if (result != TextToSpeech.SUCCESS) { finish("음성 읽기를 사용할 수 없습니다. 영어 TTS를 설치해주세요."); return; }
            int language = tts.setLanguage(Locale.US);
            if (language < TextToSpeech.LANG_AVAILABLE) { finish("영어 음성 데이터가 없습니다. Android 음성 설정에서 설치해주세요."); return; }
            tts.setSpeechRate(0.88f);
            tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            ttsReady = true;
            if (active && lastReply != null) speak(lastReply);
        }));
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { main.post(() -> { if (!active || !id.equals(utterance)) return; speaking = false; if (turns >= 6) finish("대화 완료. 지난 대화 반복으로 다시 연습할 수 있어요."); else main.postDelayed(() -> listen(), 450); }); }
            @Override public void onError(String id) { main.post(() -> finish("음성 재생 오류로 연습을 멈췄습니다.")); }
        });
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) { finish("연습을 멈췄습니다."); return START_NOT_STICKY; }
        if (REPEAT.equals(intent.getAction())) { if (active && lastReply != null) { if (recognizer != null) recognizer.cancel(); listening = false; speak(lastReply); } return START_NOT_STICKY; }
        if (active) return START_NOT_STICKY;
        try {
            Notification notification = notification("연습 준비 중");
            if (Build.VERSION.SDK_INT >= 30) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(1, notification);
            review = intent.getBooleanExtra("review", false);
            if (!review && !client.connected()) { finish("먼저 ChatGPT를 연결해주세요."); return START_NOT_STICKY; }
            if (!SpeechRecognizer.isRecognitionAvailable(this)) { finish("음성 인식 서비스가 없습니다. Google 음성 인식을 설치해주세요."); return START_NOT_STICKY; }
            model = intent.getStringExtra("model"); topic = intent.getStringExtra("topic");
            webInstructions = intent.getStringExtra("webInstructions"); integrated = !review && webInstructions != null;
            if (!review && (model == null || topic == null)) { finish("모델과 주제를 선택해주세요."); return START_NOT_STICKY; }
            if (review) { reviewQuestions = new JSONArray(getSharedPreferences("practice", MODE_PRIVATE).getString("questions", "[]")); if (reviewQuestions.length() == 0) { finish("반복할 대화가 없습니다."); return START_NOT_STICKY; } }
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener(change -> { if (change < 0) finish("통화 또는 다른 오디오가 시작되어 연습을 멈췄습니다."); }, main).build();
            if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { finish("오디오를 사용할 수 없습니다."); return START_NOT_STICKY; }
            active = true; running = true; generation++; turns = 0; history = new JSONArray();
            if (integrated) history = new JSONArray(intent.getStringExtra("webHistory"));
            wake.acquire(6 * 60 * 1000L); main.postDelayed(timeout, 5 * 60 * 1000L);
            recognizer = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
                ? SpeechRecognizer.createOnDeviceSpeechRecognizer(this) : SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(this);
            if (review) speak(reviewQuestions.getString(0));
            else if (integrated) { JSONObject last = history.getJSONObject(history.length()-1); if(!"assistant".equals(last.optString("role"))) { finish("상대의 답변이 나온 뒤 음성을 시작해주세요."); return START_NOT_STICKY; } speak(last.getString("content")); }
            else next("Start the conversation with one simple question about " + topic + ".");
        } catch (Exception e) { finish("음성 시작 실패. 마이크 권한과 음성 설정을 확인해주세요."); }
        return START_NOT_STICKY;
    }
    private void next(String answer) {
        int run = generation;
        listening = false; update("생각 중…");
        try { history.put(new JSONObject().put("role", "user").put("content", answer)); } catch (JSONException e) { finish("대화 저장 실패"); return; }
        JSONArray input;
        try { input = new JSONArray(history.toString()); } catch (JSONException e) { finish("대화 저장 실패"); return; }
        io.execute(() -> {
            try {
                String instructions = integrated ? webInstructions + "\n[VOICE] Continue this same scenario. The learner is speaking. Keep the spoken part concise, at most 35 words, and ask only one question. Preserve required USED and TURN_EVAL metadata tags. After 6 learner turns wrap up without another question. Never ask the learner to operate a phone." : Lesson.instructions(topic);
                String reply = client.respond(model, instructions, input);
                main.post(() -> {
                    if (!active || generation != run) return;
                    try { history.put(new JSONObject().put("role", "assistant").put("content", reply)); } catch (JSONException e) { finish("대화 저장 실패"); return; }
                    saveReview();
                    if(integrated) try { event(new JSONObject().put("kind","assistant").put("raw",reply).put("user",answer).put("help",answer.startsWith("Please give me one short example"))); } catch(JSONException ignored) {}
                    lastReply = reply; speak(reply);
                });
            } catch (Exception e) { main.post(() -> { if (active && generation == run) finish(PlanClient.safeMessage(e)); }); }
        });
    }
    private void speak(String text) {
        if (!active) return;
        text = SpeechText.clean(text);
        lastReply = text; speaking = true; update("상대: " + text);
        utterance = "reply-" + generation + "-" + (++utteranceNumber);
        if (ttsReady && tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utterance) == TextToSpeech.ERROR) finish("음성 재생 실패");
    }
    private void listen() {
        if (!active || speaking || listening) return;
        Intent input = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        input.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        input.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
        input.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        input.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        input.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        listening = true; update("듣는 중 · 영어로 답하세요. Stop / Repeat / Help");
        try { recognizer.startListening(input); } catch (Exception e) { finish("음성 인식을 시작할 수 없습니다."); }
    }
    @Override public void onResults(Bundle result) {
        listening = false; if (!active) return;
        ArrayList<String> answers = result.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (answers == null || answers.isEmpty()) { onError(SpeechRecognizer.ERROR_NO_MATCH); return; }
        String answer = answers.get(0); silenceRetries = 0;
        String command = Lesson.command(answer);
        if (command.equals("stop")) { finish("연습을 멈췄습니다."); return; }
        if (command.equals("repeat")) { speak(lastReply); return; }
        if (review) {
            if (command.equals("help")) { speak("Try a short answer about yourself. " + lastReply); return; }
            turns++;
            if (turns >= reviewQuestions.length()) { finish("반복 완료. 답변은 자동 채점하지 않았습니다."); return; }
            try { speak(reviewQuestions.getString(turns)); } catch (JSONException e) { finish("복습 데이터를 읽지 못했습니다."); }
            return;
        }
        if (command.equals("help")) { next("Please give me one short example answer to your last question that I can repeat."); return; }
        turns++;
        if(integrated) try { event(new JSONObject().put("kind","user").put("text",answer)); } catch(JSONException ignored) {}
        update("나: " + answer); next(answer);
    }
    private void saveReview() {
        try {
            JSONArray questions = new JSONArray();
            for (int i = 0; i + 1 < history.length(); i++) {
                JSONObject line = history.getJSONObject(i), after = history.getJSONObject(i + 1);
                if ("assistant".equals(line.optString("role")) && "user".equals(after.optString("role")) && !after.optString("content").startsWith("Please give me one short example")) questions.put(SpeechText.clean(line.getString("content")));
            }
            if (questions.length() > 0) getSharedPreferences("practice", MODE_PRIVATE).edit().putString("questions", questions.toString()).apply();
        } catch (JSONException ignored) {}
    }
    @Override public void onError(int error) {
        listening = false; if (!active) return;
        if ((error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) && silenceRetries++ < 2) { main.postDelayed(this::listen, 1200); return; }
        finish("음성 인식이 멈췄습니다 (" + error + "). 정차 후 마이크·영어 음성 데이터를 확인해주세요.");
    }
    private Notification notification(String message) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, VoiceService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, "voice").setSmallIcon(com.speakingroom.voice.R.drawable.ic_voice).setContentTitle("3초영어 음성 연습")
            .setContentText(message).setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null, "멈추기", stop).build()).build();
    }
    private void update(String message) {
        status = message;
        try { event(new JSONObject().put("kind","status").put("text",message).put("running",active)); } catch(JSONException ignored) {}
        if (active) getSystemService(NotificationManager.class).notify(1, notification(message));
    }
    private void finish(String message) {
        active = false; running = false; generation++; main.removeCallbacksAndMessages(null);
        if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        if (tts != null) tts.stop();
        if (wake != null && wake.isHeld()) wake.release();
        if (focus != null) audio.abandonAudioFocusRequest(focus);
        update(message); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    @Override public void onDestroy() { active = false; running = false; generation++; main.removeCallbacksAndMessages(null); if (recognizer != null) recognizer.destroy(); if (tts != null) tts.shutdown(); if (wake != null && wake.isHeld()) wake.release(); if (focus != null) audio.abandonAudioFocusRequest(focus); io.shutdownNow(); if (status.startsWith("상대:") || status.startsWith("듣는 중") || status.startsWith("생각 중")) update("연습을 멈췄습니다."); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onReadyForSpeech(Bundle p) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rms) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onPartialResults(Bundle p) {}
    @Override public void onEvent(int type, Bundle p) {}
}
