package com.speakingroom.voice;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** A browser return can only bring our UI forward; it cannot submit an OAuth result. */
public final class LoginReturnActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Class<?> screen = PlanClient.get(this).loginPending() ? PlanSettingsActivity.class : MainActivity.class;
        startActivity(new Intent(this, screen).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
        finish();
    }
}
