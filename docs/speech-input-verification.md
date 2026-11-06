# Installed Android speech input — 2026-11-06

## Reference-voice recovery: web v4.4.11

The result renderer still called the reference voice after both correct and incorrect attempts. The vulnerable path awaited network recognition and then attempted a new HTMLAudio playback while Android WebView requires a media user gesture. A WebSpeech fallback is not sufficient evidence that every Android WebView can play it.

Native-app reference playback now uses the AudioContext unlocked during the learner's gesture for microphone cues. It decodes the actual reference MP3 into a BufferSource and retains the existing generation-based stop/cancel rules. Question display silently prepares the reference MP3, sharing the pending request and bounded cache with playback. A question captures its playback rate so adaptive grading cannot invalidate its prefetched voice. Reference text is sent only to the existing TTS endpoint; recognition requests do not receive the expected answer.

In a real browser, with asynchronous native recognition simulated and the old HTMLAudio path deliberately rejected, the production scripts fetched and decoded actual server MP3s. A correct result started one non-silent 2.664-second reference buffer 84 ms after the simulated final result and reached its end. An incorrect result also read the reference sentence once; its first uncached TTS request exposed an independent 27.302-second provider/network outlier. Manual replay and repeat playback used the real decoded audio, and retry stopped repeat scheduling. Raw traces are in `outputs/tts-browser-correct-result.json`, `tts-browser-wrong-result.json`, `tts-browser-replay-result.json`, and `tts-browser-cancel-result.json`. This is a playback-path browser test, not a physical Android microphone/speaker test.

The TTS request now has a total eight-second deadline, including its response body, starting when prefetch begins. It aborts an overdue request and uses the existing device-speech fallback where supported; a late response cannot populate the cache or play after the learner leaves. This bounds the observed long wait but does not guarantee a working device speech engine or an instant uncached voice under a provider outage.

After the deadline and gesture fixes, the final v4.4.11 browser check read “Can I get another towel?” with one actual 3.024-second non-silent buffer, starting 22 ms after the simulated native final event and ending normally. It produced no browser errors. All 81 Node checks passed, including the real reference-playback functions after correct/incorrect native results, replay/repeat/cancel, adaptive playback rate, a hanging MP3 response body, late timeout responses, a first typed answer, and a denied/unresolved AudioContext resume. The final browser trace is `outputs/tts-browser-final-v4.4.11.json`.

Recognition performance was audited separately. Native capture still preserves a 1.4-second quiet period to avoid clipping a beginner's mid-sentence pauses. Two additional paced production REST requests returned the correct text 1360/1045 ms after input ended; a single pair does not establish a reliable header-based optimization, so no input-format change was published. Provider timing fields were inconsistent with the supplied clip duration and are not used to trim recordings. A continuously connected recognizer is a further architectural option, not a completed implementation or a measured handset improvement. No recognition-speed improvement is claimed for this voice-playback release.

## Streaming update: native 0.5.9 / web v4.4.10 / worker-v9

Status: worker-v9 is deployed to production as Cloudflare version **0fc392a0** and verified through the public version endpoint and actual streamed speech requests. Web v4.4.10 is live at immutable revision **c9a32c40851e8de003f04c3799e7e4653864b450**; GitHub workflow 42173817656 passed and the descriptor plus four main asset hashes were checked. Native **0.5.9 / versionCode14** was published to the existing Google Play internal-test track as release9 on November6,2026,15:21 KST; Play Console confirmed “내부 테스터에게 제공됨”. Publication proof is `outputs/play-0.5.9-published.png`. A Play Store update to native0.5.9 is required to enable streaming; an in-app web refresh on0.5.8 alone cannot add the native transport. These checks do not establish physical-handset latency or guarantee every request below two seconds.

The Cloudflare editor's saved code was compared character-for-character with the 9,316-character esbuild whitespace-only artifact before deployment. Its Acorn syntax tree matches the repository Worker exactly, and all 75 Node tests also pass against that artifact. The previous live worker-v7 source was backed up before editing; bindings and provider credentials were preserved.

Using the actual production `PracticeStreaming` and `PracticeAudio` classes on a desktop JVM, the same three English fixtures were paced in 20 ms frames into the deployed worker-v9 until automatic silence detection stopped capture:

| Fixture | Capture | Wait after capture | Transcript |
| --- | ---: | ---: | --- |
| Can I get some water? | 2616 ms | 3146 ms | Correct |
| Can I leave my bags here? | 2791 ms | 1534 ms | Correct |
| I can't find my phone. | 2908 ms | 1653 ms | Correct |
| First fixture, recheck | 2617 ms | 1543 ms | Correct |

The first request exceeded two seconds. The later three were 1.53–1.65 seconds after capture; this is evidence of a working production streaming path, not a universal latency guarantee or a completed Android handset test. Raw results are in the workspace outputs `native-streaming-worker-v9-results.jsonl` and `native-streaming-worker-v9-phrase1-recheck.jsonl`. Deployment proof is `cloudflare-worker-v9-published.png`.

The previous seven-second deadline fixes serial timeout accumulation, but the completed-file REST upload still starts recognition only after capture. Fresh production-server measurements remained around 2.5–2.6 seconds for the short bags fixture, and one subsequent request exceeded twelve seconds. This is not sufficient evidence for a two-second interaction target.

The candidate `streamPractice` action tees the existing microphone's PCM frames into a bounded asynchronous chunked HTTP upload while retaining the original PCM for replay. It opens no second microphone and puts no provider key in the app. A canonical 44-byte open-ended WAV header was accepted by the existing production Azure route with the correct transcript. The candidate Worker forwards the incoming request body as a stream instead of buffering the entire file. It also caches CORS preflight responses for ten minutes.

The native capture-complete event is bound to the request ID, so the end cue and microphone state change before the final recognition result. Only a final transcript is graded. A failed stream or successful NoMatch does not silently upload the recording again; this avoids restoring the long sequence of waits. Older native installations retain the previously published WAV recognition path.

Required release order: deploy and inspect worker-v9, measure the actual Java streaming transport against that live service, publish the immutable web v4.4.10 descriptor, then publish the signed native 0.5.9 AAB. Publishing the AAB while the live descriptor remains v4.4.9 would let startup updates replace its bundled learning screen with the older serial implementation.

Automated checks passed: 75 Node tests, 40 Android JVM tests (including eight real loopback HTTP tests), debug and instrumentation APK compilation, and release lint. The instrumentation APK was compiled, not executed on a handset. The pending-permission cancellation path was reviewed and compiled; no Android permission-dialog interaction was executed.

The actual production `PracticeStreaming` and `PracticeAudio` detector were also run from a desktop JVM, pacing the three English fixtures at 16 kHz and adding silence until automatic capture ended. Against the **existing buffered live Worker**, capture durations were 2617/2803/2900 ms and post-capture waits were **1085/4414/1588 ms**, all with correct transcripts. One case remained well above two seconds, so this candidate is not yet evidence of meeting the interaction target and was not published on that basis. The raw report is `outputs/native-streaming-live-baseline.jsonl`; these are not handset timings.

## Follow-up: answer-recognition latency, web v4.4.9

The v4.4.8 installed-app transcription path could wait for Azure for ten seconds, then a backup for ten seconds, then retry Azure for ten more seconds. A deterministic timeout reproduction was still pending at 20 seconds and failed at 30 seconds. The local answer grader itself does not make a network request.

The installed-app transcription path now has one seven-second deadline covering both providers and their response bodies. Azure starts immediately. If it is still pending at two seconds, the available backup starts; a primary failure starts the backup immediately. The first fully received successful HTTP response wins, losing requests are aborted, and Azure is never requested twice for one recording. Backup quota/authorization failures retain their existing cooldowns, and a backup still pending at the overall deadline gets a five-minute cooldown. The ordinary browser transcription route is unchanged. The deadline reports a retryable error rather than inventing or accepting an answer.

Production-server tests from the PC used the same three generated English WAVs as the existing installed-bridge simulation, actual production JavaScript and grading, and no reference text sent to recognition. They returned the correct transcripts and rejected the deliberately wrong objects in **2946 ms, 1431 ms, and 1147 ms**. A separate direct server benchmark returned the bags sentence in 3116 ms; adding eight seconds of trailing silence took 4830 ms. These are measured server/pipeline timings, not physical-handset or microphone timings.

Deterministic tests cover the fast-primary path without a backup, slow response bodies and late losing responses, immediate failure fallback, hung providers, request cancellation, and backup cooldown. A delayed primary with a fast backup completed at 2200 ms; both hung providers ended at 7000 ms. Diagnostics expose only the latest capture duration, recognition duration, and phase as `window.srLastSpeechTiming`, with no transcript or audio in that diagnostic. The home footer includes the active learning-screen version so a stale web update can be distinguished from native app version 0.5.8. Test reports live locally in `outputs/installed-speech-pipeline-results.json` and `outputs/stt-latency-benchmark.json`.

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
