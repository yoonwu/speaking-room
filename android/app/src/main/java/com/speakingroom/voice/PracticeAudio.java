package com.speakingroom.voice;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.function.IntSupplier;

/** Bounded, session-only mono PCM. No disk files or learning-record storage. */
final class PracticeAudio {
    static final class Timing {
        final long speechStartOffsetMs,captureDurationMs;
        Timing(long speechStartOffsetMs,long captureDurationMs){this.speechStartOffsetMs=speechStartOffsetMs;this.captureDurationMs=captureDurationMs;}
    }
    static final int RATE=16000, MAX_SAMPLES=RATE*25;
    private final ByteArrayOutputStream pcm=new ByteArrayOutputStream();
    private final long started;
    private final int expectedWords;
    private final IntSupplier heardWords;
    private long lastVoice;
    private double noise=100;
    private final ArrayList<Double> initialNoise=new ArrayList<>();
    private double initialPeak,initialVoicedQuiet=Double.MAX_VALUE;
    private int initialSamples,initialVoiced;
    private boolean calibrated;
    private int voiceFrames;
    private long candidateSpeechStart=-1,speechStart=-1;
    private boolean speech;
    PracticeAudio(long started){this(started,0,null);}
    PracticeAudio(long started,int expectedWords,IntSupplier heardWords){this.started=started;this.expectedWords=Math.max(0,Math.min(40,expectedWords));this.heardWords=heardWords;}
    void append(short[] samples,int count,long now){
        int n=Math.min(count,(MAX_SAMPLES*2-pcm.size())/2);double energy=0;
        for(int i=0;i<n;i++){short sample=samples[i];pcm.write(sample&255);pcm.write((sample>>8)&255);energy+=(double)sample*sample;}
        if(n==0)return;
        double rms=Math.sqrt(energy/n);
        if(!calibrated){
            initialSamples+=n;
            // Ignore startup zero buffers and keep voiced vowels out of the
            // ambient estimate when somebody starts answering immediately.
            if(periodic(samples,n)){initialVoiced++;initialVoicedQuiet=Math.min(initialVoicedQuiet,rms);}
            else if(rms>1){initialNoise.add(rms);initialPeak=Math.max(initialPeak,rms);}
            if(initialSamples>=RATE*3/10){
                calibrated=true;
                if(initialNoise.size()>=3){
                    Collections.sort(initialNoise);noise=initialNoise.get(initialNoise.size()/4);
                    // Loud initial consonants must not raise the threshold
                    // above the quieter voiced part of the same answer.
                    if(initialVoiced>=2)noise=Math.min(noise,initialVoicedQuiet*.3);
                    // A steady fan/road noise can exceed 300 from the very first
                    // frame. Do not freeze that initial noise as perpetual speech.
                    if(initialVoiced<2&&noise>300&&initialPeak<noise*2.5){speech=false;voiceFrames=0;lastVoice=0;candidateSpeechStart=-1;speechStart=-1;}
                }
                initialNoise.clear();
            }
        }
        double threshold=Math.max(300,noise*2.5);
        if(rms>threshold){
            lastVoice=now;
            // Sample position excludes AudioRecord/SDK startup and delayed read callbacks.
            if(voiceFrames==0)candidateSpeechStart=(pcm.size()/2L-n)*1000/RATE;
            if(++voiceFrames>=2){speech=true;if(speechStart<0)speechStart=candidateSpeechStart;}
        }else{voiceFrames=0;candidateSpeechStart=-1;if(!speech)noise=noise*.95+rms*.05;}
    }
    private static boolean periodic(short[] samples,int count){
        int n=Math.min(count,320);if(n<160)return false;
        double mean=0;for(int i=0;i<n;i++)mean+=samples[i];mean/=n;
        double energy=0;for(int i=0;i<n;i++){double v=samples[i]-mean;energy+=v*v;}
        if(energy/n<10000)return false; // DC offsets and very quiet input are not voicing evidence.
        for(int lag=40;lag<=Math.min(200,n-100);lag++){
            double cross=0,left=0,right=0;
            for(int i=lag;i<n;i++){double a=samples[i]-mean,b=samples[i-lag]-mean;cross+=a*b;left+=a*a;right+=b*b;}
            if(cross>0&&cross*cross>left*right*.64)return true;
        }
        return false;
    }
    boolean hasSpeech(){return speech;}
    Timing timing(){return speech&&speechStart>=0?new Timing(speechStart,pcm.size()/2L*1000/RATE):null;}
    boolean shouldStop(long now){
        int heard=heardWords==null?0:heardWords.getAsInt();
        // Only real partial/final ASR words enable the fast tail. An incomplete
        // phrase keeps more room for a child's pause and its next segment.
        long quiet=expectedWords>0&&heard>0?(heard>=expectedWords?650:2200):1400;
        return pcm.size()>=MAX_SAMPLES*2||now-started>=25000||(!speech&&now-started>=7000)||(speech&&now-lastVoice>=quiet);
    }
    byte[] pcm(){return pcm.toByteArray();}
    static byte[] wav(byte[] pcm){
        if(pcm.length>MAX_SAMPLES*2||(pcm.length&1)!=0)throw new IllegalArgumentException("Invalid PCM length");
        ByteBuffer b=ByteBuffer.allocate(44+pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+pcm.length).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
        b.putInt(16).putShort((short)1).putShort((short)1).putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16);
        b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm);return b.array();
    }
}
