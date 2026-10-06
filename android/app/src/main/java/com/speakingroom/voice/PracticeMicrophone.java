package com.speakingroom.voice;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;

/** Releases the mic before recognition starts, preventing competing audio captures. */
final class PracticeMicrophone {
    interface Completion{void accept(byte[] pcm,boolean speech,String error);}
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile AudioRecord recorder;
    private volatile boolean stopped,cancelled;
    void start(Context context,Completion completion){
        if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){completion.accept(null,false,"마이크 사용을 허용해주세요.");return;}
        try{
            int min=AudioRecord.getMinBufferSize(PracticeAudio.RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(min<=0)throw new IllegalStateException("Unsupported microphone format");
            AudioRecord capture=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                .setAudioFormat(new AudioFormat.Builder().setSampleRate(PracticeAudio.RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(Math.max(min*2,6400)).build();
            recorder=capture;
            new Thread(()->{
                PracticeAudio clip=new PracticeAudio(SystemClock.elapsedRealtime());String error=null;
                try{
                    capture.startRecording();
                    if(capture.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException("Microphone unavailable");
                    short[] buffer=new short[320];
                    while(!stopped){int n=capture.read(buffer,0,buffer.length,AudioRecord.READ_BLOCKING);if(stopped)break;if(n<=0)throw new IllegalStateException("Microphone read failed");long now=SystemClock.elapsedRealtime();clip.append(buffer,n,now);if(clip.shouldStop(now))break;}
                }catch(Exception e){if(!stopped)error="녹음을 시작하지 못했어요. 다른 앱의 마이크 사용을 멈추고 다시 말해주세요.";}
                finally{try{capture.stop();}catch(Exception ignored){}capture.release();recorder=null;}
                final String failure=error;byte[] pcm=clip.pcm();boolean speech=clip.hasSpeech();
                main.post(()->{if(!cancelled)completion.accept(pcm,speech,failure);});
            },"practice-microphone").start();
        }catch(Exception e){AudioRecord old=recorder;recorder=null;if(old!=null)old.release();completion.accept(null,false,"녹음을 시작하지 못했어요. 마이크를 확인하고 다시 말해주세요.");}
    }
    void stop(){stopped=true;AudioRecord current=recorder;if(current!=null)try{current.stop();}catch(Exception ignored){}}
    void cancel(){cancelled=true;stop();}
}
