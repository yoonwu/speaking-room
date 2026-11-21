package com.speakingroom.voice;

/** Service completion is valid only after all queued PCM and its EOF were sent. */
final class PracticeInputCompletion {
    enum Outcome { WAIT, SUCCESS, TRUNCATED }
    private boolean drained;
    private boolean eofSent;
    private boolean serviceStopped;
    private boolean truncated;

    synchronized void inputDrained(){drained=true;}
    synchronized Outcome serviceStopped(){
        serviceStopped=true;
        if(!drained)truncated=true;
        return outcome();
    }
    synchronized Outcome eofSent(){eofSent=true;return outcome();}
    private Outcome outcome(){
        if(truncated)return Outcome.TRUNCATED;
        return serviceStopped&&eofSent?Outcome.SUCCESS:Outcome.WAIT;
    }
}
