# Installed Android speech input — 2026-11-05

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
