package com.speakingroom.voice;

import org.junit.Test;
import org.json.*;
import java.util.*;
import java.io.IOException;
import static org.junit.Assert.*;

public class PlanConnectionTest {
    static final class MemoryStore implements PlanConnection.Store {
        final Map<String,String> values = new HashMap<>();
        boolean fail;
        public String get(String key) { return values.getOrDefault(key, ""); }
        public boolean verified(String model, String id, String label) { if(fail)return false; values.put("model", model); values.put("modelAccountId", id); values.put("account", label); return true; }
    }
    @Test public void verifiedConnectionSurvivesReopenAndCatalogReload() throws Exception {
        MemoryStore store = new MemoryStore();
        new PlanConnection(store).verified("selected", "oaiapp_a", "old display label");
        PlanConnection reopened = new PlanConnection(store);
        JSONArray catalog = new JSONArray().put(new JSONObject().put("slug", "first")).put(new JSONObject().put("slug", "selected"));
        assertEquals(1, reopened.catalogSelection(catalog));
        assertEquals(1, reopened.catalogSelection(catalog));
        assertTrue(reopened.ready(true, "oaiapp_a", "new display label"));
        assertEquals("selected", reopened.model());
    }
    @Test public void originalValidatedSettingsAreMigratedWithoutAnotherLogin() {
        MemoryStore store = new MemoryStore(); store.values.put("model", "saved"); store.values.put("account", "same account");
        assertTrue(new PlanConnection(store).ready(true, "oaiapp_a", "same account"));
        assertEquals("oaiapp_a", store.get("modelAccountId"));
        assertTrue(new PlanConnection(store).ready(true, "oaiapp_a", "renamed"));
    }
    @Test public void anotherAccountCannotReuseTheValidatedSelection() throws Exception {
        MemoryStore store = new MemoryStore(); PlanConnection state = new PlanConnection(store); state.verified("saved", "oaiapp_a", "same email");
        assertFalse(state.ready(true, "oaiapp_b", "same email"));
        assertFalse(state.ready(false, "oaiapp_a", "same email"));
        assertTrue(state.ready(true, "oaiapp_a", "same email"));
    }
    @Test public void failedStorageIsNeverReportedAsReady() {
        MemoryStore store = new MemoryStore(); store.fail = true; PlanConnection state = new PlanConnection(store);
        assertThrows(IOException.class, () -> state.verified("model", "oaiapp_a", "label"));
        assertFalse(state.ready(true, "oaiapp_a", "label"));
    }
    @Test public void onlyTerminalRefreshErrorsRequireNewOAuth() {
        assertTrue(OpenAiError.terminalRefresh("invalid_grant"));
        assertTrue(OpenAiError.terminalRefresh("refresh_token_reused"));
        for (String code : Arrays.asList("", "invalid_client", "subscription_sharing_usage_unavailable", "subscription_sharing_user_not_eligible")) assertFalse(OpenAiError.terminalRefresh(code));
        assertFalse(OpenAiError.message(503, "").contains("다시 연결"));
        assertFalse(OpenAiError.message(429, "").contains("다시 연결"));
    }
}
