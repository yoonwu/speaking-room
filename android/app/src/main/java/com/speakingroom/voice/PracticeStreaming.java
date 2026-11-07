package com.speakingroom.voice;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Uploads PCM as it is captured. Never opens a second microphone or keeps audio on disk. */
final class PracticeStreaming {
    interface Completion { void accept(String text,String error); }
    static final int FRAME_SAMPLES=320, QUEUE_FRAMES=128;
    private static final String ENDPOINT="https://speaking-room.thdghkstlr.workers.dev/stt";
    private final URL endpoint;
    private final long finishWaitMillis;
    private final Completion completion;
    private final ArrayBlockingQueue<byte[]> queue=new ArrayBlockingQueue<>(QUEUE_FRAMES);
    private final AtomicBoolean terminal=new AtomicBoolean();
    private final Timer deadline=new Timer("practice-stream-deadline",true);
    private volatile HttpURLConnection connection;
    private volatile boolean inputEnded;
    private Thread worker;

    PracticeStreaming(Completion completion){this(url(),7000,completion);}
    // Package-private transport and deadline injection for real loopback HTTP tests.
    PracticeStreaming(URL endpoint,long finishWaitMillis,Completion completion){this.endpoint=endpoint;this.finishWaitMillis=finishWaitMillis;this.completion=completion;}
    private static URL url(){try{return new URL(ENDPOINT);}catch(MalformedURLException e){throw new AssertionError(e);}}
    void start(){worker=new Thread(this::upload,"practice-stream-upload");worker.setDaemon(true);worker.start();}
    void append(short[] samples,int count){
        if(terminal.get()||inputEnded)return;
        if(count<=0||count>FRAME_SAMPLES||count>samples.length){complete("","녹음 전송 형식이 올바르지 않아요.",true);return;}
        byte[] bytes=new byte[count*2];for(int i=0;i<count;i++){bytes[i*2]=(byte)samples[i];bytes[i*2+1]=(byte)(samples[i]>>8);}
        // Backpressure must never stall AudioRecord. The original PCM stays in PracticeAudio.
        if(!queue.offer(bytes))complete("","음성 전송이 지연되고 있어요. 연결을 확인하고 다시 말해주세요.",true);
    }
    void finishInput(){
        if(terminal.get()||inputEnded)return;inputEnded=true;
        // Wake an idle writer immediately; if full, queued PCM already wakes it.
        queue.offer(new byte[0]);
        try{deadline.schedule(new TimerTask(){@Override public void run(){complete("","말소리 인식 응답이 늦어요. 다시 말해주세요.",true);}},finishWaitMillis);}catch(IllegalStateException ignored){}
    }
    void cancel(){if(terminal.compareAndSet(false,true)){deadline.cancel();queue.clear();abort();}}
    private void abort(){
        Thread running=worker;if(running!=null)running.interrupt();
        HttpURLConnection active=connection;
        if(active!=null){Thread close=new Thread(active::disconnect,"practice-stream-close");close.setDaemon(true);close.start();}
    }
    private void complete(String text,String error,boolean abort){
        if(!terminal.compareAndSet(false,true))return;
        deadline.cancel();queue.clear();if(abort)abort();completion.accept(text,error);
    }
    private void upload(){
        HttpURLConnection active=null;
        try{
            if(terminal.get())return;
            active=(HttpURLConnection)endpoint.openConnection();connection=active;
            if(terminal.get())return;
            active.setConnectTimeout(3000);active.setReadTimeout((int)Math.min(Integer.MAX_VALUE,finishWaitMillis+1000));
            active.setInstanceFollowRedirects(false);active.setRequestMethod("POST");active.setDoOutput(true);active.setChunkedStreamingMode(3200);
            active.setRequestProperty("Content-Type","audio/wav; codecs=audio/pcm; samplerate=16000");active.setRequestProperty("Accept","application/json");
            IOException writeFailure=null;boolean allInputWritten=false;
            try(OutputStream out=active.getOutputStream()){
                out.write(header());out.flush();
                while(!terminal.get()){
                    if(inputEnded&&queue.isEmpty()){allInputWritten=true;break;}
                    byte[] frame=queue.poll(100,TimeUnit.MILLISECONDS);
                    if(frame!=null){if(frame.length>0){out.write(frame);out.flush();}}
                    else if(inputEnded){allInputWritten=true;break;}
                }
            }catch(IOException e){writeFailure=e;}
            if(terminal.get())return;
            // Some servers answer before request EOF. Read that HTTP result even
            // if the last write failed; a valid response is more useful than a broken-pipe error.
            int status=active.getResponseCode();InputStream response=status>=200&&status<300?active.getInputStream():active.getErrorStream();
            String json=read(response);
            if(status<200||status>=300){complete("","말소리 인식 서버 오류 ("+status+"). 잠시 후 다시 말해주세요.",false);return;}
            if(writeFailure!=null&&!allInputWritten){complete("","음성 전송이 먼저 종료됐어요. 다시 말해주세요.",false);return;}
            JSONObject result=new JSONObject(json);String recognition=result.optString("RecognitionStatus","");
            if(!recognition.isEmpty()&&!recognition.equals("Success")&&!recognition.equals("NoMatch")){complete("","말소리를 인식하지 못했어요. 다시 말해주세요.",false);return;}
            String text=result.optString("DisplayText","").trim();
            if(text.isEmpty()){JSONArray best=result.optJSONArray("NBest");if(best!=null&&best.length()>0){JSONObject first=best.optJSONObject(0);if(first!=null)text=first.optString("Display",first.optString("Lexical","")).trim();}}
            complete(text,null,false);
        }catch(Exception e){if(!terminal.get())complete("","말소리 인식 연결을 확인해주세요. 다시 말해주세요.",true);}
        finally{if(active!=null)active.disconnect();connection=null;}
    }
    static byte[] header(){
        byte[] header=PracticeAudio.wav(new byte[0]);ByteBuffer view=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
        view.putInt(4,0x7fffffff);view.putInt(40,0x7fffffff-36);return header;
    }
    private static String read(InputStream input)throws IOException{
        if(input==null)return "";try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1){if(out.size()+count>65536)throw new IOException("Speech response too large");out.write(buffer,0,count);}return new String(out.toByteArray(),StandardCharsets.UTF_8);
        }
    }
}
