package com.speakingroom.voice;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.graphics.Color;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

/** One connection flow; model selection and a completed inference are persisted. */
public final class PlanSettingsActivity extends Activity {
    private PlanClient plan;
    private TextView account, status;
    private Spinner models;
    private Button login, catalog, test, start, logout;
    private JSONArray modelData = new JSONArray();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean busy;
    private final SharedPreferences.OnSharedPreferenceChangeListener loginChanged = (prefs, key) -> {
        if (!"credentials".equals(key) || isDestroyed() || isFinishing() || busy) return;
        refresh();
        if (plan.connected() && !plan.ready()) loadModels(true);
        else if (plan.ready()) showReady();
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); plan = PlanClient.get(this);
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(36, 48, 36, 40); content.setBackgroundColor(Color.rgb(246, 249, 248));
        content.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) { android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()); v.setPadding(36 + bars.left, 24 + bars.top, 36 + bars.right, 24 + bars.bottom); }
            return insets;
        });
        ScrollView scroll = new ScrollView(this); scroll.addView(content); setContentView(scroll);
        button("← 3초영어로 돌아가기", content, this::finish);
        content.addView(text("ChatGPT 연결", 26));
        content.addView(text("처음 한 번 연결하면 다음 연습에서도 그대로 사용할 수 있어요. 로그인 후 대화 준비까지 자동으로 확인합니다.", 16));
        account = text(plan.label(), 14); content.addView(account);
        login = button("Continue with ChatGPT", content, () -> signIn(false));
        status = text("", 18); content.addView(status);
        start = button("연결 완료 · 상황 고르고 대화하기 →", content, this::finish);
        catalog = button("대화 연결 확인 / 모델 목록 새로고침", content, () -> loadModels(!plan.ready()));
        models = new Spinner(this); content.addView(models);
        models.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { refresh(); }
            public void onNothingSelected(AdapterView<?> parent) { refresh(); }
        });
        test = button("선택한 모델로 연결 확인", content, this::testConnection);
        content.addView(text("Using ChatGPT plan · 연결 확인과 AI 대화는 내 ChatGPT 구독 한도를 사용합니다. 반복학습은 연결 없이 사용할 수 있어요.", 14));
        button("다른 계정으로 연결", content, () -> signIn(true));
        button("저장된 계정 선택", content, () -> {
            if (busy || VoiceService.running) { show("연습을 멈춘 뒤 계정을 선택해주세요."); return; }
            try {
                JSONArray choices = plan.savedAccounts(); String[] names = new String[choices.length()];
                for (int i = 0; i < choices.length(); i++) names[i] = choices.getJSONObject(i).optString("email");
                if (names.length == 0) { show("저장된 계정이 없습니다."); return; }
                new AlertDialog.Builder(this).setTitle("ChatGPT 계정").setItems(names, (dialog, which) -> {
                    try { plan.selectAccount(choices.getJSONObject(which).getString("client_id")); modelData = new JSONArray(); models.setAdapter(null); refresh(); if (plan.connected()) { if (plan.ready()) showReady(); else loadModels(true); } else signIn(false); }
                    catch (Exception e) { show(PlanClient.safeMessage(e)); }
                }).show();
            } catch (Exception e) { show("계정 목록을 불러오지 못했습니다."); }
        });
        button("로그인 취소", content, plan::cancelLogin);
        button("ChatGPT 사용량·앱 권한 설정", content, () -> open("https://chatgpt.com/settings/usage"));
        button("개인정보 처리 안내", content, () -> startActivity(new Intent(this, PrivacyActivity.class)));
        logout = button("로그아웃", content, () -> {
            if (busy) return; stopService(new Intent(this, VoiceService.class));
            work(() -> { String message = plan.logout(); updateUi(() -> { modelData = new JSONArray(); models.setAdapter(null); show(message); }); });
        });
        button("저장된 ChatGPT 연결 정보 모두 삭제", content, () -> {
            if (busy || VoiceService.running) { show("진행 중인 연결이나 음성 대화를 멈춰주세요."); return; }
            new AlertDialog.Builder(this).setTitle("이 기기의 계정 연결 정보 삭제")
                .setMessage("저장된 모든 ChatGPT 로그인 정보를 이 기기에서 삭제합니다. ChatGPT 계정과 학습 기록은 삭제되지 않습니다. 서버의 앱 권한은 ChatGPT 설정에서도 해제해주세요.")
                .setPositiveButton("삭제", (d,w) -> { plan.forgetAccounts(); getSharedPreferences("native", MODE_PRIVATE).edit().remove("model").remove("account").remove("modelAccountId").apply(); modelData = new JSONArray(); models.setAdapter(null); refresh(); show("기기에 저장된 계정 연결 정보를 삭제했습니다."); })
                .setNegativeButton("취소", null).show();
        });
        refresh();
        getSharedPreferences("plan", MODE_PRIVATE).registerOnSharedPreferenceChangeListener(loginChanged);
        if (plan.ready()) showReady();
        else if (plan.connected()) loadModels(true);
        else show("ChatGPT 계정을 연결해주세요.");
    }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(Color.rgb(25, 53, 48)); view.setPadding(0, 12, 0, 12); return view; }
    private Button button(String label, LinearLayout host, Runnable action) { Button b = new Button(this); b.setText(label); b.setAllCaps(false); host.addView(b); b.setOnClickListener(v -> action.run()); return b; }
    private void signIn(boolean different) {
        if (busy || VoiceService.running) { show("연습을 멈춘 뒤 연결해주세요."); return; }
        if (!different && plan.connected()) { if (plan.ready()) showReady(); else loadModels(true); return; }
        busy = true; refresh(); show("브라우저에서 로그인한 뒤 이 앱으로 돌아오세요. 대화 준비는 자동으로 확인할게요.");
        plan.login(different, new PlanClient.LoginListener() {
            public void openBrowser(String url) { updateUi(() -> open(url)); }
            public void progress(String message) { updateUi(() -> show(message)); }
            public void finished(boolean success, String message) { updateUi(() -> {
                busy = false; modelData = new JSONArray(); models.setAdapter(null); show(message); refresh();
                if (success) { if (plan.ready()) showReady(); else loadModels(true); }
            }); }
        });
    }
    private void loadModels(boolean complete) {
        if (busy || VoiceService.running) { show("연습을 멈춘 뒤 연결을 확인해주세요."); return; }
        work(() -> {
            String id = plan.accountId();
            JSONArray data = plan.models();
            int selection = plan.catalogSelection(data);
            if (complete) plan.testModel(data.getJSONObject(selection).getString("slug"));
            ArrayList<String> names = new ArrayList<>();
            for (int i = 0; i < data.length(); i++) names.add(data.getJSONObject(i).optString("display_name", data.getJSONObject(i).getString("slug")));
            updateUi(() -> {
                if (!id.equals(plan.accountId())) return;
                modelData = data; models.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names)); models.setSelection(selection);
                if (plan.ready()) showReady(); else show("로그인은 저장되었어요. 사용할 모델을 선택하고 연결을 확인해주세요.");
            });
        });
    }
    private String selectedModel() throws Exception {
        int i = models.getSelectedItemPosition();
        if (i >= 0 && i < modelData.length()) return modelData.getJSONObject(i).getString("slug");
        if (plan.ready()) return plan.model();
        throw new java.io.IOException("대화 연결 확인을 눌러주세요. 다시 로그인할 필요는 없어요.");
    }
    private void testConnection() {
        if (busy || VoiceService.running) return;
        final String selected;
        try { selected = selectedModel(); } catch (Exception e) { show(e.getMessage()); return; }
        work(() -> { plan.testModel(selected); updateUi(this::showReady); });
    }
    private interface Task { void run() throws Exception; }
    private void work(Task task) {
        busy = true; refresh(); show("로그인은 저장되어 있어요. 대화 연결을 확인하고 있어요…");
        io.execute(() -> { try { task.run(); } catch (Exception e) { updateUi(() -> show(PlanClient.safeMessage(e))); }
            finally { updateUi(() -> { busy = false; refresh(); }); } });
    }
    private void refresh() {
        account.setText(plan.label()); login.setVisibility(plan.connected() ? View.GONE : View.VISIBLE); login.setEnabled(!busy);
        catalog.setEnabled(!busy && plan.connected()); test.setEnabled(!busy && plan.connected());
        boolean selectedReady = plan.ready();
        if (selectedReady && modelData.length() > 0) try { selectedReady = plan.model().equals(selectedModel()); } catch (Exception e) { selectedReady = false; }
        start.setEnabled(!busy && selectedReady); logout.setEnabled(!busy);
    }
    private void showReady() { show("ChatGPT 연결 완료 ✓\n앱을 다시 열어도 연결이 유지됩니다. 아래 버튼으로 연습을 시작하세요."); refresh(); }
    private void show(String message) { if (!isDestroyed()) status.setText(message); }
    private void updateUi(Runnable action) { runOnUiThread(() -> { if (!isDestroyed() && !isFinishing()) action.run(); }); }
    private void open(String url) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { show("브라우저를 열 수 없습니다."); plan.cancelLogin(); } }
    @Override public void onResume() { super.onResume(); if (account != null) refresh(); }
    @Override public void onDestroy() { getSharedPreferences("plan", MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(loginChanged); if (isFinishing()) plan.cancelLogin(); io.shutdown(); super.onDestroy(); }
}
