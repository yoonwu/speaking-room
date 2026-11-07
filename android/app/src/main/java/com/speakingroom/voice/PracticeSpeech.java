package com.speakingroom.voice;

import android.content.*;
import android.media.AudioFormat;
import android.os.*;
import android.speech.*;
import java.io.*;
import java.util.*;

/** Capture and recognition never compete for the microphone. */
final class PracticeSpeech {
    interface Completion { void accept(String text,String error,byte[] wav,PracticeAudio.Timing timing); }
    interface Preparation { void accept(String error); }
    private final Context context;
    private final Handler main=new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PracticeMicrophone microphone;
    private PracticeStreaming streaming;
    private PracticeRealtime realtime;
    private final PracticePreparationState preparationState=new PracticePreparationState();
    private final ArrayList<Preparation> preparations=new ArrayList<>();
    private boolean streamCaptureDone,streamNetworkDone;
    private String streamText,streamError;
    private Completion completion;
    private ParcelFileDescriptor input,output;
    private byte[] recorded;
    private PracticeAudio.Timing recordedTiming;
    private int generation;
    private StringBuilder segments;
    private final Runnable timeout=()->finish("","음성 인식 시간이 지났어요. 다시 말해주세요.");
    private final Runnable preparedTimeout=()->{if(completion==null)finish("","말하기 준비 시간이 지났어요. 다시 시작해주세요.");};
    PracticeSpeech(Context context){this.context=context;}
    void start(boolean recordAnswer,Completion callback){
        if(!begin(callback))return;final int epoch=generation;
        if(!SpeechRecognizer.isRecognitionAvailable(context)){finish("","이 기기의 음성 인식 서비스를 사용할 수 없어요.");return;}
        if(recordAnswer&&Build.VERSION.SDK_INT>=33){
            capture(epoch,(pcm,speech,error,timing)->{if(error!=null){finish("",error);return;}if(!speech||pcm.length<1600){finish("","잘 들리지 않았어요. 다시 말해주세요.");return;}recorded=PracticeAudio.wav(pcm);recordedTiming=timing;recognize(epoch,pcm);});
        }else recognize(epoch,null);
    }
    void recordOnly(Completion callback){
        recordOnly(callback,null,0);
    }
    void recordOnly(Completion callback,Runnable ready,int expectedWords){
        if(!begin(callback))return;final int epoch=generation;
        capture(epoch,ready,expectedWords,(pcm,speech,error,timing)->{if(error!=null){finish("",error);return;}if(!speech||pcm.length<1600){finish("","잘 들리지 않았어요. 다시 말해주세요.");return;}recorded=PracticeAudio.wav(pcm);recordedTiming=timing;finish("",null);});
    }
    void stream(Completion callback,Runnable captured){
        stream(callback,captured,null,0);
    }
    void stream(Completion callback,Runnable captured,Runnable ready,int expectedWords){
        if(!begin(callback))return;final int epoch=generation;
        main.removeCallbacks(timeout);main.postDelayed(timeout,35000);
        streamCaptureDone=false;streamNetworkDone=false;streamText="";streamError=null;
        PracticeStreaming upload=new PracticeStreaming((text,error)->main.post(()->{
            if(epoch!=generation||completion==null)return;streamNetworkDone=true;streamText=text;streamError=error;finishStreamIfReady();
        }));streaming=upload;upload.start();
        microphone=new PracticeMicrophone();microphone.start(context,upload::append,()->{if(epoch==generation&&completion!=null&&ready!=null)ready.run();},expectedWords,(pcm,speech,error,timing)->{
            if(epoch!=generation||completion==null)return;microphone=null;
            if(error!=null){finish("",error);return;}if(!speech||pcm.length<1600){finish("","잘 들리지 않았어요. 다시 말해주세요.");return;}
            recorded=PracticeAudio.wav(pcm);recordedTiming=timing;streamCaptureDone=true;captured.run();upload.finishInput();finishStreamIfReady();
        });
    }
    private void finishStreamIfReady(){if(streamCaptureDone&&streamNetworkDone)finish(streamText,streamError,true);}
    void prepareFast(int expectedWords,Preparation callback){
        if(completion!=null){callback.accept("이미 듣고 있어요.");return;}
        if(preparationState.isPreparing()){
            if(preparationState.pendingMatches(expectedWords))preparations.add(callback);else callback.accept("다른 문장의 말하기를 준비하고 있어요.");return;
        }
        if(realtime!=null&&preparationState.matches(expectedWords)){main.removeCallbacks(preparedTimeout);main.postDelayed(preparedTimeout,8000);callback.accept(null);return;}
        discardPreparation("새로운 말하기를 준비해요.");preparationState.begin(expectedWords);preparations.add(callback);final int epoch=++generation;
        PracticeRealtime upload=new PracticeRealtime(expectedWords,(text,error)->main.post(()->{
            if(epoch!=generation)return;
            if(completion==null){finish("",error!=null?error:"음성 연결이 종료됐어요. 다시 시작해주세요.");return;}
            streamNetworkDone=true;streamText=text;streamError=error;finishStreamIfReady();
        }),()->main.post(()->{if(epoch==generation&&completion!=null&&microphone!=null)microphone.stop();}),()->main.post(()->{
            if(epoch!=generation||!preparationState.markReady())return;
            ArrayList<Preparation> prepared=new ArrayList<>(preparations);preparations.clear();main.postDelayed(preparedTimeout,8000);for(Preparation listener:prepared)listener.accept(null);
        }));
        realtime=upload;upload.start();
    }
    void fastStream(Completion callback,Runnable captured,Runnable ready,int expectedWords){
        if(completion!=null){callback.accept("","이미 듣고 있어요.",null,null);return;}
        if(realtime==null||!preparationState.consume(expectedWords)){callback.accept("","말하기 준비를 다시 시작해주세요.",null,null);return;}
        completion=callback;recorded=null;recordedTiming=null;segments=new StringBuilder();final int epoch=generation;final PracticeRealtime upload=realtime;
        main.removeCallbacks(preparedTimeout);main.removeCallbacks(timeout);main.postDelayed(timeout,35000);
        streamCaptureDone=false;streamNetworkDone=false;streamText="";streamError=null;
        microphone=new PracticeMicrophone();microphone.start(context,upload::append,()->{if(epoch==generation&&completion!=null&&ready!=null)ready.run();},expectedWords,upload::heardWords,(pcm,speech,error,timing)->{
            if(epoch!=generation||completion==null)return;microphone=null;
            if(error!=null){finish("",error);return;}if(!speech||pcm.length<1600){finish("","잘 들리지 않았어요. 다시 말해주세요.");return;}
            recorded=PracticeAudio.wav(pcm);recordedTiming=timing;streamCaptureDone=true;captured.run();upload.finishInput();finishStreamIfReady();
        });
    }
    private boolean begin(Completion callback){
        if(completion!=null){callback.accept("","이미 듣고 있어요.",null,null);return false;}
        discardPreparation("다른 말하기 연습을 시작했어요.");
        completion=callback;recorded=null;recordedTiming=null;segments=new StringBuilder();generation++;main.postDelayed(timeout,30000);return true;
    }
    private void discardPreparation(String error){
        main.removeCallbacks(preparedTimeout);preparationState.clear();ArrayList<Preparation> old=new ArrayList<>(preparations);preparations.clear();
        if(realtime!=null){realtime.cancel();realtime=null;}for(Preparation listener:old)listener.accept(error);
    }
    private void capture(int epoch,PracticeMicrophone.Completion callback){
        capture(epoch,null,0,callback);
    }
    private void capture(int epoch,Runnable ready,int expectedWords,PracticeMicrophone.Completion callback){
        microphone=new PracticeMicrophone();microphone.start(context,null,()->{if(epoch==generation&&completion!=null&&ready!=null)ready.run();},expectedWords,(pcm,speech,error,timing)->{if(epoch!=generation||completion==null)return;microphone=null;callback.accept(pcm,speech,error,timing);});
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
        finish(text,error,false);
    }
    private void finish(String text,String error,boolean keepRecording){
        Completion callback=completion;completion=null;generation++;main.removeCallbacks(timeout);
        if(microphone!=null){microphone.cancel();microphone=null;}
        if(streaming!=null){streaming.cancel();streaming=null;}
        discardPreparation(error!=null?error:"말하기 연습을 마쳤어요.");
        if(recognizer!=null){SpeechRecognizer old=recognizer;recognizer=null;old.cancel();old.destroy();}
        close(input);close(output);input=null;output=null;byte[] wav=error==null||keepRecording?recorded:null;PracticeAudio.Timing timing=wav!=null?recordedTiming:null;recorded=null;recordedTiming=null;
        if(callback!=null)callback.accept(text,error,wav,timing);
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
