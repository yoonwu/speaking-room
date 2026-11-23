package com.speakingroom.voice;

/** Small, bounded sessions; spoken commands work with English recognition. */
final class Lesson {
    static String command(String text) {
        String t = text.toLowerCase(java.util.Locale.US).replaceAll("[^a-z ]", "").trim();
        if (t.equals("stop") || t.equals("stop practice") || t.equals("pause") || t.equals("end practice")) return "stop";
        if (t.equals("repeat") || t.equals("say that again") || t.equals("repeat please")) return "repeat";
        if (t.equals("help") || t.equals("help me")) return "help";
        return "answer";
    }
}
