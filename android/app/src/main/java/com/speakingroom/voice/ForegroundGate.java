package com.speakingroom.voice;

import java.io.InterruptedIOException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import java.util.function.BooleanSupplier;

/** OAuth exchange must wait until our app returns from the browser. */
final class ForegroundGate {
    private final Set<Object> resumed = Collections.newSetFromMap(new IdentityHashMap<>());

    synchronized void resume(Object activity) { resumed.add(activity); notifyAll(); }
    synchronized void pause(Object activity) { resumed.remove(activity); }

    synchronized void await(long timeoutMillis, BooleanSupplier cancelled) throws InterruptedIOException {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        while (true) {
            if (cancelled.getAsBoolean()) throw new InterruptedIOException("로그인 연결을 취소했어요.");
            if (!resumed.isEmpty()) return;
            long remaining = (deadline - System.nanoTime()) / 1_000_000L;
            if (remaining <= 0) throw new InterruptedIOException("3초영어로 돌아온 뒤 연결을 다시 시작해주세요.");
            try { wait(Math.min(remaining, 1000L)); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new InterruptedIOException("로그인 연결을 취소했어요."); }
        }
    }
}
