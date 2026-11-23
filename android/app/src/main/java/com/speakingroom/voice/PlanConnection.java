package com.speakingroom.voice;

import org.json.JSONArray;
import java.io.IOException;

/** Validated inference settings survive screen recreation and catalog reloads. */
final class PlanConnection {
    interface Store {
        String get(String key);
        boolean verified(String model, String accountId, String label);
    }
    private final Store store;
    PlanConnection(Store store) { this.store = store; }
    String model() { return store.get("model"); }
    boolean ready(boolean connected, String accountId, String label) {
        if (!connected || accountId.isEmpty() || model().isEmpty()) return false;
        String savedId = store.get("modelAccountId");
        if (!savedId.isEmpty()) return savedId.equals(accountId);
        // Upgrade the previously validated 0.5.4 selection without another login.
        return label.equals(store.get("account")) && store.verified(model(), accountId, label);
    }
    void verified(String model, String accountId, String label) throws IOException {
        if (model.isEmpty() || accountId.isEmpty() || !store.verified(model, accountId, label))
            throw new IOException("연결 설정을 저장하지 못했어요. 다시 시도해주세요.");
    }
    int catalogSelection(JSONArray data) {
        for (int i = 0; i < data.length(); i++)
            if (model().equals(data.optJSONObject(i).optString("slug"))) return i;
        return 0; // Preserve the account catalog's ordering for a first connection.
    }
}
