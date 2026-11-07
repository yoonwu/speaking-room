package com.speakingroom.voice;

import org.junit.Test;
import static org.junit.Assert.*;

public class PracticePreparationStateTest {
    @Test public void duplicatePreparationCannotStartAnotherConnection(){
        PracticePreparationState state=new PracticePreparationState();assertTrue(state.begin(5));assertFalse(state.begin(5));assertFalse(state.begin(6));assertTrue(state.markReady());assertTrue(state.matches(5));
    }
    @Test public void onlyMatchingReadyCaptureCanConsumeTheConnectionOnce(){
        PracticePreparationState state=new PracticePreparationState();state.begin(5);assertFalse(state.consume(5));state.markReady();assertFalse(state.consume(6));assertTrue(state.consume(5));assertFalse(state.consume(5));
    }
    @Test public void cancelOrIdleExpiryPreventsLateReadyOrCapture(){
        PracticePreparationState state=new PracticePreparationState();state.begin(5);state.clear();assertFalse(state.markReady());assertFalse(state.consume(5));assertTrue(state.begin(6));state.markReady();state.clear();assertFalse(state.consume(6));
    }
    @Test public void foregroundAndBackgroundRequestsCanJoinOnlyTheSamePendingWordCount(){
        PracticePreparationState state=new PracticePreparationState();state.begin(5);assertTrue(state.pendingMatches(5));assertFalse(state.pendingMatches(6));assertFalse(state.consume(5));state.markReady();assertFalse(state.pendingMatches(5));assertTrue(state.consume(5));
        assertTrue(state.begin(999));assertTrue(state.pendingMatches(40));state.clear();assertFalse(state.pendingMatches(40));
    }
    @Test public void immediateCaptureConsumesPendingConnectionOnceWithoutInventingNetworkReadiness(){
        PracticePreparationState state=new PracticePreparationState();state.begin(5);assertFalse(state.matches(5));assertFalse(state.consumeImmediately(6));assertTrue(state.consumeImmediately(5));assertFalse(state.consumeImmediately(5));
        assertTrue("A later network-ready callback is still handled",state.markReady());assertFalse("Ready cannot reopen consumed capture",state.matches(5));assertFalse(state.consume(5));assertFalse(state.consumeImmediately(5));
    }
    @Test public void immediateCaptureCanReuseAWarmConnectionAndCancelInvalidatesBothPaths(){
        PracticePreparationState state=new PracticePreparationState();state.begin(5);state.markReady();assertTrue(state.consumeImmediately(5));state.clear();assertFalse(state.consumeImmediately(5));
        state.begin(6);state.clear();assertFalse(state.markReady());assertFalse(state.consumeImmediately(6));
    }
}
