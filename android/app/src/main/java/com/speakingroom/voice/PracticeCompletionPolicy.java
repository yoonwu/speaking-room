package com.speakingroom.voice;

import java.util.*;
import java.util.regex.*;

/** Endpoint evidence comes from heard words; a target sentence is never supplied to ASR. */
final class PracticeCompletionPolicy {
    private static final Pattern WORD=Pattern.compile("[A-Za-z0-9]+(?:['’][A-Za-z]+)*");
    private final int expectedWords;
    private final TreeMap<Long,String> finals=new TreeMap<>();
    private long partialOffset=-1;
    private String partial="";
    PracticeCompletionPolicy(int expectedWords){this.expectedWords=Math.max(0,Math.min(40,expectedWords));}
    synchronized void recognizing(long offset,String text){
        // A delayed hypothesis from an already committed segment must not be
        // counted a second time and prematurely end a child's middle pause.
        if(!finals.isEmpty()&&offset<=finals.lastKey())return;
        partialOffset=offset;partial=clean(text);
    }
    synchronized void recognized(long offset,String text){
        String value=clean(text);if(!value.isEmpty())finals.put(offset,value);
        if(partialOffset<=offset){partial="";partialOffset=-1;}
    }
    synchronized int heardWords(){return words(finalText())+(finals.containsKey(partialOffset)?0:words(partial));}
    synchronized boolean finalComplete(){return expectedWords>0&&words(finalText())>=expectedWords;}
    synchronized String finalText(){return String.join(" ",finals.values());}
    private static String clean(String value){return value==null?"":value.trim().replaceAll("\\s+"," ");}
    static int words(String text){int count=0;Matcher m=WORD.matcher(text);while(m.find())count++;return count;}
}
