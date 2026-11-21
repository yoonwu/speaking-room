# 3초영어 0.6.3 / v4.7.2 출시 검증

대상: Android **0.6.3 / versionCode 18**, 학습 화면 **v4.7.2**, **minimumNativeVersion 18**. 고정 소스 `b3c63aa2a944f312f93579b6da0f0c3c12993276`의 **서명 AAB·APK와 전체 포함 자산 검증을 완료했다.** 웹 v4.7.2와 Worker v11은 배포 확인을 마쳤으며 2026-11-07 19:32 KST에 Play 내부 테스트 출시 13의 테스터 제공 상태를 확인했다. 공개 프로덕션 출시나 실제 휴대폰 검증을 뜻하지 않는다.

이전에 제공한 설치 파일 [0.6.2/code 17](release-0.6.2.md)의 서명·해시·아티팩트는 그대로 보존한다. 해당 앱에 별도로 배포한 [v4.7.1](web-v4.7.1.md)의 고정 문항 수·재도전 보너스·완료 통계도 보존한다. 새 네이티브 인식 처리까지 포함하려면 이번 Play 업데이트가 필요하다.

## 수정 범위

- 음성 인식의 표시용 문장보다 첫 번째 인식 단어 원문(Lexical)을 우선 선택한다. 원문이 없을 때만 유효한 단어 목록, 구형 표시 결과 순서로 사용한다. 명시적인 빈 원문과 NoMatch를 표시 문장으로 대체하지 않는다. 이것은 인식기가 음성 자체를 잘못 알아듣는 현상까지 없앤다는 보장이 아니다.
- 기준 답안·목표 단어를 음성 인식 요청에 넣거나, 인식 결과를 기준 답안으로 바꾸는 방식은 사용하지 않는다. 기존의 음성 보존·마이크 권한·실제 음성 시작 시간·취소·프로필 격리는 유지한다.
- 네이티브와 웹의 같은 선택 정책, 원문 필드가 없는 구형 응답, 명시적으로 빈 원문·NoMatch·잘못된 JSON 처리를 회귀 검증했다. 모든 단어 삽입을 막는다고 보장하지 않는다.
- 새 화면의 최소 앱 코드를 18로 올린다. code 17 이하 앱이 웹 파일만 받아 새 네이티브 수정까지 지원한다고 표시하지 않는다.

## 실제 서버 검증과 확인된 한계

Microsoft SDK 1.53.0과 제품 원문 선택기를 통해 합성 음성 4개와 인공 잡음 1개를 실제 서비스에 보냈다. 사용자 녹음이나 Android 휴대폰 테스트는 아니다.

| 합성 음성의 문장 | 선택된 실제 인식 원문 |
| --- | --- |
| Can I change seat? | can i change seat |
| I have reservation. | i have a reservation |
| Can I change this seat? | can i change the seat |
| I already have a reservation. | i already have a reservation |
| 인공 잡음 | 빈 결과 |

이 표의 `a` 추가와 `this → the`는 첫 번째 Lexical/Words에도 있었다. **원문 선택만으로 음성 인식 엔진의 모든 오류가 해결됐다고 표시하지 않는다.** 실제로 말한 already/this를 임의로 지우거나 정답과 가까운 다른 후보를 고르지 않는다. 분절 대기를 100ms에서 500ms로 늘린 별도 실험에서도 네 문장 결과가 같아 제품 설정은 100ms를 유지했다. 900ms 중간 쉼 결과는 실험 기록에만 보관하고 다른 원인과 분리해서 효과를 확정하지 않는다.

서버 Worker **v11 / cd2efe19**는 기존 `/stt`를 상세 응답으로 바꿨으며 편집기 코드와 검증한 단일 행 산출물의 32,577글자 전체 일치를 확인해 배포했다. 실제 `/version`과 `/practice-realtime/status`로 제공을 확인했다. 기존 REST에 위 두 누락 단어 예문을 보내 원문 필드를 확인했으며, I have reservation의 a 추가 한계도 동일했다. OpenAI 호출이나 새로운 과금 연결은 추가하지 않았다.

로컬 증거: `outputs/transcript-lexical-live.jsonl`, `outputs/native-realtime-seg500-results.jsonl`, `outputs/worker-v11-transcript-live.json`, `outputs/cloudflare-worker-v11-single-line-validation.json`.

## 버전과 포함 파일 확인

| 항목 | 준비 상태 |
| --- | --- |
| Android 메타데이터 | `versionName 0.6.3`, `versionCode 18` |
| 실제 앱 코드 | MainActivity의 두 `WebUpdater` 생성자 18 |
| 별도 웹 호환성 | `minimumNativeVersion 18`, 기존 bridgeVersion 1 유지 |
| 앱 화면 버전 | 포함 v4.7.2와 index 자산 버전 확인 |
| 배포 회귀 | 전체 Node **230/230 통과**, 실패·취소·건너뜀 0 |
| 포함 파일 | `practice-session.js`를 포함한 핵심 웹 파일 9개와 webmanifest·아이콘·마스코트 전체 **17개**가 AAB·APK 모두 고정 소스와 바이트 일치 |
| 서명 도구 | 작업 폴더 `outputs/build-speaking-room-063.ps1`, `outputs/VerifySpeakingRoomBundle063.java` 실행·검증 완료 |

서명은 기존 업로드 키와 Windows DPAPI 보호 비밀번호를 해당 빌드 프로세스에서만 사용한다. 새 키를 만들거나 비밀번호를 출력·임시 파일·Git에 기록하지 않는다. 기대 업로드 인증서 SHA-256은 `E18C255BC89DFDAFCDDD2A06BBA425C1930DE8AD14400A6D7B0BFD33BFB02E17`이다.

## 최종 검증 기록

고정 소스로 `bundleRelease assembleRelease testDebugUnitTest lintRelease assembleDebug`를 실행했다. 실제 AAB protobuf manifest와 APK badging의 패키지·버전, jarsigner/apksigner 인증서, 포함 자산의 바이트·파일 해시와 네이티브 소스 해시를 확인했다. 실제 테스트 결과 XML을 합산했으며 이전 0.6.2의 통과 수를 재사용하지 않았다. 서명 파일 검증 시각은 **2026-11-07 19:31 KST**다.

| 항목 | 결과 |
| --- | --- |
| 고정 소스 커밋 | `b3c63aa2a944f312f93579b6da0f0c3c12993276`. 검증 시 실행 소스의 미커밋 변경 없음 |
| 전체 Node 회귀 | **230/230 통과**, 실패·취소·건너뜀 0. 작업 폴더 `outputs/transcript-472-node-tests.log` |
| Android JVM XML 합계 | **80/80 통과**, 실패·오류·건너뜀 0 |
| 서명 빌드 / lint | 5개 Gradle 작업 모두 성공. Lint 오류 0, 기존 경고 2(ObsoleteSdkInt/MonochromeLauncherIcon). 작업 폴더 `outputs/native-063-build.log` |
| 패키지 / 0.6.3 / code 18 | 실제 AAB·APK 모두 `com.speakingroom.voice` / 0.6.3 / code 18. minimumNativeVersion 18과 두 WebUpdater 생성자 18 확인 |
| 기존 업로드 인증서 일치 | 두 파일 서명 유효, 인증서 SHA-256 `E18C255BC89DFDAFCDDD2A06BBA425C1930DE8AD14400A6D7B0BFD33BFB02E17` 일치 |
| AAB | `outputs/speaking-room-0.6.3-play.aab`, **23,240,149 bytes**, SHA-256 `0e6396e86541cc5d1e61edd15c15b0964780db7d18c019d117ed08738e8d445e` |
| 서명 APK | `outputs/speaking-room-0.6.3-release.apk`, **43,981,962 bytes**, SHA-256 `58e5fe304c631890177cd2e37e934c5b1d6938892921791ad441bd87e4f5183a` |
| 포함 파일 / 소스 해시 | AAB·APK 모두 전체 17개 자산이 고정 소스와 바이트 일치. 웹 자산 17개·네이티브 Java 24개·웹 배포 설정·Worker 소스 SHA-256을 작업 폴더 `outputs/speaking-room-0.6.3-verification.json`에 기록 |
| 원문 선택의 실제 음성 검증 | 공식 SDK의 합성 음성 4개·인공 잡음 1개, 운영 Worker REST의 합성 음성 2개 확인. 앞 표의 원문 자체 `a` 추가·`this → the` 한계 유지. 사용자 녹음·실제 휴대폰 시험 아님 |
| Play 내부 테스트 | **2026-11-07 19:32 KST, 출시 13 — 내부 테스터에게 제공됨**. 작업 폴더 `outputs/play-0.6.3-published.png` |
| v4.7.2 웹 배포 | **2026-11-07 19:30 KST 확인**. [Actions 42364179469 성공](https://github.com/yoonwu/speaking-room/actions/runs/42364179469), 라이브 descriptor의 소스 `b3c63aa2a944f312f93579b6da0f0c3c12993276`·min18 및 전체 17파일 해시/크기 일치. 작업 폴더 `outputs/web-v4.7.2-published.json` |
| Worker 배포 | **worker-v11 / cd2efe19**, 편집기 전체 코드 일치와 HTTP 제공·REST 합성 음성 2개 검증. 작업 폴더 `outputs/worker-v11-transcript-live.json`, `outputs/cloudflare-worker-v11-single-line-validation.json` |
| 실제 휴대폰 | 미확인 |

파일 검증 결과는 새 `outputs/speaking-room-0.6.3-verification.json`에 기록했다. 준비된 파일을 Play 게시 완료로 표시하지 않으며 공개 프로덕션 출시와 내부 테스트 제공 상태도 구분한다.
