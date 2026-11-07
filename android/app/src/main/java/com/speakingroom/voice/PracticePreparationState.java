package com.speakingroom.voice;

/** One prepared recognition connection can be consumed by one matching capture. */
final class PracticePreparationState {
    private boolean preparing,ready,consumed;
    private int words;
    boolean isPreparing(){return preparing;}
    boolean pendingMatches(int expectedWords){return preparing&&!consumed&&words==clamp(expectedWords);}
    boolean matches(int expectedWords){return ready&&words==clamp(expectedWords);}
    boolean begin(int expectedWords){
        if(preparing)return false;
        words=clamp(expectedWords);preparing=true;ready=false;consumed=false;return true;
    }
    boolean markReady(){if(!preparing)return false;preparing=false;ready=!consumed;return true;}
    boolean consume(int expectedWords){if(!matches(expectedWords))return false;ready=false;consumed=true;return true;}
    boolean consumeImmediately(int expectedWords){
        if(!matches(expectedWords)&&!pendingMatches(expectedWords))return false;
        ready=false;consumed=true;return true;
    }
    void clear(){preparing=false;ready=false;consumed=false;}
    private static int clamp(int value){return Math.max(0,Math.min(40,value));}
}
