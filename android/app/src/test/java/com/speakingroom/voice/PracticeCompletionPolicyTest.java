package com.speakingroom.voice;

import org.junit.Test;
import static org.junit.Assert.*;

public class PracticeCompletionPolicyTest {
    @Test public void partialWordsCanEnableEndpointingButAreNeverReturnedAsTheFinalAnswer(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);p.recognizing(0,"I can't find my phone.");assertEquals(5,p.heardWords());assertFalse(p.finalComplete());assertEquals("",p.finalText());
        p.recognized(0,"I can't find my phone.");assertTrue(p.finalComplete());assertEquals("I can't find my phone.",p.finalText());assertEquals(5,p.heardWords());
    }
    @Test public void aChildsIncompleteFinalSegmentKeepsListeningAndStitchesItsContinuation(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);p.recognized(0,"I can't find");assertFalse(p.finalComplete());assertEquals(3,p.heardWords());
        p.recognizing(1000,"my phone");assertEquals(5,p.heardWords());assertFalse(p.finalComplete());p.recognized(1000,"my phone.");assertTrue(p.finalComplete());assertEquals("I can't find my phone.",p.finalText());
    }
    @Test public void interimRevisionsAndRepeatedFinalEventsDoNotAccumulateDuplicateWords(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);p.recognizing(0,"I can");p.recognizing(0,"I can't find");assertEquals(3,p.heardWords());
        p.recognized(0,"I can't find");p.recognized(0,"I can't find");p.recognizing(0,"I can't find my phone");assertEquals(3,p.heardWords());assertFalse(p.finalComplete());
        p.recognizing(1000,"my phone");p.recognizing(1000,"my towel");assertEquals(5,p.heardWords());assertEquals("I can't find",p.finalText());
    }
    @Test public void longPolysyllabicPrefixesAreStillOnlyThreeHeardWords(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);p.recognizing(0,"international information processing");assertEquals(3,p.heardWords());assertFalse(p.finalComplete());assertEquals("",p.finalText());
    }
    @Test public void aLateHypothesisBeforeTheCommittedOffsetCannotDoubleCountAChildsPrefix(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(5);p.recognized(200,"I can't find");p.recognizing(0,"I can't find");assertEquals(3,p.heardWords());assertFalse(p.finalComplete());p.recognizing(1000,"my phone");assertEquals(5,p.heardWords());
    }
    @Test public void openAnswersAndNoSpeechDoNotBecomeCompleteFromAGuessedTarget(){
        PracticeCompletionPolicy p=new PracticeCompletionPolicy(0);p.recognized(0,"A complete spoken sentence.");assertFalse(p.finalComplete());assertEquals(4,p.heardWords());
        PracticeCompletionPolicy silent=new PracticeCompletionPolicy(5);silent.recognizing(0,"");silent.recognized(0,"");assertEquals(0,silent.heardWords());assertFalse(silent.finalComplete());
    }
}
