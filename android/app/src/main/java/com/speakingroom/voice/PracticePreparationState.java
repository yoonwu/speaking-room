package com.speakingroom.voice;

/** One prepared recognition connection can be consumed by one matching capture. */
final class PracticePreparationState {
    private boolean preparing,ready;
    private int words;
    boolean isPreparing(){return preparing;}
    boolean matches(int expectedWords){return ready&&words==clamp(expectedWords);}
    boolean begin(int expectedWords){
        if(preparing)return false;
        words=clamp(expectedWords);preparing=true;ready=false;return true;
    }
    boolean markReady(){if(!preparing)return false;preparing=false;ready=true;return true;}
    boolean consume(int expectedWords){if(!matches(expectedWords))return false;ready=false;return true;}
    void clear(){preparing=false;ready=false;}
    private static int clamp(int value){return Math.max(0,Math.min(40,value));}
}
