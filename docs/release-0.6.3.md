# 3초영어 0.6.3 / v4.7.2 출시 준비

대상: Android **0.6.3 / versionCode 18**, 학습 화면 **v4.7.2**, **minimumNativeVersion 18**. 현재는 음성 인식 원문 처리 수정과 최종 검증을 진행 중이며 서명 빌드·Play 게시·새 웹 배포를 완료했다는 뜻이 아니다.

현재 제공 중인 설치 파일 [0.6.2/code 17](release-0.6.2.md)의 서명·해시·아티팩트는 그대로 보존한다. 해당 앱에 별도로 배포한 [v4.7.1](web-v4.7.1.md)의 고정 문항 수·재도전 보너스·완료 통계도 보존한다. 새 네이티브 인식 처리까지 포함하려면 이번 Play 업데이트가 필요하다.

## 수정 범위

- 음성 인식의 표시용 문장보다 첫 번째 인식 단어 원문(Lexical)을 우선 선택한다. 원문이 없을 때만 유효한 단어 목록, 구형 표시 결과 순서로 사용한다. 명시적인 빈 원문과 NoMatch를 표시 문장으로 대체하지 않는다. 이것은 인식기가 음성 자체를 잘못 알아듣는 현상까지 없앤다는 보장이 아니다.
- 기준 답안·목표 단어를 음성 인식 요청에 넣거나, 인식 결과를 기준 답안으로 바꾸는 방식은 사용하지 않는다. 기존의 음성 보존·마이크 권한·실제 음성 시작 시간·취소·프로필 격리는 유지한다.
- 네이티브와 웹의 같은 정책 적용, 원문 필드가 없는 구형 응답의 처리, 빈 결과·잘못된 JSON·인식 실패는 구현과 회귀 검증을 마친 뒤 아래에 실제 증거를 기록한다. 검증 전에는 모든 단어 삽입을 막는다고 보장하지 않는다.
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

## 버전과 포함 파일 준비

| 항목 | 준비 상태 |
| --- | --- |
| Android 메타데이터 | `versionName 0.6.3`, `versionCode 18` |
| 실제 앱 코드 | MainActivity의 두 `WebUpdater` 생성자 18 |
| 별도 웹 호환성 | `minimumNativeVersion 18`, 기존 bridgeVersion 1 유지 |
| 앱 화면 버전 | v4.7.2로 최종 고정 예정. 설치 파일과 index 자산 버전을 함께 확인 |
| 배포 회귀 | 버전 변경 후 `web-release.test.cjs` **2/2 통과**. 전체 최종 회귀 수는 아직 확정하지 않음 |
| 포함 파일 | `practice-session.js`를 포함한 핵심 웹 파일 9개와 webmanifest·아이콘·마스코트 전체를 설치 파일에서 대조할 준비 |
| 서명 도구 | 작업 폴더 `outputs/build-speaking-room-063.ps1`, `outputs/VerifySpeakingRoomBundle063.java` 준비. 아직 실행 전 |

서명은 기존 업로드 키와 Windows DPAPI 보호 비밀번호를 해당 빌드 프로세스에서만 사용한다. 새 키를 만들거나 비밀번호를 출력·임시 파일·Git에 기록하지 않는다. 기대 업로드 인증서 SHA-256은 `E18C255BC89DFDAFCDDD2A06BBA425C1930DE8AD14400A6D7B0BFD33BFB02E17`이다.

## 최종 검증 기록

네이티브·웹 구현이 끝나고 소스 커밋을 고정한 뒤 `bundleRelease assembleRelease testDebugUnitTest lintRelease assembleDebug`를 실행한다. 실제 AAB protobuf manifest와 APK badging의 패키지·버전, jarsigner/apksigner 인증서, 포함 자산의 바이트·파일 해시와 네이티브 소스 해시를 확인한다. 실제 테스트 결과 XML의 합계를 사용하며 이전 0.6.2의 통과 수를 재사용하지 않는다.

| 항목 | 결과 |
| --- | --- |
| 고정 소스 커밋 | 대기 |
| 전체 Node 회귀 | 대기 |
| Android JVM XML 합계 | 대기 |
| 서명 빌드 / lint | 대기 |
| 패키지 / 0.6.3 / code 18 | 실제 설치 파일 확인 대기 |
| 기존 업로드 인증서 일치 | 대기 |
| AAB | 예정 `outputs/speaking-room-0.6.3-play.aab`. 크기·SHA-256 확인 대기 |
| 서명 APK | 예정 `outputs/speaking-room-0.6.3-release.apk`. 크기·SHA-256 확인 대기 |
| 포함 파일 / 소스 해시 | 대기 |
| 원문 선택의 실제 음성 검증 | 대기. 합성 음성·모의 브리지·실제 휴대폰을 구분하여 기록 |
| Play 내부 테스트 | 게시 대기 |
| v4.7.2 웹 배포 | Actions·라이브 descriptor·고정 소스 파일 해시 확인 대기 |
| 실제 휴대폰 | 미확인 |

파일 검증 후 새 `outputs/speaking-room-0.6.3-verification.json`을 남긴다. 준비된 파일을 Play 게시 완료로 표시하지 않으며 공개 프로덕션 출시와 내부 테스트 제공 상태도 구분한다.
