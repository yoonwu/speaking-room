package com.speakingroom.voice;

/** Small, bounded sessions; spoken commands work with English recognition. */
final class Lesson {
    static final String[] TOPICS = {"주말·일상", "취향·의견", "경험 설명", "계획 정하기", "오해 풀기"};
    static final String[] ENGLISH = {"weekend and daily life", "preferences and opinions", "a recent experience", "making plans together", "clarifying a misunderstanding"};
    static String instructions(String topic) {
        return "You are a friendly English conversation tutor for a Korean adult beginner. Topic: " + topic + ". "
            + "Practice a short coherent everyday conversation. Use common A1-A2 vocabulary and short sentences. "
            + "Reply with plain spoken English only, at most 35 words. No markdown, lists, or Korean. "
            + "Acknowledge what the learner actually said and ask exactly ONE relevant follow-up question. "
            + "Accept meaningful answers; do not demand a memorized sentence. If meaning is unclear, ask for clarification. "
            + "Correct only a major error briefly through a natural recast, then continue. "
            + "After 6 learner turns wrap up kindly without a new question. "
            + "Never ask the user to read, type, look at the screen, or operate the phone. "
            + "If the learner requests help, give one short example they can repeat.";
    }
    static String command(String text) {
        String t = text.toLowerCase(java.util.Locale.US).replaceAll("[^a-z ]", "").trim();
        if (t.equals("stop") || t.equals("stop practice") || t.equals("pause") || t.equals("end practice")) return "stop";
        if (t.equals("repeat") || t.equals("say that again") || t.equals("repeat please")) return "repeat";
        if (t.equals("help") || t.equals("help me")) return "help";
        return "answer";
    }
}
