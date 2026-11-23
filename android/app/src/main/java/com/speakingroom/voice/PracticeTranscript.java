package com.speakingroom.voice;

import org.json.JSONArray;
import org.json.JSONObject;

/** Selects the provider's first raw hypothesis without consulting a target answer. */
final class PracticeTranscript {
    private PracticeTranscript(){}

    static String fromJson(String json,String fallback){
        try{return fromJson(new JSONObject(json),fallback);}
        catch(Exception ignored){return clean(fallback);}
    }

    static String fromJson(JSONObject result,String fallback){
        if(result==null)return clean(fallback);
        String status=result.optString("RecognitionStatus","");
        if(!status.isEmpty()&&!"Success".equals(status))return "";
        JSONArray best=result.optJSONArray("NBest");
        JSONObject first=best==null?null:best.optJSONObject(0);
        if(first!=null){
            // An explicitly empty raw result is not permission to use formatted
            // display text as evidence that additional words were spoken.
            if(first.has("Lexical"))return string(first.opt("Lexical"));
            String words=words(first.optJSONArray("Words"));
            if(words!=null)return words;
        }
        if(result.has("Lexical"))return string(result.opt("Lexical"));
        String display=string(result.opt("DisplayText"));
        if(!display.isEmpty())return display;
        if(first!=null){display=string(first.opt("Display"));if(!display.isEmpty())return display;}
        return clean(fallback);
    }

    private static String words(JSONArray words){
        if(words==null||words.length()==0)return null;
        StringBuilder out=new StringBuilder();
        for(int i=0;i<words.length();i++){
            JSONObject item=words.optJSONObject(i);
            String word=item==null?"":string(item.opt("Word"));
            if(word.isEmpty())return null;
            if(out.length()>0)out.append(' ');
            out.append(word);
        }
        return out.toString();
    }
    private static String string(Object value){return value instanceof String?clean((String)value):"";}
    private static String clean(String value){return value==null?"":value.trim().replaceAll("\\s+"," ");}
}
