package com.speakingroom.voice;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;

/** Official SIWC public-client flow. All credentials stay in private Keystore-encrypted storage. */
final class PlanClient {
    private static PlanClient instance;
    static synchronized PlanClient get(Context context) { if (instance == null) instance = new PlanClient(context); return instance; }
    static final String AUTH = "https://auth.openai.com";
    static final String RESOURCE = "https://api.openai.com/v1";
    private static final String SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    private final Context context;
    private final SharedPreferences prefs;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Object refreshLock = new Object();
    private final PlanConnection connection;
    private volatile ServerSocket callback;
    private JSONObject account;

    interface LoginListener { void openBrowser(String url); void finished(boolean success, String message); }
    private PlanClient(Context context) {
        this.context = context.getApplicationContext();
        prefs = context.getSharedPreferences("plan", Context.MODE_PRIVATE);
        SharedPreferences nativePrefs = context.getSharedPreferences("native", Context.MODE_PRIVATE);
        connection = new PlanConnection(new PlanConnection.Store() {
            public String get(String key) { return nativePrefs.getString(key, ""); }
            public boolean verified(String model, String id, String label) {
                return nativePrefs.edit().putString("model", model).putString("modelAccountId", id).putString("account", label).commit();
            }
        });
        try { account = load(); } catch (Exception e) { account = null; }
        if (!prefs.contains("host")) prefs.edit().putString("host", "urn:uuid:" + UUID.randomUUID()).apply();
    }
    synchronized boolean connected() { return account != null && account.has("access_token"); }
    synchronized String label() { return account == null ? "연결 안 됨" : account.optString("email", "ChatGPT 계정") + " · " + account.optString("client_id"); }
    synchronized String accountId() { return account == null ? "" : account.optString("client_id"); }
    synchronized boolean ready() { return connection.ready(connected(), accountId(), label()); }
    String model() { return connection.model(); }
    int catalogSelection(JSONArray data) { return connection.catalogSelection(data); }
    synchronized void verifiedModel(String id, String model) throws Exception {
        if (!connected() || !id.equals(accountId())) throw new IOException("계정이 변경되었어요. 선택한 계정에서 다시 연결해주세요.");
        connection.verified(model, id, label());
    }
    void testModel(String model) throws Exception {
        String id = accountId();
        respond(model, "Reply with exactly: Ready.", new JSONArray().put(new JSONObject().put("role", "user").put("content", "Connection test.")));
        verifiedModel(id, model);
    }
    synchronized void clearUnusableSession() throws Exception {
        if (account == null) return;
        JSONObject mapping = new JSONObject().put("client_id", account.getString("client_id")).put("subject", account.optString("subject")).put("email", account.optString("email"));
        save(mapping); account = mapping;
    }
    synchronized JSONArray savedAccounts() throws Exception {
        JSONObject stored = loadRaw(); JSONArray result = new JSONArray();
        if (stored == null) return result;
        JSONObject registrations = stored.optJSONObject("registrations");
        if (registrations == null) return result;
        Iterator<String> keys = registrations.keys();
        while (keys.hasNext()) { JSONObject a = registrations.getJSONObject(keys.next()); result.put(new JSONObject().put("client_id", a.getString("client_id")).put("email", a.optString("email", "ChatGPT 계정"))); }
        return result;
    }
    synchronized void selectAccount(String id) throws Exception {
        JSONObject a = loadRaw().getJSONObject("registrations").getJSONObject(id);
        save(a); account = a;
    }

    void login(boolean newAccount, LoginListener listener) {
        cancelLogin();
        io.execute(() -> {
            ServerSocket server = null;
            try {
                JSONObject old;
                synchronized (this) { old = newAccount || account == null ? null : new JSONObject(account.toString()); }
                String client = old == null ? "dynamic_agent_client" : old.getString("client_id");
                String state = random(), nonce = random(), verifier = random();
                server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
                server.setSoTimeout(300000);
                callback = server;
                String redirect = "http://127.0.0.1:" + server.getLocalPort() + "/auth/callback";
                Uri.Builder url = Uri.parse(AUTH + "/api/accounts/authorize").buildUpon()
                    .appendQueryParameter("client_id", client).appendQueryParameter("ext_agent_host_id", prefs.getString("host", ""))
                    .appendQueryParameter("response_type", "code").appendQueryParameter("redirect_uri", redirect)
                    .appendQueryParameter("scope", SCOPES).appendQueryParameter("resource", RESOURCE)
                    .appendQueryParameter("state", state).appendQueryParameter("nonce", nonce)
                    .appendQueryParameter("code_challenge_method", "S256")
                    .appendQueryParameter("code_challenge", b64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))));
                if (old == null) url.appendQueryParameter("agent_name_hint", "3초영어");
                else if (old.has("id_token")) url.appendQueryParameter("id_token_hint", old.getString("id_token"));
                listener.openBrowser(url.build().toString());
                Uri incoming = null;
                long deadline = System.currentTimeMillis() + 300000;
                while (incoming == null && System.currentTimeMillis() < deadline) {
                    try (Socket socket = server.accept()) {
                        socket.setSoTimeout(3000);
                        BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                        String line = reader.readLine();
                        if (line == null || line.length() > 8192) continue;
                        String[] request = line.split(" ");
                        Uri candidate = request.length >= 2 ? Uri.parse("http://127.0.0.1" + request[1]) : null;
                        boolean valid = candidate != null && "/auth/callback".equals(candidate.getPath()) && state.equals(candidate.getQueryParameter("state"));
                        String body = valid ? "로그인 응답을 받았습니다. 앱에서 연결을 확인하고 있습니다. 3초영어로 돌아가주세요." : "Invalid callback.";
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        OutputStream out = socket.getOutputStream();
                        out.write(("HTTP/1.1 " + (valid ? "200 OK" : "400 Bad Request") + "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                        out.write(bytes); out.flush();
                        if (valid) incoming = candidate;
                    }
                }
                if (incoming == null) throw new IOException("로그인 시간 초과. 다시 연결해주세요.");
                if (incoming.getQueryParameter("error") != null) throw new IOException("로그인이 취소되었거나 권한이 거절되었습니다.");
                String issued = incoming.getQueryParameter("client_id");
                if (old == null && (issued == null || !issued.startsWith("oaiapp_"))) throw new IOException("클라이언트 등록이 완료되지 않았습니다.");
                if (old != null && issued != null && !client.equals(issued)) throw new IOException("계정 등록 정보가 일치하지 않습니다.");
                if (issued == null) issued = client;
                String code = incoming.getQueryParameter("code");
                if (code == null || code.isEmpty()) throw new IOException("로그인 코드가 없습니다.");
                JSONObject tokens = jsonRequest(AUTH + "/api/accounts/oauth/token", "POST", null,
                    form("grant_type", "authorization_code", "client_id", issued, "code", code, "code_verifier", verifier, "redirect_uri", redirect, "resource", RESOURCE), "application/x-www-form-urlencoded");
                JWTClaimsSet claims = validateIdentity(tokens.getString("id_token"), issued, nonce);
                if (old != null && !old.getString("subject").equals(claims.getSubject())) throw new IOException("연결한 계정과 다른 계정입니다. 다른 계정 연결을 선택해주세요.");
                requirePlanScope(tokens.getString("scope"));
                tokens.put("client_id", issued).put("subject", claims.getSubject()).put("email", claims.getStringClaim("email"))
                    .put("expires_at", System.currentTimeMillis() + tokens.getLong("expires_in") * 1000L);
                synchronized (this) { save(tokens); account = tokens; }
                listener.finished(true, "로그인 정보를 저장했어요. 대화 연결을 확인할게요.");
            } catch (Exception e) { listener.finished(false, "연결 실패: " + safeMessage(e)); }
            finally { if (server != null) try { server.close(); } catch (IOException ignored) {} if (callback == server) callback = null; }
        });
    }
    void cancelLogin() { ServerSocket s = callback; if (s != null) try { s.close(); } catch (IOException ignored) {} }
    private JWTClaimsSet validateIdentity(String raw, String audience, String nonce) throws Exception {
        SignedJWT jwt = SignedJWT.parse(raw);
        if (!JWSAlgorithm.RS256.equals(jwt.getHeader().getAlgorithm())) throw new SecurityException("지원하지 않는 ID 토큰 서명입니다.");
        JSONObject keys = jsonRequest(AUTH + "/.well-known/jwks.json", "GET", null, null, null);
        JWK key = JWKSet.parse(keys.toString()).getKeyByKeyId(jwt.getHeader().getKeyID());
        if (!(key instanceof RSAKey) || !jwt.verify(new RSASSAVerifier(((RSAKey) key).toRSAPublicKey()))) throw new SecurityException("ID 토큰 서명을 확인하지 못했습니다.");
        JWTClaimsSet c = jwt.getJWTClaimsSet();
        checkClaims(c, audience, nonce, System.currentTimeMillis());
        return c;
    }
    static void checkClaims(JWTClaimsSet c, String audience, String nonce, long now) throws Exception {
        if (!AUTH.equals(c.getIssuer()) || !c.getAudience().contains(audience) || c.getExpirationTime() == null || c.getExpirationTime().getTime() < now - 30000
            || !nonce.equals(c.getStringClaim("nonce")) || c.getSubject() == null || c.getSubject().isEmpty()
            || (c.getNotBeforeTime() != null && c.getNotBeforeTime().getTime() > now + 30000)) throw new SecurityException("ID 토큰의 계정·유효기간·nonce 검증에 실패했습니다.");
    }
    static void requirePlanScope(String scopes) throws IOException {
        if (!Arrays.asList(scopes.split("\\s+")).contains("chatgpt.tokens.use.direct")) throw new IOException("ChatGPT 구독 사용 권한이 없습니다.");
    }
    String accessToken() throws Exception { return accessToken(null); }
    private String accessToken(String rejectedToken) throws Exception {
        // Network IO must not hold the monitor used by the main-thread status query.
        synchronized (refreshLock) {
            JSONObject previous;
            synchronized (this) {
                if (!connected()) throw new IOException("ChatGPT 로그인이 필요해요.");
                if (account.optLong("expires_at") >= System.currentTimeMillis() + 60000
                    && !account.getString("access_token").equals(rejectedToken)) return account.getString("access_token");
                previous = new JSONObject(account.toString());
            }
            if (!previous.has("refresh_token")) throw new IOException("저장된 로그인 갱신 정보가 없어요. ChatGPT를 다시 연결해주세요.");
            JSONObject replacement;
            try {
                replacement = jsonRequest(AUTH + "/api/accounts/oauth/token", "POST", null,
                    form("grant_type", "refresh_token", "client_id", previous.getString("client_id"), "refresh_token", previous.getString("refresh_token"), "resource", RESOURCE), "application/x-www-form-urlencoded");
            } catch (OpenAiError e) {
                if (e.terminalRefresh()) synchronized (this) {
                    if (sameSession(previous)) clearUnusableSession();
                }
                throw e;
            }
            synchronized (this) {
                if (!sameSession(previous)) throw new IOException("로그인 계정이 변경되었어요. 다시 시도해주세요.");
                JSONObject next = new JSONObject(previous.toString());
                Iterator<String> names = replacement.keys();
                while (names.hasNext()) { String k = names.next(); next.put(k, replacement.get(k)); }
                requirePlanScope(next.getString("scope"));
                next.put("expires_at", System.currentTimeMillis() + replacement.getLong("expires_in") * 1000L);
                save(next); account = next;
                return next.getString("access_token");
            }
        }
    }
    private boolean sameSession(JSONObject previous) {
        return account != null && previous.optString("client_id").equals(account.optString("client_id"))
            && previous.optString("refresh_token").equals(account.optString("refresh_token"));
    }
    JSONArray models() throws Exception {
        String token = accessToken();
        JSONObject data;
        try { data = jsonRequest(RESOURCE + "/models", "GET", token, null, null); }
        catch (OpenAiError e) { if (e.status != 401) throw e; data = jsonRequest(RESOURCE + "/models", "GET", accessToken(token), null, null); }
        JSONArray available = new JSONArray();
        JSONArray all = data.getJSONArray("models");
        for (int i = 0; i < all.length(); i++) { JSONObject m = all.getJSONObject(i); if ("list".equals(m.optString("visibility"))) available.put(m); }
        if (available.length() == 0) throw new IOException("계정에서 사용할 모델이 없습니다.");
        return available;
    }
    String respond(String model, String instructions, JSONArray history) throws Exception {
        JSONObject payload = new JSONObject().put("model", model).put("instructions", instructions).put("input", history).put("store", false).put("stream", true);
        String token = accessToken();
        try { return respondWithToken(payload, token); }
        catch (OpenAiError e) { if (e.status != 401) throw e; return respondWithToken(payload, accessToken(token)); }
    }
    private String respondWithToken(JSONObject payload, String token) throws Exception {
        HttpsURLConnection c = connection(RESOURCE + "/responses", "POST", token);
        c.setReadTimeout(60000); c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Accept", "text/event-stream");
        c.setDoOutput(true);
        try {
            try (OutputStream out = c.getOutputStream()) { out.write(payload.toString().getBytes(StandardCharsets.UTF_8)); }
            if (c.getResponseCode() != 200) throw httpError(c);
            try (Reader in = new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8)) { return ResponseStream.read(in); }
        } finally { c.disconnect(); }
    }
    synchronized String logout() {
        String result = "로그아웃했습니다.";
        if (account != null && account.has("refresh_token")) {
            try {
                JSONObject discovery = jsonRequest(AUTH + "/.well-known/openid-configuration", "GET", null, null, null);
                String endpoint = discovery.getString("revocation_endpoint");
                if (!endpoint.startsWith(AUTH + "/")) throw new SecurityException();
                jsonRequest(endpoint, "POST", null, form("token", account.getString("refresh_token"), "token_type_hint", "refresh_token", "client_id", account.getString("client_id")), "application/x-www-form-urlencoded");
            } catch (Exception e) { result = "기기에서 로그아웃했습니다. 서버 권한 해제는 확인하지 못했으니 ChatGPT 설정에서 앱 연결을 해제해주세요."; }
        }
        try { if (account != null) { JSONObject mapping = new JSONObject().put("client_id", account.getString("client_id")).put("subject", account.getString("subject")).put("email", account.optString("email")); save(mapping); account = mapping; } }
        catch (Exception e) { prefs.edit().remove("credentials").apply(); account = null; }
        return result;
    }
    synchronized void forgetAccounts() {
        cancelLogin();
        prefs.edit().remove("credentials").apply();
        account = null;
    }
    private JSONObject load() throws Exception {
        JSONObject stored = loadRaw(); if (stored == null) return null;
        if (stored.has("registrations")) return stored.getJSONObject("registrations").optJSONObject(stored.optString("active"));
        return stored;
    }
    private JSONObject loadRaw() throws Exception {
        String encoded = prefs.getString("credentials", null); if (encoded == null) return null;
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOf(bytes, 12)));
        return new JSONObject(new String(cipher.doFinal(Arrays.copyOfRange(bytes, 12, bytes.length)), StandardCharsets.UTF_8));
    }
    private void save(JSONObject value) throws Exception {
        JSONObject stored = loadRaw();
        if (stored == null || !stored.has("registrations")) stored = new JSONObject().put("registrations", new JSONObject());
        String id = value.getString("client_id");
        stored.getJSONObject("registrations").put(id, value); stored.put("active", id);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bytes.write(cipher.getIV()); bytes.write(cipher.doFinal(stored.toString().getBytes(StandardCharsets.UTF_8)));
        if (!prefs.edit().putString("credentials", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)).commit()) throw new IOException("로그인 정보 저장 실패");
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("speaking-room-plan")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("speaking-room-plan", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generator.generateKey();
        }
        return (SecretKey) store.getKey("speaking-room-plan", null);
    }
    static JSONObject jsonRequest(String url, String method, String token, String body, String contentType) throws Exception {
        HttpsURLConnection c = connection(url, method, token);
        try {
            if (body != null) { c.setDoOutput(true); c.setRequestProperty("Content-Type", contentType); try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); } }
            int status = c.getResponseCode(); if (status < 200 || status >= 300) throw httpError(c);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream(); byte[] chunk = new byte[4096]; int count;
                while ((count = in.read(chunk)) != -1) { buffer.write(chunk, 0, count); if (buffer.size() > 2000000) throw new IOException("서버 응답이 너무 큽니다."); }
                String data = new String(buffer.toByteArray(), StandardCharsets.UTF_8); return data.trim().isEmpty() ? new JSONObject() : new JSONObject(data);
            }
        } finally { c.disconnect(); }
    }
    private static HttpsURLConnection connection(String url, String method, String token) throws Exception {
        HttpsURLConnection c = (HttpsURLConnection) new URL(url).openConnection(); c.setConnectTimeout(15000); c.setReadTimeout(20000); c.setInstanceFollowRedirects(false); c.setRequestMethod(method);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        return c;
    }
    private static OpenAiError httpError(HttpsURLConnection c) throws Exception {
        String code = "";
        try (InputStream in = c.getErrorStream()) {
            if (in != null) { byte[] buffer = new byte[8192]; int total = 0, count; while (total < buffer.length && (count = in.read(buffer, total, buffer.length - total)) > 0) total += count; JSONObject root = new JSONObject(new String(buffer, 0, total, StandardCharsets.UTF_8)); JSONObject error = root.optJSONObject("error"); code = error == null ? root.optString("error") : error.optString("code"); }
        } catch (Exception ignored) {}
        return new OpenAiError(c.getResponseCode(), code);
    }
    static String form(String... items) throws Exception { StringBuilder b = new StringBuilder(); for (int i = 0; i < items.length; i += 2) { if (i > 0) b.append('&'); b.append(URLEncoder.encode(items[i], "UTF-8")).append('=').append(URLEncoder.encode(items[i + 1], "UTF-8")); } return b.toString(); }
    private static String random() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return b64(bytes); }
    private static String b64(byte[] bytes) { return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    static String safeMessage(Exception e) { return e instanceof IOException || e instanceof SecurityException ? Objects.toString(e.getMessage(), "연결 실패") : "연결 처리 실패 (" + e.getClass().getSimpleName() + ")"; }
}
