package com.speakingroom.voice;

import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

public class PracticeStreamingTest {
    private static final class Result implements PracticeStreaming.Completion {
        final CountDownLatch ready=new CountDownLatch(1);final AtomicInteger calls=new AtomicInteger();volatile String text,error;
        public void accept(String text,String error){this.text=text;this.error=error;calls.incrementAndGet();ready.countDown();}
        void await()throws Exception{assertTrue("HTTP recognition completed",ready.await(3,TimeUnit.SECONDS));}
    }
    interface Handler{void accept(Exchange exchange)throws IOException;}
    // Plain loopback HTTP keeps the test independent of Android's reduced JDK
    // boot classpath, which deliberately excludes com.sun.net.httpserver.
    private static final class Server implements AutoCloseable {
        final ServerSocket server;final ExecutorService executor;final List<Socket> sockets=Collections.synchronizedList(new ArrayList<>());
        Server(Handler handler)throws IOException{
            server=new ServerSocket(0,10,InetAddress.getByName("127.0.0.1"));executor=Executors.newCachedThreadPool(r->{Thread t=new Thread(r,"speech-test-http");t.setDaemon(true);return t;});
            executor.execute(()->{while(!server.isClosed())try{Socket socket=server.accept();sockets.add(socket);executor.execute(()->{try{socket.setSoTimeout(3000);handler.accept(new Exchange(socket));}catch(IOException ignored){}finally{try{socket.close();}catch(IOException ignored){}}});}catch(IOException e){break;}});
        }
        URL url()throws Exception{return new URL("http://127.0.0.1:"+server.getLocalPort()+"/stt");}
        public void close(){try{server.close();}catch(IOException ignored){}synchronized(sockets){for(Socket socket:sockets)try{socket.close();}catch(IOException ignored){}}executor.shutdownNow();}
    }
    private static String line(InputStream in)throws IOException{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();int current;while((current=in.read())!=-1){if(current=='\n')return new String(bytes.toByteArray(),StandardCharsets.US_ASCII).replace("\r","");bytes.write(current);if(bytes.size()>8192)throw new IOException("Header too large");}throw new EOFException();
    }
    private static final class Exchange {
        final Socket socket;final Map<String,String> headers=new HashMap<>();final InputStream body;
        Exchange(Socket socket)throws IOException{
            this.socket=socket;InputStream in=new BufferedInputStream(socket.getInputStream());assertTrue(line(in).startsWith("POST /stt "));String row;
            while(!(row=line(in)).isEmpty()){int colon=row.indexOf(':');if(colon>0)headers.put(row.substring(0,colon).toLowerCase(Locale.ROOT),row.substring(colon+1).trim());}
            assertEquals("chunked",headers.get("transfer-encoding"));body=new InputStream(){int remaining;boolean ended;
                boolean chunk()throws IOException{if(ended)return false;if(remaining==0){String size=line(in);int semi=size.indexOf(';');remaining=Integer.parseInt(semi<0?size:size.substring(0,semi),16);if(remaining==0){while(!line(in).isEmpty()){}ended=true;return false;}}return true;}
                public int read()throws IOException{byte[] one=new byte[1];return read(one,0,1)==-1?-1:one[0]&255;}
                public int read(byte[] b,int off,int len)throws IOException{if(len==0)return 0;if(!chunk())return -1;int n=in.read(b,off,Math.min(len,remaining));if(n<0)throw new EOFException();remaining-=n;if(remaining==0&&!line(in).isEmpty())throw new IOException("Bad chunk boundary");return n;}
            };
        }
        InputStream getRequestBody(){return body;}
        String header(String name){return headers.get(name.toLowerCase(Locale.ROOT));}
        void close()throws IOException{socket.close();}
    }
    private static void reply(Exchange exchange,int status,String body)throws IOException{
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);OutputStream out=exchange.socket.getOutputStream();out.write(("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(bytes);out.flush();exchange.close();
    }
    private static byte[] read(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}
    private static short[] frame(int offset){short[] f=new short[320];for(int i=0;i<f.length;i++)f[i]=(short)(offset+i*31);return f;}

    @Test public void actualHttpReceivesPcmBeforeCaptureEndsAndReturnsTheRealTranscriptWithUnchangedReplay()throws Exception{
        CountDownLatch pcmArrived=new CountDownLatch(1);AtomicBoolean eof=new AtomicBoolean();AtomicReference<byte[]> uploaded=new AtomicReference<>();AtomicReference<String> contentType=new AtomicReference<>();
        try(Server server=new Server(exchange->{
            contentType.set(exchange.header("Content-Type"));
            ByteArrayOutputStream all=new ByteArrayOutputStream();InputStream in=exchange.getRequestBody();byte[] first=in.readNBytes(684);all.write(first);pcmArrived.countDown();all.write(read(in));uploaded.set(all.toByteArray());eof.set(true);reply(exchange,200,"{\"RecognitionStatus\":\"Success\",\"DisplayText\":\"Can I get water?\"}");
        })){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),2000,result);PracticeAudio clip=new PracticeAudio(0);stream.start();
            short[] first=frame(123),copy=first.clone();clip.append(first,first.length,20);stream.append(first,first.length);
            assertTrue("PCM arrived during recording",pcmArrived.await(2,TimeUnit.SECONDS));assertFalse("Capture has not sent EOF",eof.get());assertEquals(0,result.calls.get());assertArrayEquals(copy,first);
            for(int i=1;i<6;i++){short[] next=frame(i*1000);clip.append(next,next.length,(i+1)*20);stream.append(next,next.length);}
            byte[] replay=PracticeAudio.wav(clip.pcm());stream.finishInput();result.await();
            assertNull(result.error);assertEquals("Can I get water?",result.text);assertEquals(1,result.calls.get());assertEquals("audio/wav; codecs=audio/pcm; samplerate=16000",contentType.get());
            byte[] wire=uploaded.get();assertArrayEquals(PracticeStreaming.header(),Arrays.copyOf(wire,44));assertArrayEquals(Arrays.copyOfRange(replay,44,replay.length),Arrays.copyOfRange(wire,44,wire.length));
            ByteBuffer header=ByteBuffer.wrap(wire).order(ByteOrder.LITTLE_ENDIAN);assertEquals(0x7fffffff,header.getInt(4));assertEquals(0x7fffffff-36,header.getInt(40));assertEquals(16000,header.getInt(24));assertEquals(16,header.getShort(34));assertEquals(1,header.getShort(22));
            stream.cancel();assertEquals(1,result.calls.get());
        }
    }
    @Test public void anHttpFailureKeepsItsSpecificStatusAndNeverInventsARecognizedAnswer()throws Exception{
        try(Server server=new Server(exchange->{read(exchange.getRequestBody());reply(exchange,503,"{\"error\":\"unavailable\"}");})){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),1000,result);stream.start();stream.append(frame(100),320);stream.finishInput();result.await();assertEquals("",result.text);assertTrue(result.error.contains("503"));assertEquals(1,result.calls.get());
        }
    }
    @Test public void actualHttpUsesRawLexicalWordsAndNeverRepairsAnEmptyRawAnswerFromDisplay()throws Exception{
        for(String raw:new String[]{"can i change seat",""}){
            String body=new org.json.JSONObject().put("RecognitionStatus","Success").put("DisplayText","Can I change this seat?")
                .put("NBest",new org.json.JSONArray().put(new org.json.JSONObject().put("Lexical",raw).put("Display","Can I change this seat?"))).toString();
            try(Server server=new Server(exchange->{read(exchange.getRequestBody());reply(exchange,200,body);})){
                Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),1000,result);stream.start();stream.append(frame(10),320);stream.finishInput();result.await();assertNull(result.error);assertEquals(raw,result.text);assertEquals(1,result.calls.get());
            }
        }
    }
    @Test public void aSuccessfulNoMatchDoesNotInventTextOrRetryTheRequest()throws Exception{
        AtomicInteger requests=new AtomicInteger();try(Server server=new Server(exchange->{requests.incrementAndGet();read(exchange.getRequestBody());reply(exchange,200,"{\"RecognitionStatus\":\"NoMatch\",\"DisplayText\":\"\"}");})){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),1000,result);stream.start();stream.append(frame(10),320);stream.finishInput();result.await();assertNull(result.error);assertEquals("",result.text);assertEquals(1,requests.get());
        }
    }
    @Test public void anEarlySuccessfulResponseCannotTurnAnIncompleteUploadIntoACorrectAnswer()throws Exception{
        CountDownLatch answered=new CountDownLatch(1);
        try(Server server=new Server(exchange->{exchange.getRequestBody().readNBytes(684);reply(exchange,200,"{\"RecognitionStatus\":\"Success\",\"DisplayText\":\"partial answer\"}");answered.countDown();})){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),1000,result);stream.start();stream.append(frame(1),320);assertTrue(answered.await(2,TimeUnit.SECONDS));
            for(int i=0;i<50&&result.calls.get()==0;i++){stream.append(frame(i),320);Thread.sleep(10);}
            stream.finishInput();result.await();assertEquals("",result.text);assertNotNull("An incomplete request must fail",result.error);assertEquals(1,result.calls.get());
        }
    }
    @Test public void aProviderRecognitionErrorIsNotAcceptedAsAnEmptySuccessfulTranscript()throws Exception{
        try(Server server=new Server(exchange->{read(exchange.getRequestBody());reply(exchange,200,"{\"RecognitionStatus\":\"Error\",\"DisplayText\":\"\"}");})){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),1000,result);stream.start();stream.append(frame(1),320);stream.finishInput();result.await();assertEquals("",result.text);assertNotNull(result.error);assertEquals(1,result.calls.get());
        }
    }
    @Test public void deadlineAfterCaptureReleasesTheResultAndIgnoresALateServerAnswer()throws Exception{
        CountDownLatch body=new CountDownLatch(1),release=new CountDownLatch(1);
        try(Server server=new Server(exchange->{read(exchange.getRequestBody());body.countDown();try{release.await(2,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}try{reply(exchange,200,"{\"DisplayText\":\"too late\"}");}catch(IOException ignored){}})){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),150,result);stream.start();stream.append(frame(1),320);assertEquals(0,result.calls.get());stream.finishInput();result.await();
            assertTrue(result.error.contains("늦어요"));assertEquals("",result.text);release.countDown();Thread.sleep(100);assertEquals(1,result.calls.get());stream.cancel();
        }finally{release.countDown();}
    }
    @Test public void cancellationStopsAnInFlightUploadWithoutDeliveringAResult()throws Exception{
        CountDownLatch first=new CountDownLatch(1),release=new CountDownLatch(1);
        try(Server server=new Server(exchange->{exchange.getRequestBody().readNBytes(684);first.countDown();try{release.await(2,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}exchange.close();})){
            Result result=new Result();PracticeStreaming stream=new PracticeStreaming(server.url(),500,result);stream.start();stream.append(frame(1),320);assertTrue(first.await(2,TimeUnit.SECONDS));stream.cancel();stream.cancel();stream.finishInput();release.countDown();assertFalse(result.ready.await(200,TimeUnit.MILLISECONDS));assertEquals(0,result.calls.get());
        }finally{release.countDown();}
    }
    @Test public void aFullTransportQueueFailsWithoutBlockingOrMutatingFurtherCapture()throws Exception{
        Result result=new Result();PracticeStreaming stream=new PracticeStreaming(new URL("http://127.0.0.1:1/stt"),1000,result);short[] samples=frame(7),original=samples.clone();
        for(int i=0;i<PracticeStreaming.QUEUE_FRAMES;i++)stream.append(samples,samples.length);assertEquals(0,result.calls.get());
        stream.append(samples,samples.length);result.await();assertTrue(result.error.contains("전송"));assertEquals("",result.text);assertArrayEquals(original,samples);
        PracticeAudio replay=new PracticeAudio(0);for(int i=0;i<500;i++){replay.append(samples,samples.length,(i+1)*20L);stream.append(samples,samples.length);}assertEquals(320000,replay.pcm().length);assertEquals(1,result.calls.get());stream.cancel();
    }
}
