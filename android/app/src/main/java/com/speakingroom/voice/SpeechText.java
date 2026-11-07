package com.speakingroom.voice;

/** Learning metadata stays in the transcript but is never read aloud. */
final class SpeechText {
    static String clean(String raw) {
        return raw.replaceAll("(?is)⟦\\s*(?:USED|TURN_EVAL)\\s*:.*?⟧", "")
            .replaceAll("(?im)^\\s*(?:USED|TURN_EVAL)\\s*:.*$", "").trim();
    }
}
