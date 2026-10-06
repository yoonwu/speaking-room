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
}
