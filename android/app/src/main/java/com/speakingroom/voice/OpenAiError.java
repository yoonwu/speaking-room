package com.speakingroom.voice;

import java.io.IOException;
import java.util.Arrays;

/** Authentication failures differ from eligibility, usage and temporary outages. */
final class OpenAiError extends IOException {
    final int status;
    final String code;
    OpenAiError(int status, String code) { super(message(status, code)); this.status = status; this.code = code; }
    boolean terminalRefresh() { return terminalRefresh(code); }
    static boolean terminalRefresh(String code) {
        return Arrays.asList("invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused").contains(code);
    }
    static String message(int status, String code) {
        if (terminalRefresh(code)) return "저장된 ChatGPT 로그인이 만료되었거나 해제되었어요. 다시 연결해주세요.";
        if ("subscription_sharing_user_not_eligible".equals(code)) return "이 ChatGPT 계정에서는 앱의 구독 사용이 허용되지 않아요. 재로그인으로 해결되지 않습니다. ChatGPT의 앱 권한을 확인해주세요.";
        if (status == 429) return "ChatGPT 구독 또는 앱별 사용량 한도에 도달했어요. 로그인은 유지됩니다. ChatGPT 사용량 설정을 확인해주세요. (429)";
        if (status == 401) return "ChatGPT의 계정·구독 권한을 확인하지 못했어요. (401)";
        if (status == 403) return "ChatGPT 계정 또는 앱의 구독 사용 권한이 제한되어 있어요. (403)";
        if (status >= 500) return "ChatGPT 연결이 일시적으로 불안정해요. 로그인은 유지됩니다. 잠시 후 다시 시도해주세요. (HTTP " + status + ")";
        return "OpenAI 요청을 완료하지 못했어요. (HTTP " + status + ")";
    }
}
