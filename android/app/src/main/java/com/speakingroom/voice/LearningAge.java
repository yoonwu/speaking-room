package com.speakingroom.voice;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.text.InputType;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

final class LearningAge {
    private static final String ADULT = "adult";
    private static final String OFFLINE = "offline";

    private LearningAge() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("learning_access", Context.MODE_PRIVATE);
    }

    static String groupForAge(String input) {
        if (!input.matches("[0-9]{1,3}")) return "";
        int age = Integer.parseInt(input);
        return age > 120 ? "" : age >= 18 ? ADULT : OFFLINE;
    }

    static boolean isSet(Context context) {
        String group = preferences(context).getString("group", "");
        return ADULT.equals(group) || OFFLINE.equals(group);
    }

    static boolean allowsOnlineFeatures(Context context) {
        return ADULT.equals(preferences(context).getString("group", ""));
    }

    static void show(Activity activity, Runnable onContinue) {
        int inset = Math.round(28 * activity.getResources().getDisplayMetrics().density);
        ScrollView scroll = new ScrollView(activity);
        scroll.setBackgroundColor(Color.rgb(226, 245, 238));
        scroll.setFillViewport(true);
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.setPadding(inset, inset * 2, inset, inset * 2);
        scroll.addView(content);

        TextView title = new TextView(activity);
        title.setText("3초영어");
        title.setTextSize(34);
        content.addView(title);
        TextView note = new TextView(activity);
        note.setText("학습을 시작하기 전에 만 나이를 입력해주세요. 입력한 숫자는 저장하거나 전송하지 않아요.");
        note.setTextSize(16);
        content.addView(note);
        EditText input = new EditText(activity);
        input.setHint("만 나이");
        input.setSingleLine();
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setSaveEnabled(false);
        input.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO);
        content.addView(input);
        Button next = new Button(activity);
        next.setText("계속");
        next.setOnClickListener(view -> {
            String group = groupForAge(input.getText().toString().trim());
            if (group.isEmpty()) {
                input.setError("만 나이를 숫자로 입력해주세요.");
                return;
            }
            if (!preferences(activity).edit().putString("group", group).commit()) {
                input.setError("설정을 저장하지 못했어요. 한 번 더 눌러주세요.");
                return;
            }
            input.getText().clear();
            onContinue.run();
        });
        content.addView(next);
        activity.setContentView(scroll);
    }
}
