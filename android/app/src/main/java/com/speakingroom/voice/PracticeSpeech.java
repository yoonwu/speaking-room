package com.speakingroom.voice;

import android.content.*;
import android.media.AudioFormat;
import android.os.*;
import android.speech.*;
import java.io.*;
import java.util.*;

/** Capture and recognition never compete for the microphone. */
final class PracticeSpeech {
    interface Completion { void accept(String text,String error,byte[] wav); }
    private final Context context;
    private final Handler main=new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PracticeMicrophone microphone;
    private Completion completion;
    private ParcelFileDescriptor input,output;
    private byte[] recorded;
    private int generation;
    private StringBuilder segments;
    private final Runnable timeout=()->finish("","음성 인식 시간이 지났어요. 다시 말해주세요.");
    PracticeSpeech(Context context){this.context=context;}
    void start(boolean recordAnswer,Completion callback){
        if(!begin(callback))return;final int epoch=generation;
        if(!SpeechRecognizer.isRecognitionAvailable(context)){finish("","이 기기의 음성 인식 서비스를 사용할 수 없어요.");return;}
        if(recordAnswer&&Build.VERSION.SDK_INT>=33){
            capture(epoch,(pcm,speech,error)->{if(error!=null){finish("",error);return;}if(!speech||pcm.length<1600){finish("","잘 들리지 않았어요. 다시 말해주세요.");return;}recorded=PracticeAudio.wav(pcm);recognize(epoch,pcm);});
        }else recognize(epoch,null);
    }
    void recordOnly(Completion callback){
        if(!begin(callback))return;final int epoch=generation;
        capture(epoch,(pcm,speech,error)->{if(error!=null){finish("",error);return;}if(!speech||pcm.length<1600){finish("","잘 들리지 않았어요. 다시 말해주세요.");return;}recorded=PracticeAudio.wav(pcm);finish("",null);});
    }
    private boolean begin(Completion callback){
        if(completion!=null){callback.accept("","이미 듣고 있어요.",null);return false;}
        completion=callback;recorded=null;segments=new StringBuilder();generation++;main.postDelayed(timeout,30000);return true;
    }
    private void capture(int epoch,PracticeMicrophone.Completion callback){
        microphone=new PracticeMicrophone();microphone.start(context,(pcm,speech,error)->{if(epoch!=generation||completion==null)return;microphone=null;callback.accept(pcm,speech,error);});
    }
    private void recognize(int epoch,byte[] pcm){
        try{
            main.removeCallbacks(timeout);main.postDelayed(timeout,30000);
            recognizer=SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(new RecognitionListener(){
                private boolean current(){return epoch==generation&&completion!=null;}
                public void onResults(Bundle b){if(current())finish(top(b),null);}
                public void onSegmentResults(Bundle b){if(current()){String text=top(b);if(!text.isEmpty()){if(segments.length()>0)segments.append(' ');segments.append(text);}}}
                public void onEndOfSegmentedSession(){if(current())finish(segments.toString(),null);}
                public void onError(int error){if(current())finish("",errorMessage(error));}
                public void onReadyForSpeech(Bundle b){} public void onBeginningOfSpeech(){} public void onRmsChanged(float rms){}
                public void onBufferReceived(byte[] buffer){} public void onEndOfSpeech(){} public void onPartialResults(Bundle b){} public void onEvent(int type,Bundle b){}
            });
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-US");intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,5);
            if(pcm!=null&&Build.VERSION.SDK_INT>=33){
                ParcelFileDescriptor[] pipe=ParcelFileDescriptor.createPipe();input=pipe[0];output=pipe[1];
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE,input);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT,1);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING,AudioFormat.ENCODING_PCM_16BIT);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE,PracticeAudio.RATE);
                intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION,RecognizerIntent.EXTRA_AUDIO_SOURCE);
                ParcelFileDescriptor sink=output;
                recognizer.startListening(intent);
                // Closing the writer ends the session; the microphone is already released.
                new Thread(()->{try(OutputStream stream=new ParcelFileDescriptor.AutoCloseOutputStream(sink)){stream.write(pcm);}catch(IOException e){main.post(()->{if(epoch==generation&&completion!=null)finish("","음성 인식기가 녹음을 읽지 못했어요. 다시 말해주세요.");});}},"practice-recognition-input").start();
            }else recognizer.startListening(intent);
        }catch(Exception e){finish("","음성 인식을 시작하지 못했어요. 잠시 후 다시 말해주세요.");}
    }
    void stop(){if(microphone!=null)microphone.stop();else if(recognizer!=null)recognizer.stopListening();}
    void cancel(){finish("","음성 연습을 멈췄어요.");}
    private void finish(String text,String error){
        Completion callback=completion;completion=null;generation++;main.removeCallbacks(timeout);
        if(microphone!=null){microphone.cancel();microphone=null;}
        if(recognizer!=null){SpeechRecognizer old=recognizer;recognizer=null;old.cancel();old.destroy();}
        close(input);close(output);input=null;output=null;byte[] wav=error==null?recorded:null;recorded=null;
        if(callback!=null)callback.accept(text,error,wav);
    }
    private static void close(ParcelFileDescriptor fd){if(fd!=null)try{fd.close();}catch(IOException ignored){}}
    private static String top(Bundle results){ArrayList<String> words=results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);return words==null||words.isEmpty()?"":words.get(0);}
    private static String errorMessage(int error){return switch(error){
        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS->"마이크 사용을 허용해주세요.";
        case SpeechRecognizer.ERROR_NO_MATCH,SpeechRecognizer.ERROR_SPEECH_TIMEOUT->"잘 들리지 않았어요. 다시 말해주세요.";
        case SpeechRecognizer.ERROR_NETWORK,SpeechRecognizer.ERROR_NETWORK_TIMEOUT->"음성 인식 연결을 확인해주세요.";
        case SpeechRecognizer.ERROR_AUDIO->"다른 앱이 마이크를 사용 중이거나 기기의 마이크가 꺼져 있어요.";
        default->"음성 인식이 잠시 중단됐어요. 다시 말해주세요. ("+error+")";
    };}
}