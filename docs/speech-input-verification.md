# Installed Android speech input — 2026-11-05

## Follow-up: regression reproduced in the existing native end detector

This follow-up shipped to Google Play internal testing as **0.5.8 / versionCode13** on November5,2026,19:26 KST. Play Console confirmed “내부 테스터에게 제공됨” for release8. It is **not** a completed handset or installed-app end-to-end verification.

The code before the automatic-end request (`f155c1f`, web v4.4.6) used the native `recognize` bridge. The first automatic-end update (`bcac15c`) changed browser VAD and microphone UI/cues but did not change `PracticeSpeech`, `PracticeMicrophone`, or `PracticeAudio`. The subsequent update (`54cd2f8`) switched supported installed apps to `recordPractice` plus server transcription. These are distinct changes; neither history inspection nor passing server tests establishes which release is active on the user's handset.

An independent failure was reproduced in the unchanged native detector: its initial RMS noise estimate was 100, and it only learned noise below a threshold of 300. Continuous background noise at RMS 700 was immediately classified as speech and prevented the noise estimate from learning. A spoken English WAV followed by that background noise did not automatically finish within a ten-second test.

The correction estimates the initial quiet level during the first 300 ms of actual PCM and clears provisional speech if those initial frames were only steady background noise. Startup zero buffers are excluded; periodic voicing is protected using bounded, mean-removed autocorrelation during calibration only. Loud unvoiced consonants cannot raise the threshold above the initially observed voiced signal. All PCM samples remain in the recording. Recognition and transport code were not changed in this correction. Strongly periodic mechanical hum can still resemble voicing; the existing maximum capture limits remain in place.

| Input | Before correction, steady RMS 700 background | After correction |
| --- | --- | --- |
| TTS WAV: “Can I get some water?” | Still recording at 10 s | Ended at 3.06 s |
| TTS WAV: “Can I leave my bags here?” | Same detector failure condition | Ended at 3.24 s |
| TTS WAV: “I can't find my phone.” | Same detector failure condition | Ended at 3.32 s |

Durations are detector timestamps measured from capture start, including 500 ms of initial background noise. They are not physical-device timings. Each input used deterministic synthetic Gaussian background noise, and background noise continued after speech. The three clean WAV regressions also passed (2.60 s, 2.78 s, 2.90 s). Android `testDebugUnitTest` passed 32 tests with zero failures/errors, including startup-zero, immediate voiced input, and initial loud-consonant regressions; debug and instrumentation APK builds passed.

Installed-app verification remains incomplete. A custom Android instrumentation runner was built to launch the actual Activity/WebView, tap the microphone, inject audio through the authenticated emulator microphone API, and inspect the result UI. The Android15 and Android11 software-emulated environments restarted in system initialization / system watchdog failures before this flow could complete. The user cannot connect their handset by USB at present. No screenshot or passing installed-app result was obtained. At the user's explicit request, the signed0.5.8 AAB was published to the existing internal-test track so the user can verify it on their handset. `bundleRelease`, `testDebugUnitTest`, and `lintRelease` passed; its upload signer matches0.5.7. The AAB is `outputs/speaking-room-0.5.8-play.aab`, SHA256 `e67c2beafbd4b2cc0fec160d22a997474277dba8fd75120aae606a0d5745c7d1`. Publication proof is `outputs/play-0.5.8-published.png`.

Local reproduction tools and logs are in the workspace `outputs` directory: `NativeNoiseCheck.java`, `NativeSilenceCheck.java`, `run-android-speech-test.py`, `android-boot-watchdog.txt`, and `android-lite-watchdog.txt`. The instrumentation entry point is `android/app/src/androidTest/java/com/speakingroom/voice/SpeechFlowInstrumentation.java`.

Web update v4.4.8 uses the installed app 0.5.7+ `recordPractice` bridge to capture a WAV, then transcribes it using the existing speech proxy. It no longer sends that recording into Android's device-dependent `SpeechRecognizer` audio-source pipe. ChatGPT login is not required for basic-expression input. Earlier app versions keep their existing recognition path.

Native capture already detects 1.4 seconds of silence. The web caller also sends an automatic stop after a bounded answer window (8–18 seconds for reference sentences, 20 seconds for open answers), preventing background noise from holding the recording open indefinitely. An unresponsive capture is cancelled after a further five seconds. Each transcription request, including its response body, has a ten-second deadline.

## Live server test

Synthetic English audio was generated with the existing app TTS, converted to 16 kHz mono PCM WAV, supplied as a simulated `recordPractice` response, and processed by the production JavaScript functions, real production speech server, and production grader. The device recognizer was forbidden in the test. No answer text was sent to the recognition endpoint.

| Spoken fixture | Actual server transcript | Recognition time | Grading |
|---|---|---:|---|
| Can I get some water? | Can I get some water? | 2667 ms | Correct; towel rejected |
| Can I leave my bags here? | Can I leave my bags here? | 1915 ms | Correct; phone rejected |
| I can't find my phone. | I can't find my phone. | 987 ms | Correct; ticket rejected |

Start/end cues, recorded-audio preservation, and release of the listening state were also checked along this path.

## Installed PCM end detector

The unchanged production `PracticeAudio.java` class was compiled and run on the same actual WAV sample data plus silence, using its normal 320-sample frames:

| Fixture duration | Automatic capture end |
|---:|---:|
| 2136 ms | 2600 ms |
| 2328 ms | 2780 ms |
| 2400 ms | 2900 ms |

The fixtures already include trailing silence. The detector ended without a manual stop command. Separate regression tests cover the automatic maximum-window stop under constant noise, unresponsive capture cancellation, Azure-to-OpenAI fallback, and ignoring a late recording after leaving practice.

## Scope limit

ADB found no connected Android device. These results verify actual audio data, production server requests, production grading, and the installed capture algorithm. They do **not** verify the user's physical microphone, handset routing, device permissions, or acoustic playback. Do not report this as a completed physical-device test.
