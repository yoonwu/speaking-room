package com.speakingroom.voice;

import java.io.InterruptedIOException;
import java.net.UnknownHostException;

/** Retry only DNS failures: no request reached the server, including OAuth POSTs. */
final class NetworkRecovery {
    interface Request<T> { T send() throws Exception; }
    interface Delay { void waitFor(long millis) throws InterruptedException; }

    static <T> T run(Request<T> request) throws Exception { return run(request, Thread::sleep); }
    static <T> T run(Request<T> request, Delay delay) throws Exception {
        for (int attempt = 0; ; attempt++) {
            try { return request.send(); }
            catch (UnknownHostException e) {
                if (attempt >= 2) throw e;
                // Leave time for Android's temporary negative DNS cache to expire.
                try { delay.waitFor(attempt == 0 ? 1000 : 10000); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new InterruptedIOException("연결 확인을 취소했어요."); }
            }
        }
    }
}
