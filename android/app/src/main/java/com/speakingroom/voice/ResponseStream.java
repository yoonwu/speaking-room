package com.speakingroom.voice;

import org.json.JSONObject;
import java.io.*;

/** Accept output only after response.completed. Partial/failed streams are never learned or spoken. */
final class ResponseStream {
    static String read(Reader source) throws Exception {
        BufferedReader in = new BufferedReader(source);
        StringBuilder output = new StringBuilder(), data = new StringBuilder();
        String line;
        boolean completed = false;
        while ((line = in.readLine()) != null) {
            if (line.startsWith("data:")) { if (data.length() > 0) data.append('\n'); data.append(line.substring(5).trim()); }
            else if (line.isEmpty() && data.length() > 0) {
                String chunk = data.toString(); data.setLength(0);
                if ("[DONE]".equals(chunk)) continue;
                JSONObject event = new JSONObject(chunk);
                String type = event.optString("type");
                if ("response.output_text.delta".equals(type)) { output.append(event.getString("delta")); if (output.length() > 16000) throw new IOException("음성 응답이 너무 깁니다."); }
                if ("response.failed".equals(type) || "response.incomplete".equals(type) || "error".equals(type)) throw new IOException("AI 응답이 완료되지 않았습니다. 다시 시도해주세요.");
                if ("response.completed".equals(type)) { if (!"completed".equals(event.getJSONObject("response").optString("status"))) throw new IOException("응답 상태를 확인하지 못했습니다."); completed = true; break; }
            }
        }
        if (!completed || output.toString().trim().isEmpty()) throw new IOException("AI 연결이 끊겼거나 응답이 비어 있습니다.");
        return output.toString().trim();
    }
}
