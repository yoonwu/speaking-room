package com.speakingroom.voice;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import java.util.function.IntSupplier;

/** Releases the mic before recognition starts, preventing competing audio captures. */
final class PracticeMicrophone {
    interface Completion{void accept(byte[] pcm,boolean speech,String error,PracticeAudio.Timing timing);}
    interface Frames{void accept(short[] pcm,int count);}
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Object lifecycle=new Object();
    private volatile AudioRecord recorder;
    private volatile boolean stopped,cancelled;
    void start(Context context,Completion completion){
        start(context,null,completion);
    }
    void start(Context context,Frames frames,Completion completion){
        start(context,frames,null,0,completion);
    }
    void start(Context context,Frames frames,Runnable ready,int expectedWords,Completion completion){
        start(context,frames,ready,expectedWords,null,completion);
    }
    void start(Context context,Frames frames,Runnable ready,int expectedWords,IntSupplier heardWords,Completion completion){
        if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){completion.accept(null,false,"마이크 사용을 허용해주세요.",null);return;}
        new Thread(()->{
            AudioRecord capture=null;PracticeAudio clip=new PracticeAudio(SystemClock.elapsedRealtime(),expectedWords,heardWords);String error=null;
            try{
                if(!stopped&&!cancelled){
                    int min=AudioRecord.getMinBufferSize(PracticeAudio.RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
                    if(min<=0)throw new IllegalStateException("Unsupported microphone format");
                    capture=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                        .setAudioFormat(new AudioFormat.Builder().setSampleRate(PracticeAudio.RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                        .setBufferSizeInBytes(Math.max(min*2,6400)).build();
                    synchronized(lifecycle){recorder=capture;if(!stopped&&!cancelled){capture.startRecording();if(capture.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException("Microphone unavailable");}}
                    if(!stopped&&!cancelled){
                        clip=new PracticeAudio(SystemClock.elapsedRealtime(),expectedWords,heardWords);
                        if(ready!=null)main.post(()->{if(!stopped&&!cancelled)ready.run();});
                        short[] buffer=new short[320];
                        while(!stopped){int n=capture.read(buffer,0,buffer.length,AudioRecord.READ_BLOCKING);if(stopped)break;if(n<=0)throw new IllegalStateException("Microphone read failed");long now=SystemClock.elapsedRealtime();clip.append(buffer,n,now);if(frames!=null)frames.accept(buffer,n);if(clip.shouldStop(now))break;}
                    }
                }
            }catch(Exception e){if(!stopped)error="녹음을 시작하지 못했어요. 다른 앱의 마이크 사용을 멈추고 다시 말해주세요.";}
            finally{synchronized(lifecycle){if(capture!=null){try{capture.stop();}catch(Exception ignored){}try{capture.release();}catch(Exception ignored){}}recorder=null;}}
            final String failure=error;byte[] pcm=clip.pcm();boolean speech=clip.hasSpeech();PracticeAudio.Timing timing=clip.timing();
            main.post(()->{if(!cancelled)completion.accept(pcm,speech,failure,timing);});
        },"practice-microphone").start();
    }
    void stop(){synchronized(lifecycle){stopped=true;AudioRecord current=recorder;if(current!=null)try{current.stop();}catch(Exception ignored){}}}
    void cancel(){cancelled=true;stop();}
}
