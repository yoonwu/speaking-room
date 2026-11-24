package com.speakingroom.voice;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class LearningAgeTest {
    @Test public void ageGroupKeepsChildrenAndTeensOffline() {
        for (String age : new String[]{"0", "12", "13", "17"}) {
            assertEquals("offline", LearningAge.groupForAge(age));
        }
        assertEquals("adult", LearningAge.groupForAge("18"));
        assertEquals("adult", LearningAge.groupForAge("120"));
    }

    @Test public void invalidAgeCannotEnableOnlineFeatures() {
        for (String age : new String[]{"", "-1", "18.5", "121", "2000", "adult"}) {
            assertEquals("", LearningAge.groupForAge(age));
        }
    }
}
