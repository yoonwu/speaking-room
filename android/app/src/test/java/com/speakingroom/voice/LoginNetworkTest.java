package com.speakingroom.voice;

import org.junit.Test;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class LoginNetworkTest {
    @Test public void browserCallbackWaitsForTheAppBeforeExchange() throws Exception {
        ForegroundGate gate = new ForegroundGate(); Object screen = new Object();
        gate.resume(screen); gate.pause(screen);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        CountDownLatch started = new CountDownLatch(1);
        try {
            Future<String> result = worker.submit(() -> { started.countDown(); gate.await(3000, () -> false); return "exchange"; });
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertThrows(TimeoutException.class, () -> result.get(100, TimeUnit.MILLISECONDS));
            gate.resume(screen);
            assertEquals("exchange", result.get(1, TimeUnit.SECONDS));
        } finally { worker.shutdownNow(); }
    }
    @Test public void cancelledOrExpiredLoginNeverExchanges() {
        ForegroundGate gate = new ForegroundGate(); gate.resume(new Object());
        assertThrows(InterruptedIOException.class, () -> gate.await(1000, () -> true));
        assertThrows(InterruptedIOException.class, () -> new ForegroundGate().await(0, () -> false));
    }
    @Test public void dnsFailureRetriesTheSameRequestWithoutNewOAuth() throws Exception {
        AtomicInteger calls = new AtomicInteger(); List<Long> waits = new ArrayList<>();
        String result = NetworkRecovery.run(() -> { if(calls.incrementAndGet() < 3) throw new UnknownHostException("auth.openai.com"); return "same login result"; }, waits::add);
        assertEquals("same login result", result); assertEquals(3, calls.get());
        assertEquals(Arrays.asList(1000L, 10000L), waits);
    }
    @Test public void permanentDnsFailureStopsAfterThreeAttempts() {
        AtomicInteger calls = new AtomicInteger();
        assertThrows(UnknownHostException.class, () -> NetworkRecovery.run(() -> { calls.incrementAndGet(); throw new UnknownHostException(); }, millis -> {}));
        assertEquals(3, calls.get());
    }
    @Test public void possiblyConsumedCodeOrRefreshTokenIsNeverReplayed() {
        for (Exception failure : Arrays.asList(new SocketTimeoutException(), new IOException("response ended"), new OpenAiError(400, "invalid_grant"), new OpenAiError(503, ""))) {
            AtomicInteger calls = new AtomicInteger();
            assertThrows(failure.getClass(), () -> NetworkRecovery.run(() -> { calls.incrementAndGet(); throw failure; }, millis -> fail("must not retry")));
            assertEquals(1, calls.get());
        }
    }
    @Test public void returnPageDoesNotExposeOAuthResult() {
        String page = PlanClient.callbackPage();
        assertTrue(page.contains("speakingroom://chatgpt-return"));
        assertFalse(page.contains("code=")); assertFalse(page.contains("state="));
        assertFalse(page.contains("token=")); assertFalse(page.contains("연결 완료"));
    }
}
