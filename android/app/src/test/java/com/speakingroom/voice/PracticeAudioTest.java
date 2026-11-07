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
    private static void voice(PracticeAudio clip,long from,long to){
        for(long now=from;now<=to;now+=20){short[] frame=new short[320];for(int i=0;i<frame.length;i++)frame[i]=(short)(2500*Math.sin(2*Math.PI*160*((now-20)/1000.0+i/16000.0)));clip.append(frame,320,now);}
    }
    @Test public void actualRecognizedWordsEnableASixHundredFiftyMillisecondTailWithoutChangingLegacyCapture(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);PracticeAudio fast=new PracticeAudio(0,5,p::heardWords);voice(fast,20,800);p.recognizing(0,"I can't find my phone");
        fast.append(new short[320],320,1440);assertFalse(fast.shouldStop(1440));fast.append(new short[320],320,1460);assertTrue(fast.shouldStop(1460));
        PracticeAudio legacy=new PracticeAudio(0);voice(legacy,20,800);assertFalse(legacy.shouldStop(1460));assertTrue(legacy.shouldStop(2200));
    }
    @Test public void aPauseAfterThreeOfFiveWordsIsNotCutEvenWhenSpeechWasRapid(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);PracticeAudio clip=new PracticeAudio(0,5,p::heardWords);voice(clip,20,500);p.recognized(0,"I can't find");
        for(long now=520;now<=1500;now+=20){clip.append(new short[320],320,now);assertFalse("Keep a child's middle pause",clip.shouldStop(now));}
        voice(clip,1520,1900);p.recognizing(1000,"my phone");assertEquals(5,p.heardWords());assertFalse(clip.shouldStop(2540));assertTrue(clip.shouldStop(2560));assertEquals("I can't find",p.finalText());
    }
    @Test public void slowPolysyllabicIncompleteSpeechRetainsTheLongerPauseAndDoesNotUseVowelCounts(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);PracticeAudio clip=new PracticeAudio(0,5,p::heardWords);voice(clip,20,2200);p.recognizing(0,"international information processing");
        for(long now=2220;now<=4200;now+=20){clip.append(new short[320],320,now);assertFalse(clip.shouldStop(now));}assertTrue(clip.shouldStop(4400));
    }
    @Test public void aTranscriptWithoutRealVoiceDoesNotBypassTheNoSpeechTimeout(){
        PracticeAudio clip=new PracticeAudio(0,5,()->5);clip.append(new short[320],320,660);assertFalse(clip.shouldStop(660));assertFalse(clip.hasSpeech());assertNull(clip.timing());assertTrue(clip.shouldStop(7000));
    }
    @Test public void speechOnsetUsesRecordedSamplesRatherThanReadOrRecognitionCallbackDelay(){
        PracticeAudio clip=new PracticeAudio(100000);short[] voice=new short[320];Arrays.fill(voice,(short)2000);
        for(int i=0;i<10;i++)clip.append(new short[320],320,100020+i*20L);
        clip.append(voice,320,110000);assertNull("One loud frame is not confirmed speech",clip.timing());
        clip.append(voice,320,120000);PracticeAudio.Timing timing=clip.timing();assertNotNull(timing);assertEquals(200,timing.speechStartOffsetMs);assertEquals(240,timing.captureDurationMs);
    }
    @Test public void immediateConfirmedSpeechHasAValidZeroOffsetThroughCalibration(){
        PracticeAudio clip=new PracticeAudio(5000);voice(clip,5020,5800);PracticeAudio.Timing timing=clip.timing();assertNotNull(timing);assertEquals(0,timing.speechStartOffsetMs);assertEquals(800,timing.captureDurationMs);
    }
    @Test public void anIsolatedClickCannotBeReusedAsALaterSpeechOnset(){
        PracticeAudio clip=new PracticeAudio(0);short[] loud=new short[320];Arrays.fill(loud,(short)2000);clip.append(loud,320,20);
        for(long now=40;now<=200;now+=20)clip.append(new short[320],320,now);
        assertNull(clip.timing());clip.append(loud,320,220);clip.append(loud,320,240);assertEquals(200,clip.timing().speechStartOffsetMs);
    }
    @Test public void initialAmbientNoiseDoesNotGetReportedAsTheLaterVoiceStart(){
        PracticeAudio clip=new PracticeAudio(0);short[] noise=new short[320],voice=new short[320];Arrays.fill(noise,(short)700);Arrays.fill(voice,(short)4000);
        for(long now=20;now<=600;now+=20)clip.append(noise,320,now);assertFalse(clip.hasSpeech());assertNull(clip.timing());
        clip.append(voice,320,620);clip.append(voice,320,640);assertEquals(600,clip.timing().speechStartOffsetMs);assertEquals(640,clip.timing().captureDurationMs);
    }
}
