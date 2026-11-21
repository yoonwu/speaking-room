package com.speakingroom.voice;

import org.junit.Test;
import static org.junit.Assert.*;

public class PracticeInputCompletionTest {
    @Test public void serviceStopWhileQueuedPcmRemainsRejectsEvenAfterLateDrainAndEof(){
        PracticeInputCompletion input=new PracticeInputCompletion();
        assertEquals(PracticeInputCompletion.Outcome.TRUNCATED,input.serviceStopped());
        input.inputDrained();
        assertEquals(PracticeInputCompletion.Outcome.TRUNCATED,input.eofSent());
    }
    @Test public void synchronousServiceStopDuringCloseWaitsForSuccessfulEof(){
        PracticeInputCompletion input=new PracticeInputCompletion();input.inputDrained();
        assertEquals(PracticeInputCompletion.Outcome.WAIT,input.serviceStopped());
        assertEquals(PracticeInputCompletion.Outcome.SUCCESS,input.eofSent());
    }
    @Test public void serviceStopAfterSuccessfulEofCompletes(){
        PracticeInputCompletion input=new PracticeInputCompletion();input.inputDrained();
        assertEquals(PracticeInputCompletion.Outcome.WAIT,input.eofSent());
        assertEquals(PracticeInputCompletion.Outcome.SUCCESS,input.serviceStopped());
    }
    @Test public void duplicateStopBeforeEofCannotAuthorizeAnIncompleteClose(){
        PracticeInputCompletion input=new PracticeInputCompletion();input.inputDrained();
        assertEquals(PracticeInputCompletion.Outcome.WAIT,input.serviceStopped());
        assertEquals(PracticeInputCompletion.Outcome.WAIT,input.serviceStopped());
    }
}
