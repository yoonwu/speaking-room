package com.speakingroom.voice;

import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class PracticeTranscriptTest {
    private static String text(String json){return PracticeTranscript.fromJson(json,"SDK display fallback");}
    @Test public void rawMissingDemonstrativeIsNeverFilledFromTheFormattedSentence(){
        assertEquals("can i change seat",text("{\"RecognitionStatus\":\"Success\",\"DisplayText\":\"Can I change this seat?\",\"NBest\":[{\"Lexical\":\"can i change seat\",\"Display\":\"Can I change this seat?\"}]}"));
    }
    @Test public void rawMissingAdverbIsNeverFilledFromDisplayOrAnAlternateCandidate(){
        assertEquals("i have reservation",text("{\"NBest\":[{\"Confidence\":0.7,\"Lexical\":\"i have reservation\",\"Display\":\"I have already reservation.\"},{\"Confidence\":0.99,\"Lexical\":\"i have already reservation\"}]}"));
    }
    @Test public void actuallyRecognizedPronounsAndAlreadyRemainUntouched(){
        assertEquals("can i change this seat",text("{\"NBest\":[{\"Lexical\":\"can i change this seat\"}]}"));
        assertEquals("i already have a reservation",text("{\"NBest\":[{\"Lexical\":\"i already have a reservation\"}]}"));
    }
    @Test public void explicitEmptyNullOrInvalidLexicalCannotBecomeSpeechFromDisplay(){
        for(String raw:new String[]{"\"\"","\"   \"","null","42"})
            assertEquals("",text("{\"DisplayText\":\"I have a reservation.\",\"NBest\":[{\"Lexical\":"+raw+",\"Display\":\"I have a reservation.\",\"Words\":[{\"Word\":\"invented\"}]}]}"));
    }
    @Test public void completeRawWordEvidenceIsUsedOnlyWhenLexicalIsAbsent(){
        assertEquals("i have reservation",text("{\"NBest\":[{\"Display\":\"I have already reservation.\",\"Words\":[{\"Word\":\"i\"},{\"Word\":\"have\"},{\"Word\":\"reservation\"}]}]}"));
    }
    @Test public void incompleteWordListsAreNotReturnedAsACompleteTranscript(){
        assertEquals("Can I change seat?",text("{\"NBest\":[{\"Display\":\"Can I change seat?\",\"Words\":[{\"Word\":\"can\"},{}]}]}"));
    }
    @Test public void legacyDisplayAndSdkFallbackWorkOnlyWithoutRawEvidence(){
        assertEquals("Can I change seat?",text("{\"DisplayText\":\"Can I change seat?\"}"));
        assertEquals("I have reservation.",text("{\"NBest\":[{\"Display\":\"I have reservation.\"}]}"));
        assertEquals("SDK display fallback",text("{}"));assertEquals("SDK display fallback",text("not-json"));
    }
    @Test public void noMatchCannotUseFormattedOrFallbackSpeech(){
        assertEquals("",text("{\"RecognitionStatus\":\"NoMatch\",\"DisplayText\":\"A noise hallucination.\"}"));
        assertEquals("",PracticeTranscript.fromJson((JSONObject)null,null));
    }
    @Test public void whitespaceIsNormalizedWithoutRemovingGenuineRepetitionOrChangingGrammar(){
        assertEquals("I have have reservation",text("{\"NBest\":[{\"Lexical\":\"  I  have\\n have reservation  \"}]}"));
    }
}
