# 3초영어 안드로이드 앱

기존 `index.html`과 학습 자료를 최초 설치에 포함하고 이후 GitHub의 최신 학습 화면을 내려받습니다. [학습 화면 자동 배포](WEB-UPDATES.md)를 참고하세요. 첫 화면은 기존 3초영어이며, 별도 주제 선택 앱 대신 기존 스피킹 훈련장의 상황을 이어갑니다. Android 8 이상에서 사용할 수 있습니다.

## 배포 준비

현재 0.4.0 / versionCode 4의 Play 배포용 빌드를 준비합니다. 아직 스토어에 등록되지 않았습니다. 정식 사용자 배포는 Play 스토어를 사용하며 APK 직접 설치·보안 해제는 안내하지 않습니다. [Play 제출 준비와 남은 항목](PLAY-RELEASE.md)을 참고하세요.

## 앱 사용

1. 정식 배포가 완료되면 Play 스토어에서 설치·업데이트합니다. 이전 개인 시험 APK와는 서명이 달라질 수 있으므로 기록은 먼저 내보내거나 동기화합니다.
2. 앱을 열고 `구독·음성` → `ChatGPT 구독 설정`을 누릅니다. `Continue with ChatGPT` → 모델 불러오기 → 모델 선택 → 연결 테스트를 완료합니다. 성공한 모델만 기존 학습의 AI 요청에 적용됩니다.
3. 기존 스피킹 훈련장 → 실전회화에서 상황을 선택하고 대화를 시작합니다. 상대의 첫 질문을 받은 뒤 `구독·음성` → `현재 대화에서 음성 시작`을 누릅니다.
4. 상대가 말한 뒤 영어로 답하면 같은 상황이 이어지고 기존 대화 화면과 학습 평가에 반영됩니다. 듣는 동안 `Repeat`, `Help`, `Stop`을 말할 수 있습니다. 도움말 요청은 학습 성공으로 기록하지 않습니다.
5. `지난 대화 반복 · AI 요청 없음`은 저장한 상대의 질문을 다시 듣고 답하는 모드입니다. AI 호출이나 자동 채점은 없습니다.

## 기존 기록 가져오기

브라우저와 설치 앱의 저장 공간은 다릅니다. 기존 웹에서 사용한 동기화 닉네임으로 앱에서도 연결하면 기존 클라우드 기록을 가져옵니다. 닉네임은 기존 웹 설정에서 먼저 확인하세요. 로컬 기록은 통합 메뉴의 `학습 기록 파일 저장` / `가져오기`로 옮길 수 있습니다. 이 파일에는 개발자 GitHub 토큰과 계정 자격 정보를 포함하지 않습니다. 브라우저 쪽 파일 내보내기 메뉴는 이 변경이 웹에 배포된 후 표시됩니다.

## 구현과 구독 연결

- 공개 클라이언트용 공식 Sign in with ChatGPT OAuth: 시스템 브라우저, localhost 콜백, PKCE/state/nonce, JWKS·issuer·audience·만료 검증.
- 토큰은 Android Keystore AES-GCM으로 암호화하며 웹 JavaScript나 학습 파일로 전달하지 않습니다. 계정별 client ID를 보관하고 계정 선택·로그아웃을 지원합니다.
- WebViewAssetLoader의 HTTPS 앱 전용 출처에서 기존 UI를 엽니다. 네이티브 메시지 연결은 해당 출처의 최상위 문서만 허용합니다.
- 설치 앱에서는 `callClaude`의 기존 호출 계약을 네이티브 Responses 요청으로 연결합니다. 구독 연결 실패 시 별도 API 키 결제나 Claude 프록시로 자동 전환하지 않습니다. 일반 브라우저의 기존 동작은 유지합니다.
- 음성 서비스가 기존 역할 지침과 대화 이력을 받아 이어가며, 사용자 발화·응답·USED/TURN_EVAL을 원래 UI의 기록 함수로 전달합니다. 메타데이터는 읽어주기에서 제거합니다.
- 음성 인식과 읽어주기는 Android 기능입니다. 인식 서비스에 따라 오디오가 Google 등 제공업체 서버로 전달될 수 있습니다. ChatGPT 앱의 음성모드를 내장한 것은 아닙니다.
- 구독 한도와 계정의 앱 사용 승인이 적용됩니다. 크레딧 사용 허용 여부는 [ChatGPT 설정](https://chatgpt.com/settings/usage)에서 관리합니다.

## 음성 동작 범위

foreground microphone/media service, 제한된 wake lock을 사용합니다. 최대 6번 답하거나 5분 후 종료하며, 통화·오디오 충돌·반복 인식 오류에서 멈춥니다. 상대가 말하는 동안에는 명령을 듣지 않습니다. 화면 잠금과 차량 Bluetooth는 제조사·음성 서비스에 따라 다르며 실제 휴대폰 검증 전에는 지원을 보장할 수 없습니다. 시작·설정·문제 복구는 정차 상태에서 진행하세요.

## 빌드와 검증

JDK 17, Android SDK 36:

```powershell
cd android
.\gradlew.bat bundleRelease testDebugUnitTest lintRelease
cd ..
node --test android/tests/native-integration.test.cjs
```

`bundleWebApp`이 저장소의 기존 UI와 JSON 학습 자료를 assets로 복사합니다. 결과는 `android/app/build/outputs/apk/debug/app-debug.apk`입니다. 개인 시험용 디버그 서명이므로 다른 PC에서 빌드할 경우 서명이 달라질 수 있습니다.

자동 검증은 OAuth 응답 검증·SSE 완료 처리·메타데이터 제거와 기존 대화/학습 기록 연결, 중복 이벤트, 도움말 평가 제외, 자격 정보 제외, 구독 호출 경로를 확인합니다. 실제 계정 로그인, 휴대폰 마이크·읽어주기, 화면 잠금·Bluetooth는 실기기 테스트가 남아 있습니다.

공식 문서: [로그인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [계정 관리](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [모델·추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [프리뷰 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [Android 로컬 웹 콘텐츠](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content).
