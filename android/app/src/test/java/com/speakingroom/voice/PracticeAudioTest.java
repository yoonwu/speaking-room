package com.speakingroom.voice;

import org.junit.Test;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import static org.junit.Assert.*;

public class PracticeAudioTest {
    @Test public void wavRetainsSamplesWithAPlayableMonoHeader(){
        PracticeAudio clip=new PracticeAudio(0);clip.append(new short[]{32767,-32768,4660,-1},4,20);
        byte[] pcm=clip.pcm(),wav=PracticeAudio.wav(pcm);ByteBuffer h=ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(52,wav.length);assertEquals(44,h.getInt(4));assertEquals(1,h.getShort(22));assertEquals(16000,h.getInt(24));assertEquals(16,h.getShort(34));assertEquals(8,h.getInt(40));
        assertArrayEquals(new byte[]{-1,127,0,-128,52,18,-1,-1},Arrays.copyOfRange(wav,44,wav.length));
    }
    @Test public void silenceStopsButShortPausesDoNotCutAnAnswer(){
        PracticeAudio clip=new PracticeAudio(0);short[] voice=new short[320];Arrays.fill(voice,(short)2000);
        clip.append(voice,320,20);clip.append(voice,320,40);assertTrue(clip.hasSpeech());
        clip.append(new short[320],320,800);assertFalse(clip.shouldStop(800));assertTrue(clip.shouldStop(1440));
        PracticeAudio quiet=new PracticeAudio(0);assertFalse(quiet.shouldStop(6999));assertTrue(quiet.shouldStop(7000));
    }
    @Test public void aContinuousAnswerCannotGrowBeyondTwentyFiveSeconds(){
        PracticeAudio clip=new PracticeAudio(0);short[] samples=new short[PracticeAudio.MAX_SAMPLES+50];Arrays.fill(samples,(short)2000);
        clip.append(samples,samples.length,100);assertEquals(PracticeAudio.MAX_SAMPLES*2,clip.pcm().length);assertTrue(clip.shouldStop(100));
        clip.append(samples,10,101);assertEquals(PracticeAudio.MAX_SAMPLES*2,clip.pcm().length);
    }
    @Test public void incompleteOrOversizedPcmIsRejected(){
        assertThrows(IllegalArgumentException.class,()->PracticeAudio.wav(new byte[1]));
        assertThrows(IllegalArgumentException.class,()->PracticeAudio.wav(new byte[PracticeAudio.MAX_SAMPLES*2+2]));
    }
    @Test public void ambientNoiseAfterSpeechStillAllowsAutomaticEnd(){
        PracticeAudio clip=new PracticeAudio(0);short[] noise=new short[320],voice=new short[320];
        Arrays.fill(noise,(short)700);Arrays.fill(voice,(short)4000);
        for(long t=20;t<=500;t+=20)clip.append(noise,320,t);
        assertFalse("Steady background noise is not an answer",clip.hasSpeech());
        for(long t=520;t<=1100;t+=20)clip.append(voice,320,t);
        assertTrue(clip.hasSpeech());
        for(long t=1120;t<2500;t+=20){clip.append(noise,320,t);assertFalse(clip.shouldStop(t));}
        clip.append(noise,320,2500);assertTrue("Background noise must not hold the mic open",clip.shouldStop(2500));
    }
    @Test public void ambientNoiseWithoutSpeechDoesNotBecomeAnAnswer(){
        PracticeAudio clip=new PracticeAudio(0);short[] noise=new short[320];Arrays.fill(noise,(short)700);
        for(long t=20;t<=7000;t+=20)clip.append(noise,320,t);
        assertFalse(clip.hasSpeech());assertTrue(clip.shouldStop(7000));
    }
    @Test public void startupZeroDoesNotHideTheFollowingAmbientNoise(){
        PracticeAudio clip=new PracticeAudio(0);short[] noise=new short[320];Arrays.fill(noise,(short)700);
        clip.append(new short[320],320,20);
        for(long t=40;t<=7000;t+=20)clip.append(noise,320,t);
        assertFalse(clip.hasSpeech());assertTrue(clip.shouldStop(7000));
    }
    @Test public void immediateVoicedAnswerIsNotCalibratedAway(){
        PracticeAudio clip=new PracticeAudio(0);
        for(int frame=0;frame<40;frame++){
            short[] voice=new short[320];
            for(int i=0;i<voice.length;i++){
                double time=(frame*320+i)/16000.0;
                voice[i]=(short)((2600+900*Math.sin(2*Math.PI*3*time))*Math.sin(2*Math.PI*160*time));
            }
            clip.append(voice,320,(frame+1)*20L);
            if(frame>=1)assertTrue("Immediate voiced input remains speech",clip.hasSpeech());
            assertFalse(clip.shouldStop((frame+1)*20L));
        }
        for(long t=820;t<2200;t+=20){clip.append(new short[320],320,t);assertFalse(clip.shouldStop(t));}
        clip.append(new short[320],320,2200);assertTrue(clip.shouldStop(2200));
    }
    @Test public void initialLoudConsonantsDoNotCutOffQuieterVoicedSpeech(){
        PracticeAudio clip=new PracticeAudio(0);java.util.Random random=new java.util.Random(17);
        for(int frame=0;frame<120;frame++){
            short[] voice=new short[320];
            for(int i=0;i<voice.length;i++){
                double time=(frame*320+i)/16000.0;
                voice[i]=(short)(frame<15&&frame%4==0?random.nextGaussian()*3500:
                    (1900+700*Math.sin(2*Math.PI*3*time))*Math.sin(2*Math.PI*160*time));
            }
            clip.append(voice,320,(frame+1)*20L);
            if(frame>=1)assertTrue(clip.hasSpeech());
            assertFalse("Quieter voiced speech must not time out",clip.shouldStop((frame+1)*20L));
        }
        for(long t=2420;t<3800;t+=20){clip.append(new short[320],320,t);assertFalse(clip.shouldStop(t));}
        clip.append(new short[320],320,3800);assertTrue(clip.shouldStop(3800));
    }
}
