package com.speakingroom.voice;
import org.junit.Test;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import static org.junit.Assert.*;

public class WebReleaseTest {
    private JSONObject descriptor() throws Exception {
        byte[] bytes="hello".getBytes(StandardCharsets.UTF_8);
        JSONObject entry=new JSONObject().put("size",bytes.length).put("sha256",WebRelease.hash(bytes));
        return new JSONObject().put("format",1).put("bridgeVersion",1).put("minimumNativeVersion",4).put("revision","a".repeat(40)).put("files",new JSONObject().put("index.html",entry).put("android-native.js",entry));
    }
    @Test public void corruptedOrPartialReleaseCannotActivate() throws Exception {
        WebRelease r=new WebRelease(descriptor().toString(),4);
        Path dir=Files.createTempDirectory("web-release-test");
        try {
            Files.write(dir.resolve("index.html"),"hello".getBytes(StandardCharsets.UTF_8));assertFalse(r.validDirectory(dir.toFile()));
            Files.write(dir.resolve("android-native.js"),"hello".getBytes(StandardCharsets.UTF_8));assertTrue(r.validDirectory(dir.toFile()));
            Files.write(dir.resolve("index.html"),"jello".getBytes(StandardCharsets.UTF_8));assertFalse(r.validDirectory(dir.toFile()));
        } finally {Files.deleteIfExists(dir.resolve("index.html"));Files.deleteIfExists(dir.resolve("android-native.js"));Files.delete(dir);}
    }
    @Test public void incompatibleNativeOrBridgeIsRejected() throws Exception {
        for(JSONObject m:new JSONObject[]{descriptor().put("minimumNativeVersion",5),descriptor().put("bridgeVersion",2),descriptor().put("revision","main")}){
            try {new WebRelease(m.toString(),4);fail("Accepted incompatible release");}catch(java.io.IOException expected){}
        }
    }
    @Test public void traversalAndNativeCodeAreRejected() throws Exception {
        for(String name:new String[]{"../index.html","/index.html","payload.dex","payload.jar","x.so","foo/bar.js","%2e%2e.js"}){
            JSONObject m=descriptor();m.getJSONObject("files").put(name,m.getJSONObject("files").getJSONObject("index.html"));
            try{new WebRelease(m.toString(),4);fail("Accepted unsafe asset");}catch(java.io.IOException expected){}
        }
    }
    @Test public void sizeAndHashAreBothVerified() throws Exception {
        WebRelease r=new WebRelease(descriptor().toString(),4);
        assertFalse(r.matches("index.html","jello".getBytes(StandardCharsets.UTF_8)));
        assertFalse(r.matches("index.html","hello!".getBytes(StandardCharsets.UTF_8)));
        assertTrue(r.matches("index.html","hello".getBytes(StandardCharsets.UTF_8)));
    }
}
