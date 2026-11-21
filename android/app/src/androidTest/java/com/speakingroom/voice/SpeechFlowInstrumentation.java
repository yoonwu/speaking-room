package com.speakingroom.voice;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.view.*;
import android.webkit.WebView;
import org.json.*;
import java.io.*;
import java.lang.reflect.Field;
import java.util.concurrent.*;

/** Isolated-device test of the actual Activity, WebView, bridge and AudioRecord. */
public final class SpeechFlowInstrumentation extends Instrumentation {
    private WebView web;
    private Activity activity;
    private final StringBuilder log=new StringBuilder();
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();
        try{exercise();result.putString("stream",log+"\nPASS installed-app speech flow\n");finish(Activity.RESULT_OK,result);}
        catch(Throwable error){StringWriter trace=new StringWriter();error.printStackTrace(new PrintWriter(trace));result.putString("stream",log+"\nFAIL\n"+trace);finish(Activity.RESULT_CANCELED,result);}
    }
    private void note(String text){log.append(text).append('\n');android.util.Log.i("SpeechFlowTest",text);}
    private String js(String code)throws Exception{
        CountDownLatch ready=new CountDownLatch(1);String[] value={null};
        runOnMainSync(()->web.evaluateJavascript(code,v->{value[0]=v;ready.countDown();}));
        if(!ready.await(15,TimeUnit.SECONDS))throw new AssertionError("WebView JavaScript callback timed out");
        return value[0];
    }
    private String text(String code)throws Exception{Object v=new JSONTokener(js(code)).nextValue();return String.valueOf(v);}
    private void waitJs(String code,long timeout)throws Exception{
        long deadline=SystemClock.elapsedRealtime()+timeout;
        while(SystemClock.elapsedRealtime()<deadline){if("true".equals(js(code)))return;SystemClock.sleep(200);}
        throw new AssertionError("Condition timed out: "+code+" | UI="+text("document.body.innerText"));
    }
    private void tap(String id)throws Exception{
        JSONObject rect=new JSONObject(text("(()=>{const e=document.getElementById("+JSONObject.quote(id)+");if(!e)throw Error('Missing '+"+JSONObject.quote(id)+");e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth});})()"));
        int[] location=new int[2];runOnMainSync(()->web.getLocationOnScreen(location));
        float scale=(float)web.getWidth()/(float)rect.getDouble("width");
        float x=location[0]+web.getPaddingLeft()+(float)rect.getDouble("x")*scale,y=location[1]+web.getPaddingTop()+(float)rect.getDouble("y")*scale;
        long t=SystemClock.uptimeMillis();sendPointerSync(MotionEvent.obtain(t,t,MotionEvent.ACTION_DOWN,x,y,0));sendPointerSync(MotionEvent.obtain(t,t+60,MotionEvent.ACTION_UP,x,y,0));
        SystemClock.sleep(200);
    }
    private void screenshot(String name)throws Exception{
        Bitmap shot=getUiAutomation().takeScreenshot();if(shot==null)return;
        try(OutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),name))){shot.compress(Bitmap.CompressFormat.PNG,100,out);}shot.recycle();
    }
    private void exercise()throws Exception{
        Intent intent=new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=startActivitySync(intent);Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
        waitJs("document.readyState==='complete'&&!!document.getElementById('engTravel')",120000);
        note("native="+getTargetContext().getPackageManager().getPackageInfo(getTargetContext().getPackageName(),0).versionName);
        note("web="+text("typeof APP_VERSION==='undefined'?'missing':APP_VERSION"));
        js("window.speechTestStatus=null;window.srNativeRequest('status').then(s=>window.speechTestStatus=s);void 0");
        waitJs("!!window.speechTestStatus",15000);
        note("native status="+text("JSON.stringify(window.speechTestStatus)"));
        note("capabilities="+text("JSON.stringify({speech:window.srNativePracticeSpeech,playback:window.srNativePracticePlayback})"));
        js("window.speechTestEvents=[];(()=>{const request=window.srNativeRequest;window.srNativeRequest=async function(action,data){const start=Date.now();window.speechTestEvents.push({action,phase:'request',at:start});try{const result=await request(action,data);window.speechTestEvents.push({action,phase:'response',ms:Date.now()-start,audioBytes:result.audioBase64?.length||0});return result;}catch(error){window.speechTestEvents.push({action,phase:'error',ms:Date.now()-start,error:error.message});throw error;}}})();void 0");
        // UI-only entry. Do not change production learning records or bypass the bridge.
        tap("engTravel");
        for(int i=0;i<5&&"true".equals(js("!!document.getElementById('featureNext')"));i++)tap("featureNext");
        waitJs("!!document.getElementById('autoMic')",30000);
        note("prompt="+text("document.querySelector('.situation').innerText"));
        tap("autoMic");
        waitJs("typeof qzRecording!=='undefined'&&qzRecording",15000);
        note("LISTENING - inject microphone audio now");screenshot("speech-listening.png");
        // Host injects an English WAV through the emulator microphone, never a JS answer.
        try{waitJs("!!document.getElementById('autoAnswer')||(/다시 말하기/.test(document.getElementById('autoMic')?.textContent||''))",60000);}
        finally{note("bridge events="+text("JSON.stringify(window.speechTestEvents)"));screenshot("speech-result.png");}
        String ui=text("document.getElementById('sprintScroll').innerText");note("result="+ui);screenshot("speech-result.png");
        if(!"true".equals(js("!!document.getElementById('autoAnswer')")))throw new AssertionError("Recording did not produce an answer: "+ui);
        String heard=text("document.getElementById('autoStat').textContent");
        note("heard/status="+heard);
        if(!ui.toLowerCase().contains("can i get some water"))throw new AssertionError("Injected phrase was not transcribed: "+ui);
    }
}
