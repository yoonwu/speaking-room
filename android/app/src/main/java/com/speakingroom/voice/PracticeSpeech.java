package com.speakingroom.voice;

import android.content.*;
import android.os.*;
import android.speech.*;
import java.util.*;
import java.util.function.BiConsumer;

/** One foreground practice answer, independent of ChatGPT and WebView recording. */
final class PracticeSpeech implements RecognitionListener {
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private BiConsumer<String,String> completion;
    private final Runnable timeout = () -> finish("", "음성 인식 시간이 지났어요. 다시 말해주세요.");
    PracticeSpeech(Context context) { this.context=context; }
    void start(BiConsumer<String,String> callback) {
        if(completion!=null) { callback.accept("","이미 듣고 있어요."); return; }
        completion=callback;
        try {
            if(!SpeechRecognizer.isRecognitionAvailable(context)) { finish("","이 기기의 음성 인식 서비스를 사용할 수 없어요."); return; }
            recognizer=SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(this);
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-US");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,5);
            main.postDelayed(timeout,30000);
            recognizer.startListening(intent);
        } catch(Exception e) { finish("","음성 인식을 시작하지 못했어요. 잠시 후 다시 말해주세요."); }
    }
    void stop() { if(recognizer!=null) recognizer.stopListening(); }
    void cancel() { finish("","음성 연습을 멈췄어요."); }
    private void finish(String text,String error) {
        BiConsumer<String,String> callback=completion; completion=null;
        main.removeCallbacks(timeout);
        if(recognizer!=null) { SpeechRecognizer old=recognizer;recognizer=null;old.cancel();old.destroy(); }
        if(callback!=null) callback.accept(text,error);
    }
    public void onResults(Bundle results) {
        ArrayList<String> words=results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        finish(words==null||words.isEmpty()?"":words.get(0),null);
    }
    public void onError(int error) {
        String message=switch(error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "마이크 사용을 허용해주세요.";
            case SpeechRecognizer.ERROR_NO_MATCH,SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "잘 들리지 않았어요. 다시 말해주세요.";
            case SpeechRecognizer.ERROR_NETWORK,SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "음성 인식 연결을 확인해주세요.";
            case SpeechRecognizer.ERROR_AUDIO -> "다른 앱이 마이크를 사용 중이거나 기기의 마이크가 꺼져 있어요.";
            default -> "음성 인식이 잠시 중단됐어요. 다시 말해주세요. ("+error+")";
        }; finish("",message);
    }
    public void onReadyForSpeech(Bundle b) {}
    public void onBeginningOfSpeech() {}
    public void onRmsChanged(float rms) {}
    public void onBufferReceived(byte[] buffer) {}
    public void onEndOfSpeech() {}
    public void onPartialResults(Bundle b) {}
    public void onEvent(int type,Bundle b) {}
}
