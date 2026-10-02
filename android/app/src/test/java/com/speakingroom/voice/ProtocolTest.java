package com.speakingroom.voice;

import org.junit.Test;
import java.io.*;
import java.util.Date;
import com.nimbusds.jwt.JWTClaimsSet;
import static org.junit.Assert.*;

public class ProtocolTest {
    @Test public void learningMetadataIsNeverSpoken() {
        assertEquals("Where are you going?", SpeechText.clean("Where are you going? ⟦USED:ble:test⟧ ⟦TURN_EVAL:{\"communication\":80,\"fix\":\"text\"}⟧"));
        assertEquals("Okay.", SpeechText.clean("Okay.\nUSED:abc\nTURN_EVAL:{\"x\":2}"));
    }
    @Test public void completedStreamAcceptsOnlyFinishedOutput() throws Exception {
        String stream = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\" there\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n";
        assertEquals("Hello there", ResponseStream.read(new StringReader(stream)));
    }
    @Test public void truncatedStreamIsRejected() {
        assertThrows(IOException.class, () -> ResponseStream.read(new StringReader("data: {\"type\":\"response.output_text.delta\",\"delta\":\"Partial\"}\n\n")));
    }
    @Test public void failedStreamIsRejected() {
        assertThrows(IOException.class, () -> ResponseStream.read(new StringReader("data: {\"type\":\"response.failed\"}\n\n")));
    }
    @Test public void wrongCompletionStateIsRejected() {
        assertThrows(IOException.class, () -> ResponseStream.read(new StringReader("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"incomplete\"}}\n\n")));
    }
    @Test public void planPermissionMustBeAnExactScope() throws Exception {
        PlanClient.requirePlanScope("openid chatgpt.tokens.use.direct email");
        assertThrows(IOException.class, () -> PlanClient.requirePlanScope("openid email"));
        assertThrows(IOException.class, () -> PlanClient.requirePlanScope("chatgpt.tokens.use.direct.extra"));
    }
    @Test public void identityChecksAudienceNonceIssuerAndExpiry() throws Exception {
        long now = System.currentTimeMillis();
        JWTClaimsSet good = claims(now + 60000, "oaiapp_test", "nonce", PlanClient.AUTH);
        PlanClient.checkClaims(good, "oaiapp_test", "nonce", now);
        assertThrows(SecurityException.class, () -> PlanClient.checkClaims(good, "wrong", "nonce", now));
        assertThrows(SecurityException.class, () -> PlanClient.checkClaims(good, "oaiapp_test", "wrong", now));
        assertThrows(SecurityException.class, () -> PlanClient.checkClaims(claims(now - 60000, "oaiapp_test", "nonce", PlanClient.AUTH), "oaiapp_test", "nonce", now));
        assertThrows(SecurityException.class, () -> PlanClient.checkClaims(claims(now + 60000, "oaiapp_test", "nonce", "https://example.com"), "oaiapp_test", "nonce", now));
    }
    private JWTClaimsSet claims(long expiry, String aud, String nonce, String issuer) { return new JWTClaimsSet.Builder().issuer(issuer).audience(aud).subject("user").expirationTime(new Date(expiry)).claim("nonce", nonce).build(); }
    @Test public void ordinaryAnswersDoNotTriggerStop() {
        assertEquals("stop", Lesson.command("Stop practice."));
        assertEquals("repeat", Lesson.command("Say that again."));
        assertEquals("help", Lesson.command("Help me."));
        assertEquals("answer", Lesson.command("I stopped at a cafe."));
        assertEquals("answer", Lesson.command("I want to stop drinking coffee."));
    }
}
