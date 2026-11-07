package com.speakingroom.voice;

import com.microsoft.cognitiveservices.speech.*;
import com.microsoft.cognitiveservices.speech.audio.*;
import java.net.URI;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Official streaming SDK, using the existing single AudioRecord PCM stream. */
final class PracticeRealtime {
    interface Completion{void accept(String text,String error);}
    interface Trace{void event(String phase,long offset,String text);}
    private static final String ENDPOINT="wss://speaking-room.thdghkstlr.workers.dev/practice-realtime?language=en-US&format=detailed";
    static final int QUEUE_FRAMES=256;
    private final ArrayBlockingQueue<byte[]> queue=new ArrayBlockingQueue<>(QUEUE_FRAMES);
    private final AtomicBoolean terminal=new AtomicBoolean();
    private final AtomicBoolean started=new AtomicBoolean();
    private final CountDownLatch finished=new CountDownLatch(1);
    private final Timer deadline=new Timer("practice-realtime-deadline",true);
    private final PracticeCompletionPolicy policy;
    private final PracticeInputCompletion inputCompletion=new PracticeInputCompletion();
    private final Completion completion;
    private final Runnable completePhrase;
    private final Runnable prepared;
    private final long finishWaitMillis;
    private volatile boolean inputEnded;
    private TimerTask preparationDeadline;
    private Thread worker;
    private volatile Trace trace;
    PracticeRealtime(int expectedWords,Completion completion,Runnable completePhrase){this(expectedWords,7000,completion,completePhrase,null);}
    PracticeRealtime(int expectedWords,Completion completion,Runnable completePhrase,Runnable prepared){this(expectedWords,7000,completion,completePhrase,prepared);}
    PracticeRealtime(int expectedWords,long finishWaitMillis,Completion completion,Runnable completePhrase){this(expectedWords,finishWaitMillis,completion,completePhrase,null);}
    PracticeRealtime(int expectedWords,long finishWaitMillis,Completion completion,Runnable completePhrase,Runnable prepared){this.policy=new PracticeCompletionPolicy(expectedWords);this.finishWaitMillis=finishWaitMillis;this.completion=completion;this.completePhrase=completePhrase;this.prepared=prepared;}
    int heardWords(){return policy.heardWords();}
    void setTrace(Trace trace){this.trace=trace;}
    private void trace(String phase,long offset,String text){Trace listener=trace;if(listener!=null)try{listener.event(phase,offset,text);}catch(RuntimeException ignored){}}
    void start(){
        if(terminal.get()||!started.compareAndSet(false,true))return;
        preparationDeadline=new TimerTask(){@Override public void run(){complete("","실시간 음성 인식 준비가 늦어요. 다시 말해주세요.");}};
        try{deadline.schedule(preparationDeadline,5000);}catch(IllegalStateException ignored){return;}
        worker=new Thread(this::recognize,"practice-realtime-upload");worker.setDaemon(true);worker.start();
    }
    void append(short[] samples,int count){
        if(terminal.get()||inputEnded)return;
        if(count<=0||count>320||count>samples.length){complete("","녹음 전송 형식이 올바르지 않아요.");return;}
        byte[] bytes=new byte[count*2];for(int i=0;i<count;i++){bytes[i*2]=(byte)samples[i];bytes[i*2+1]=(byte)(samples[i]>>8);}
        if(!queue.offer(bytes))complete("","음성 전송이 지연되고 있어요. 다시 말해주세요.");
    }
    void finishInput(){
        if(terminal.get()||inputEnded)return;inputEnded=true;trace("input-ended",0,"");queue.offer(new byte[0]);
        try{deadline.schedule(new TimerTask(){@Override public void run(){complete("","말소리 인식 응답이 늦어요. 다시 말해주세요.");}},finishWaitMillis);}catch(IllegalStateException ignored){}
    }
    void cancel(){if(terminal.compareAndSet(false,true)){deadline.cancel();queue.clear();finished.countDown();Thread running=worker;if(running!=null)running.interrupt();}}
    private void complete(String text,String error){
        if(!terminal.compareAndSet(false,true))return;deadline.cancel();queue.clear();finished.countDown();
        trace(error==null?"success":"error",0,error==null?text:error);
        Thread running=worker;if(running!=null&&running!=Thread.currentThread())running.interrupt();
        completion.accept(text,error);
    }
    private void completeAfterInput(PracticeInputCompletion.Outcome outcome){
        if(outcome==PracticeInputCompletion.Outcome.SUCCESS)complete(policy.finalText(),null);
        else if(outcome==PracticeInputCompletion.Outcome.TRUNCATED)complete("","실시간 음성 인식이 일찍 종료됐어요. 다시 말해주세요.");
    }
    private void recognize(){
        SpeechConfig config=null;PushAudioInputStream push=null;AudioConfig audio=null;SpeechRecognizer recognizer=null;Connection connection=null;
        try{
            if(terminal.get())return;
            // No key/token is shipped: the fixed Worker endpoint authenticates upstream.
            config=SpeechConfig.fromEndpoint(new URI(ENDPOINT));config.setSpeechRecognitionLanguage("en-US");config.setOutputFormat(OutputFormat.Detailed);
            // Short server segments are stitched; incomplete phrases keep the local long pause.
            config.setProperty(PropertyId.Speech_SegmentationSilenceTimeoutMs,"100");
            config.setProperty(PropertyId.SpeechServiceResponse_StablePartialResultThreshold,"1");
            config.setProperty(PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,"7000");
            push=AudioInputStream.createPushStream();audio=AudioConfig.fromStreamInput(push);recognizer=new SpeechRecognizer(config,audio);
            CountDownLatch connected=new CountDownLatch(1);connection=Connection.fromRecognizer(recognizer);
            connection.connected.addEventListener((sender,event)->{trace("connected",0,"");connected.countDown();});
            recognizer.recognizing.addEventListener((sender,event)->{if(!terminal.get()){String text=transcript(event.getResult());policy.recognizing(event.getResult().getOffset().longValue(),text);trace("partial",event.getResult().getOffset().longValue(),text);}});
            recognizer.recognized.addEventListener((sender,event)->{
                if(terminal.get()||event.getResult().getReason()!=ResultReason.RecognizedSpeech)return;
                String text=transcript(event.getResult());policy.recognized(event.getResult().getOffset().longValue(),text);
                trace("final",event.getResult().getOffset().longValue(),text);
                if(policy.finalComplete()&&!inputEnded&&completePhrase!=null)completePhrase.run();
            });
            recognizer.canceled.addEventListener((sender,event)->{
                if(terminal.get())return;
                if(event.getReason()==CancellationReason.Error)complete("","실시간 음성 인식 연결을 확인해주세요. 다시 말해주세요.");
                else completeAfterInput(inputCompletion.serviceStopped());
            });
            recognizer.sessionStopped.addEventListener((sender,event)->{
                if(!terminal.get())completeAfterInput(inputCompletion.serviceStopped());
            });
            recognizer.startContinuousRecognitionAsync().get(5,TimeUnit.SECONDS);
            if(!connected.await(5,TimeUnit.SECONDS))throw new TimeoutException("Speech connection was not ready");
            if(terminal.get())return;preparationDeadline.cancel();trace("prepared",0,"");if(prepared!=null)prepared.run();
            while(!terminal.get()){
                if(inputEnded&&queue.isEmpty())break;
                byte[] frame=queue.poll(100,TimeUnit.MILLISECONDS);if(frame!=null&&frame.length>0)push.write(frame);
            }
            if(!terminal.get()){
                // finishInput alone is insufficient: queued PCM must reach the SDK first.
                inputCompletion.inputDrained();
                // A synchronous end event from close waits for a successful EOF send.
                push.close();push=null;completeAfterInput(inputCompletion.eofSent());
                finished.await(finishWaitMillis+1000,TimeUnit.MILLISECONDS);if(!terminal.get())complete("","말소리 인식 응답이 늦어요. 다시 말해주세요.");
            }
        }catch(Exception|LinkageError failure){if(!terminal.get())complete("","실시간 음성 인식을 시작하지 못했어요. 앱과 연결을 확인해주세요.");}
        finally{
            if(recognizer!=null){try{recognizer.stopContinuousRecognitionAsync().get(1,TimeUnit.SECONDS);}catch(Exception ignored){}try{recognizer.close();}catch(Exception ignored){}}
            if(connection!=null)try{connection.close();}catch(Exception ignored){}
            if(push!=null)try{push.close();}catch(Exception ignored){}
            if(audio!=null)try{audio.close();}catch(Exception ignored){}
            if(config!=null)try{config.close();}catch(Exception ignored){}
        }
    }
    private static String transcript(SpeechRecognitionResult result){
        String json=result.getProperties().getProperty(PropertyId.SpeechServiceResponse_JsonResult);
        return PracticeTranscript.fromJson(json,result.getText());
    }
}
