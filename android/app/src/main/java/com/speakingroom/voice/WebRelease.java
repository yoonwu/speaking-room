package com.speakingroom.voice;

import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Strict, bounded release descriptor. Only web assets, never native code. */
final class WebRelease {
    final String revision;
    final JSONObject files;
    WebRelease(String json, int nativeVersion) throws Exception {
        JSONObject m = new JSONObject(json);
        if (m.getInt("format") != 1 || m.getInt("bridgeVersion") != 1 || m.getInt("minimumNativeVersion") > nativeVersion) throw new IOException("App update required");
        revision = m.getString("revision");
        if (!revision.matches("[a-f0-9]{40}")) throw new IOException("Invalid revision");
        files = m.getJSONObject("files");
        if (files.length() > 80 || !files.has("index.html") || !files.has("android-native.js")) throw new IOException("Invalid files");
        long total = 0;
        for (String name : names()) {
            if (!safeName(name)) throw new IOException("Invalid path");
            JSONObject f = files.getJSONObject(name);
            int size = f.getInt("size");
            if (size < 1 || size > 8000000 || !f.getString("sha256").matches("[a-f0-9]{64}")) throw new IOException("Invalid file");
            total += size;
        }
        if (total > 24000000) throw new IOException("Release too large");
    }
    static boolean safeName(String name) { return name.matches("[A-Za-z0-9_-]+\\.(html|js|css|json|png|webmanifest)"); }
    List<String> names() { List<String> out = new ArrayList<>(); files.keys().forEachRemaining(out::add); Collections.sort(out); return out; }
    boolean matches(String name, byte[] bytes) throws Exception {
        JSONObject f = files.getJSONObject(name);
        return bytes.length == f.getInt("size") && hash(bytes).equals(f.getString("sha256"));
    }
    boolean validDirectory(File dir) throws Exception {
        for (String name : names()) {
            File file = new File(dir, name);
            if (!file.isFile() || file.length() != files.getJSONObject(name).getInt("size") || !matches(name, read(file, 8000000))) return false;
        }
        return true;
    }
    static String hash(byte[] bytes) throws Exception { StringBuilder out=new StringBuilder(); for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes)) out.append(String.format(Locale.ROOT,"%02x",b & 255)); return out.toString(); }
    static byte[] read(File file, int limit) throws IOException { try (InputStream in = new FileInputStream(file)) { return read(in, limit); } }
    static byte[] read(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) != -1) { if (out.size() + n > limit) throw new IOException("File too large"); out.write(b, 0, n); }
        return out.toByteArray();
    }
    static String text(File file) throws IOException { return new String(read(file, 64000), StandardCharsets.UTF_8); }
}
