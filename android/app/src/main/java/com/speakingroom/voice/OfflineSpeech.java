package com.speakingroom.voice;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import org.json.JSONException;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Runs recognition locally without supplying the expected answer to the decoder. */
final class OfflineSpeech {
    private static final String ARCHIVE = "vosk-en-us-0.15.zip";
    private static final String MODEL_DIRECTORY = "vosk-model-small-en-us-0.15";
    private static final Object EXTRACTION_LOCK = new Object();
    private static final String UNAVAILABLE = "영어 음성 인식기를 열지 못했어요. 다시 말하거나 직접 입력해주세요.";
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private Model model;
    private volatile boolean closed;

    OfflineSpeech(Context context) {
        this.context = context.getApplicationContext();
        decoder.execute(() -> {
            try { openModel(); } catch (Exception | LinkageError ignored) {
                // A microphone tap can retry extraction or loading after this warm-up.
            }
        });
    }

    Session start(Consumer<String> prepared) {
        Session session = new Session();
        decoder.execute(() -> {
            if (closed || session.cancelled) return;
            String error = null;
            try {
                session.recognizer = new Recognizer(openModel(), PracticeAudio.RATE);
            } catch (Exception | LinkageError failure) {
                error = UNAVAILABLE;
            }
            String result = error;
            main.post(() -> { if (!closed && !session.cancelled) prepared.accept(result); });
        });
        return session;
    }

    private Model openModel() throws IOException {
        if (model == null) {
            LibVosk.setLogLevel(LogLevel.WARNINGS);
            model = new Model(extractModel().getAbsolutePath());
        }
        return model;
    }

    private File extractModel() throws IOException {
        synchronized (EXTRACTION_LOCK) {
            File root = new File(context.getNoBackupFilesDir(), MODEL_DIRECTORY);
            AtomicFile ready = new AtomicFile(new File(root, "extracted"));
            if (ready.getBaseFile().isFile()) return root;
            Path targetRoot = root.toPath();
            Files.createDirectories(targetRoot);
            try (ZipInputStream zip = new ZipInputStream(context.getAssets().open(ARCHIVE))) {
                String prefix = MODEL_DIRECTORY + "/";
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    if (entry.isDirectory() || !entry.getName().startsWith(prefix)) continue;
                    Path target = targetRoot.resolve(entry.getName().substring(prefix.length())).normalize();
                    if (!target.startsWith(targetRoot)) throw new IOException("Invalid model entry");
                    Files.createDirectories(target.getParent());
                    Files.copy(zip, target, StandardCopyOption.REPLACE_EXISTING);
                }
            }
            if (!Files.isRegularFile(targetRoot.resolve("am/final.mdl"))
                || !Files.isRegularFile(targetRoot.resolve("graph/Gr.fst"))) {
                throw new IOException("Incomplete speech model");
            }
            FileOutputStream marker = ready.startWrite();
            ready.finishWrite(marker);
            return root;
        }
    }

    interface Completion { void accept(String text, String error); }

    final class Session {
        private Recognizer recognizer;
        private final StringBuilder words = new StringBuilder();
        private final short[] batch = new short[1600];
        private int samples;
        private volatile boolean cancelled;
        private boolean failed;

        // Called on the recording thread. At most one batch is queued per 100ms of audio.
        void feed(short[] pcm, int count) {
            if (cancelled || closed) return;
            for (int offset = 0; offset < count;) {
                int copy = Math.min(count - offset, batch.length - samples);
                System.arraycopy(pcm, offset, batch, samples, copy);
                offset += copy;
                samples += copy;
                if (samples == batch.length) enqueueBatch();
            }
        }

        private void enqueueBatch() {
            short[] chunk = Arrays.copyOf(batch, samples);
            samples = 0;
            queue(() -> {
                if (cancelled || failed || recognizer == null) return;
                try {
                    if (recognizer.acceptWaveForm(chunk, chunk.length)) append(recognizer.getResult());
                } catch (RuntimeException | JSONException error) {
                    failed = true;
                }
            });
        }

        // Called after capture has ended and the recorder will not write more frames.
        void finish(Completion callback) {
            if (samples > 0) enqueueBatch();
            queue(() -> {
                if (cancelled || recognizer == null) return;
                try {
                    if (!failed) append(recognizer.getFinalResult());
                } catch (RuntimeException | JSONException error) {
                    failed = true;
                } finally {
                    release();
                }
                String text = words.toString();
                main.post(() -> { if (!closed && !cancelled) callback.accept(text, failed ? UNAVAILABLE : null); });
            });
        }

        private void append(String result) throws JSONException {
            String phrase = new JSONObject(result).optString("text").trim();
            if (phrase.isEmpty()) return;
            if (words.length() != 0) words.append(' ');
            words.append(phrase);
        }

        void cancel() {
            cancelled = true;
            queue(this::release);
        }

        private void release() {
            if (recognizer != null) {
                recognizer.close();
                recognizer = null;
            }
        }
    }

    private synchronized void queue(Runnable job) {
        if (!closed) decoder.execute(job);
    }

    synchronized void close() {
        if (closed) return;
        closed = true;
        decoder.execute(() -> { if (model != null) model.close(); });
        decoder.shutdown();
    }
}
