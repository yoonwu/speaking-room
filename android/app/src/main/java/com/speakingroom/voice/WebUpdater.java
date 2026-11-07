package com.speakingroom.voice;

import android.content.Context;
import android.util.AtomicFile;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.net.ssl.HttpsURLConnection;

/** Owner-controlled GitHub releases, downloaded completely before activation. */
final class WebUpdater {
    private static final Object LOCK=new Object();
    static final String BASE = "https://raw.githubusercontent.com/yoonwu/speaking-room/";
    private final File root;
    private final android.content.res.AssetManager bundled;
    private final int version;
    private volatile File active;
    private volatile WebRelease release;
    private volatile String status = "bundled";
    WebUpdater(Context context, int version) { root = new File(context.getFilesDir(), "web-releases"); bundled=context.getAssets(); this.version = version; }
    String status() { return status; }
    String revision() { return release == null ? "bundled" : release.revision; }
    // Only before the first page loads: keep the active release and one older snapshot.
    void pruneBeforeLoad() {
        File[] dirs=root.listFiles(File::isDirectory); if(dirs==null)return;
        Arrays.sort(dirs,Comparator.comparingLong(File::lastModified).reversed()); int kept=0;
        for(File d:dirs) if(!d.equals(active) && ++kept>1) clear(d);
    }
    void selectSaved() {
        try {
            AtomicFile pointer = new AtomicFile(new File(root, "current.json"));
            String raw; try(InputStream in=pointer.openRead()) { raw=new String(WebRelease.read(in,64000),StandardCharsets.UTF_8); }
            WebRelease r = new WebRelease(raw, version); File dir = new File(root, r.revision);
            if (r.validDirectory(dir)) { active = dir; release = r; status = "saved"; }
        } catch (Exception ignored) { /* Packaged UI is always available. */ }
    }
    // Called off the UI thread, with an overall deadline. Does not modify a live page.
    void refresh() {
        synchronized(LOCK) { refreshLocked(); }
    }
    private void refreshLocked() {
        selectSaved();
        long deadline = System.nanoTime() + 20000000000L;
        File staging = null;
        try {
            String raw = new String(fetch(BASE + "android-web-live/android-web-release.json?cb=" + System.currentTimeMillis(),64000,deadline),StandardCharsets.UTF_8);
            WebRelease r = new WebRelease(raw, version);
            if (release != null && release.revision.equals(r.revision)) { status = "latest"; return; }
            root.mkdirs(); staging = new File(root, "pending"); clear(staging); staging.mkdirs();
            for (String name : r.names()) {
                byte[] bytes = reuse(r,name);
                if(bytes==null) bytes = fetch(BASE + r.revision + "/" + name, r.files.getJSONObject(name).getInt("size"), deadline);
                if (!r.matches(name,bytes)) throw new IOException("Integrity failure");
                try(OutputStream out=new FileOutputStream(new File(staging,name))) { out.write(bytes); }
            }
            File target = new File(root,r.revision);
            if (target.exists()) clear(target);
            if (!staging.renameTo(target)) throw new IOException("Activation failed");
            AtomicFile pointer = new AtomicFile(new File(root,"current.json")); FileOutputStream out = null;
            try { out=pointer.startWrite(); out.write(raw.getBytes(StandardCharsets.UTF_8)); pointer.finishWrite(out); }
            catch(Exception e) { if(out!=null) pointer.failWrite(out); throw e; }
            active=target; release=r; status="updated";
            // Older snapshots may still be displayed by a live Activity; never delete them here.
        } catch (Exception ignored) { status=active==null?"offline-bundled":"offline-saved"; }
        finally { if(staging!=null && staging.exists()) clear(staging); }
    }
    private byte[] reuse(WebRelease next,String name) {
        try { if(active!=null) { File file=new File(active,name); if(file.isFile()) { byte[] bytes=WebRelease.read(file,8000000); if(next.matches(name,bytes))return bytes; } } }catch(Exception ignored){}
        try(InputStream in=bundled.open(name)) { byte[] bytes=WebRelease.read(in,8000000); if(next.matches(name,bytes))return bytes; }catch(Exception ignored){}
        return null;
    }
    static byte[] fetch(String url, int limit, long deadline) throws Exception {
        int remaining=(int)((deadline-System.nanoTime())/1000000L);
        if(remaining<=0) throw new IOException("Update timeout");
        HttpsURLConnection c=(HttpsURLConnection)new URL(url).openConnection();
        c.setInstanceFollowRedirects(false); c.setConnectTimeout(Math.min(3000,remaining)); c.setReadTimeout(Math.min(5000,remaining)); c.setRequestProperty("Cache-Control","no-cache");
        try {
            if(c.getResponseCode()!=200) throw new IOException("Release unavailable");
            try(InputStream in=c.getInputStream()) {
                ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] b=new byte[8192]; int n;
                while((n=in.read(b))!=-1) { if(System.nanoTime()>deadline || out.size()+n>limit) throw new IOException("Update limit"); out.write(b,0,n); }
                return out.toByteArray();
            }
        } finally { c.disconnect(); }
    }
    WebResourceResponse handle(String name) {
        File dir=active; if(dir==null) return null;
        try {
            if(!WebRelease.safeName(name) || !release.files.has(name)) return missing();
            String type=name.endsWith(".html")?"text/html":name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".png")?"image/png":"application/json";
            return new WebResourceResponse(type,"UTF-8",new FileInputStream(new File(dir,name)));
        } catch(Exception ignored) { return missing(); }
    }
    private static WebResourceResponse missing() { return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0])); }
    private static void clear(File dir) { File[] files=dir.listFiles(); if(files!=null) for(File f:files) if(f.isFile()) f.delete(); dir.delete(); }
}
