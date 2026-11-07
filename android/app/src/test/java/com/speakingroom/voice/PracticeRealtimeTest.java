package com.speakingroom.voice;

import org.junit.Test;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

/** Session lifecycle before network/JNI start is testable without a second microphone. */
public class PracticeRealtimeTest {
    @Test public void boundedQueueFailureDoesNotAlterPcmOrInventATranscript(){
        AtomicInteger calls=new AtomicInteger();AtomicReference<String> error=new AtomicReference<>();short[] pcm=new short[320];Arrays.fill(pcm,(short)1700);short[] original=pcm.clone();
        PracticeRealtime stream=new PracticeRealtime(5,(text,failure)->{assertEquals("",text);error.set(failure);calls.incrementAndGet();},()->fail("No ASR result was supplied"));
        for(int i=0;i<PracticeRealtime.QUEUE_FRAMES;i++)stream.append(pcm,pcm.length);assertEquals(0,calls.get());stream.append(pcm,pcm.length);assertEquals(1,calls.get());assertNotNull(error.get());assertArrayEquals(original,pcm);stream.cancel();stream.finishInput();assertEquals(1,calls.get());
    }
    @Test public void cancellingBeforePreparationAndFinishingDoesNotDeliverALateResult()throws Exception{
        AtomicInteger calls=new AtomicInteger();PracticeRealtime stream=new PracticeRealtime(5,30,(text,error)->calls.incrementAndGet(),()->fail("No ASR result"),()->fail("Cancelled preparation must not become ready"));stream.append(new short[320],320);stream.cancel();stream.cancel();stream.start();stream.start();stream.finishInput();Thread.sleep(70);assertEquals(0,calls.get());
    }
    @Test public void aMissingFinalResultHasOneBoundedPostCaptureDeadline()throws Exception{
        CountDownLatch done=new CountDownLatch(1);AtomicInteger calls=new AtomicInteger();PracticeRealtime stream=new PracticeRealtime(5,30,(text,error)->{assertEquals("",text);assertNotNull(error);calls.incrementAndGet();done.countDown();},()->fail("No ASR result"));stream.append(new short[320],320);stream.finishInput();assertTrue(done.await(1,TimeUnit.SECONDS));stream.finishInput();stream.cancel();Thread.sleep(50);assertEquals(1,calls.get());
    }
}
