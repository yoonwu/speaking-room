package com.speakingroom.voice;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.graphics.Color;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

/** Native companion to 3초영어: no hosted proxy, no API-key billing fallback. */
public final class MainActivity extends Activity {
    private PlanClient plan;
    private TextView account, status;
    private Spinner models, topics;
    private Button login, catalog, test, start, logout;
    private JSONArray modelData = new JSONArray();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean busy, tested;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); plan = PlanClient.get(this);
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(36, 48, 36, 40); content.setBackgroundColor(Color.rgb(246, 249, 248));
        content.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()); v.setPadding(36 + bars.left, 24 + bars.top, 36 + bars.right, 24 + bars.bottom); }
            return insets;
        });
        ScrollView scroll = new ScrollView(this); scroll.addView(content); setContentView(scroll);
        TextView title = text("3초영어 · 음성 대화", 26); content.addView(title);
        content.addView(text("ChatGPT 구독으로 짧은 일상 대화 연습\n설치·로그인·테스트는 정차한 상태에서 완료해주세요.", 16));
        account = text(plan.label(), 14); content.addView(account);
        login = button("Continue with ChatGPT", content, () -> signIn(false));
        button("다른 계정으로 연결", content, () -> signIn(true));
        button("저장된 계정 선택", content, () -> {
            if (busy || VoiceService.running) { show("연습을 멈춘 뒤 계정을 선택해주세요."); return; }
            try {
                JSONArray choices = plan.savedAccounts(); String[] names = new String[choices.length()];
                for (int i = 0; i < choices.length(); i++) names[i] = choices.getJSONObject(i).optString("email") + " · " + choices.getJSONObject(i).optString("client_id");
                if (names.length == 0) { show("저장된 계정이 없습니다."); return; }
                new AlertDialog.Builder(this).setTitle("ChatGPT 계정").setItems(names, (dialog, which) -> {
                    try { plan.selectAccount(choices.getJSONObject(which).getString("client_id")); tested = false; modelData = new JSONArray(); models.setAdapter(null); refresh(); show("계정을 선택했습니다. 모델을 다시 불러오고 연결 테스트를 해주세요."); }
                    catch (Exception e) { show("계정 선택 실패"); }
                }).show();
            } catch (Exception e) { show("계정 목록을 불러오지 못했습니다."); }
        });
        button("로그인 취소", content, () -> { plan.cancelLogin(); });
        catalog = button("사용 가능한 모델 불러오기", content, this::loadModels);
        models = new Spinner(this); content.addView(models);
        content.addView(text("Using ChatGPT plan · 대화 요청은 구독 한도를 사용합니다. 크레딧 사용 허용 여부는 ChatGPT 설정에서 관리하세요.", 14));
        models.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) { tested = false; }
            public void onNothingSelected(android.widget.AdapterView<?> parent) { tested = false; }
        });
        test = button("연결 테스트 · 구독 사용량 소량 사용", content, this::testConnection);
        content.addView(text("오늘의 대화 주제", 18));
        topics = new Spinner(this); topics.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, Lesson.TOPICS)); content.addView(topics);
        start = button("5분 음성 연습 시작", content, this::startPractice);
        button("지난 대화 반복 · AI 요청 없음", content, () -> startReview());
        button("멈추기", content, () -> stopService(new Intent(this, VoiceService.class)));
        status = text(VoiceService.status, 18); content.addView(status);
        content.addView(text("상대가 말한 뒤 영어로 답하면 자동으로 이어갑니다.\n음성 명령: Stop · Repeat · Help\n최대 6번 답하거나 5분이 지나면 종료합니다.\n\n기기 영어 음성 인식과 읽어주기를 사용합니다. 기기에 따라 인식이 Google 서버를 사용할 수 있습니다.\n화면 잠금·블루투스 동작은 휴대폰마다 달라 실제 확인 전에는 운전용으로 사용하지 마세요.", 15));
        button("ChatGPT 사용량·앱 권한 설정", content, () -> open("https://chatgpt.com/settings/usage"));
        button("안드로이드 음성 설정", content, () -> { try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); } catch (Exception e) { startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); } });
        logout = button("로그아웃", content, () -> {
            if (busy) return; stopService(new Intent(this, VoiceService.class));
            work(() -> { String message = plan.logout(); runOnUiThread(() -> { tested = false; modelData = new JSONArray(); models.setAdapter(null); show(message); }); });
        });
        refresh();
    }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(Color.rgb(25, 53, 48)); view.setPadding(0, 12, 0, 12); return view; }
    private Button button(String label, LinearLayout host, Runnable action) { Button b = new Button(this); b.setText(label); b.setAllCaps(false); host.addView(b); b.setOnClickListener(v -> action.run()); return b; }
    private void signIn(boolean different) {
        if (busy || VoiceService.running) { show("연습을 멈춘 뒤 연결해주세요."); return; }
        busy = true; refresh(); show("브라우저에서 로그인한 뒤 이 앱으로 돌아오세요.");
        plan.login(different, new PlanClient.LoginListener() {
            public void openBrowser(String url) { runOnUiThread(() -> { if (!isFinishing()) open(url); else plan.cancelLogin(); }); }
            public void finished(String message) { runOnUiThread(() -> {
                busy = false; tested = false; modelData = new JSONArray(); models.setAdapter(null); show(message); refresh();
                if (plan.connected() && !getPreferences(MODE_PRIVATE).getBoolean("welcomed", false) && !isFinishing()) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("welcomed", true).apply();
                    new AlertDialog.Builder(MainActivity.this).setTitle("ChatGPT 구독을 사용합니다")
                        .setMessage("이 앱의 AI 대화 요청은 연결한 구독의 사용량 한도를 사용합니다. 앱별 한도와 크레딧 사용 허용 여부는 ChatGPT 설정에서 관리할 수 있습니다.")
                        .setPositiveButton("확인", null).show();
                }
            }); }
        });
    }
    private void loadModels() {
        if (busy || VoiceService.running) { show("연습을 멈춘 뒤 모델을 불러와주세요."); return; }
        work(() -> {
            JSONArray data = plan.models();
            ArrayList<String> names = new ArrayList<>();
            for (int i = 0; i < data.length(); i++) names.add(data.getJSONObject(i).optString("display_name", data.getJSONObject(i).getString("slug")));
            runOnUiThread(() -> { modelData = data; tested = false; models.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names)); show("모델을 선택하고 연결 테스트를 눌러주세요. 목록 표시만으로 사용 권한이 검증되지는 않습니다."); });
        });
    }
    private String selectedModel() throws Exception {
        int i = models.getSelectedItemPosition(); if (i < 0 || i >= modelData.length()) throw new java.io.IOException("먼저 모델을 불러오고 선택해주세요.");
        return modelData.getJSONObject(i).getString("slug");
    }
    private void testConnection() {
        if (busy || VoiceService.running) return;
        final String selected;
        try { selected = selectedModel(); } catch (Exception e) { show(e.getMessage()); return; }
        tested = false;
        work(() -> {
            String reply = plan.respond(selected, "Reply with exactly: Ready.", new JSONArray().put(new JSONObject().put("role", "user").put("content", "Connection test.")));
            runOnUiThread(() -> { tested = true; show("구독 요청 성공: " + reply + "\n마이크 권한을 허용하고 짧게 시험해보세요."); });
        });
    }
    private void startPractice() {
        if (busy || VoiceService.running) return;
        if (!tested) { show("먼저 연결 테스트를 완료해주세요."); return; }
        ArrayList<String> permissions = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!permissions.isEmpty()) { requestPermissions(permissions.toArray(new String[0]), 1); return; }
        try { startForegroundService(new Intent(this, VoiceService.class).putExtra("model", selectedModel()).putExtra("topic", Lesson.ENGLISH[topics.getSelectedItemPosition()])); show("연습 시작 중…"); }
        catch (Exception e) { show("연습을 시작하지 못했습니다. 앱을 화면에 연 상태에서 권한을 확인해주세요."); }
    }
    private void startReview() {
        if (busy || VoiceService.running) return;
        if (!getSharedPreferences("practice", MODE_PRIVATE).contains("questions")) { show("먼저 짧은 AI 대화를 완료해주세요. 완료한 질문을 저장해 반복합니다."); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 1); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1); return; }
        try { startForegroundService(new Intent(this, VoiceService.class).putExtra("review", true)); show("지난 대화를 반복합니다. AI 요청은 보내지 않습니다."); }
        catch (Exception e) { show("반복 연습을 시작하지 못했습니다."); }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        show("권한 설정을 반영했습니다. 시작 버튼을 다시 눌러주세요.");
    }
    private interface Task { void run() throws Exception; }
    private void work(Task task) {
        busy = true; refresh(); show("연결 중…");
        io.execute(() -> { try { task.run(); } catch (Exception e) { runOnUiThread(() -> show(PlanClient.safeMessage(e))); }
            finally { runOnUiThread(() -> { busy = false; refresh(); }); } });
    }
    private void refresh() { account.setText(plan.label()); login.setEnabled(!busy); catalog.setEnabled(!busy && plan.connected()); test.setEnabled(!busy && plan.connected()); start.setEnabled(!busy && plan.connected()); logout.setEnabled(!busy); }
    private void show(String message) { if (!isDestroyed()) status.setText(message); }
    private void open(String url) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { show("브라우저를 열 수 없습니다."); plan.cancelLogin(); } }
    @Override public void onResume() { super.onResume(); VoiceService.observer = message -> runOnUiThread(() -> show(message)); }
    @Override public void onPause() { VoiceService.observer = null; super.onPause(); }
    @Override public void onDestroy() { plan.cancelLogin(); io.shutdownNow(); super.onDestroy(); }
}
