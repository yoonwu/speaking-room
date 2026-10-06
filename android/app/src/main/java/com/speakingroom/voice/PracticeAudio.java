package com.speakingroom.voice;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/** Bounded, session-only mono PCM. No disk files or learning-record storage. */
final class PracticeAudio {
    static final int RATE=16000, MAX_SAMPLES=RATE*25;
    private final ByteArrayOutputStream pcm=new ByteArrayOutputStream();
    private final long started;
    private long lastVoice;
    private double noise=100;
    private int voiceFrames;
    private boolean speech;
    PracticeAudio(long started){this.started=started;}
    void append(short[] samples,int count,long now){
        int n=Math.min(count,(MAX_SAMPLES*2-pcm.size())/2);double energy=0;
        for(int i=0;i<n;i++){short sample=samples[i];pcm.write(sample&255);pcm.write((sample>>8)&255);energy+=(double)sample*sample;}
        if(n==0)return;
        double rms=Math.sqrt(energy/n),threshold=Math.max(300,noise*2.5);
        if(rms>threshold){lastVoice=now;if(++voiceFrames>=2)speech=true;}
        else{voiceFrames=0;if(!speech)noise=noise*.95+rms*.05;}
    }
    boolean hasSpeech(){return speech;}
    boolean shouldStop(long now){return pcm.size()>=MAX_SAMPLES*2||now-started>=25000||(!speech&&now-started>=7000)||(speech&&now-lastVoice>=1400);}
    byte[] pcm(){return pcm.toByteArray();}
    static byte[] wav(byte[] pcm){
        if(pcm.length>MAX_SAMPLES*2||(pcm.length&1)!=0)throw new IllegalArgumentException("Invalid PCM length");
        ByteBuffer b=ByteBuffer.allocate(44+pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+pcm.length).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
        b.putInt(16).putShort((short)1).putShort((short)1).putInt(RATE).putInt(RATE*2).putShort((short)2).putShort((short)16);
        b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm);return b.array();
    }
}
