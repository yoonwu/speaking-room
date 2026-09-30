# 3초영어 안드로이드 음성 앱 (시험 버전)

기존 웹앱과 같은 저장소에 추가한 네이티브 음성 앱입니다. 웹앱의 학습 기록은 아직 공유하지 않습니다. Android 8.0 이상에서 설치할 수 있습니다.

## 연결 방식

- ChatGPT의 공식 Sign in with ChatGPT 공개 클라이언트 OAuth 흐름을 사용합니다. 앱 이름은 `Speaking Room Voice`입니다.
- 시스템 브라우저 로그인, 기기 안 `127.0.0.1` 콜백, PKCE/state/nonce, JWKS 서명·issuer·audience·만료 검증을 구현했습니다.
- 기기마다 고정 host ID를 보관하고 계정별 issued client ID와 자격 정보를 분리합니다.
- 계정 토큰은 Android Keystore AES-GCM으로 암호화해 앱 전용 저장소에 보관합니다. 서버·웹앱·로그로 보내지 않으며 백업·기기 이전을 차단합니다.
- 계정의 모델 목록을 불러온 뒤 실제 연결 테스트가 완료되어야 AI 대화를 시작할 수 있습니다. 모델 목록만 보인다고 이용 권한이 검증되는 것은 아닙니다.
- AI에는 인식된 텍스트만 보냅니다. 음성 인식과 읽어주기는 Android 기능을 사용합니다. 기기 음성 인식 서비스는 오디오를 Google 등 제공업체 서버로 보낼 수 있습니다.
- 계정·앱의 구독 사용 승인과 한도가 적용됩니다. 크레딧 허용 여부는 ChatGPT 설정에서 관리합니다. 별도 API 키 결제나 Claude 호출로 자동 전환하지 않습니다.

## 설치와 최초 설정

1. 전달된 `speaking-room-voice-preview.apk`를 휴대폰으로 옮겨 설치합니다. Android의 파일을 여는 앱에 한해 필요한 경우 설치 권한을 허용합니다. Play 스토어 배포본이 아닌 개인 시험용 디버그 APK입니다.
2. `3초영어 음성`을 엽니다. `Continue with ChatGPT`를 누르고 기존 구독 계정으로 로그인합니다. 앱의 구독 사용을 승인한 뒤 이 앱으로 돌아옵니다. 계정/지역/프리뷰 정책에 따라 연결이 거절될 수 있습니다.
3. `사용 가능한 모델 불러오기` → 모델 선택 → `연결 테스트`를 누릅니다. 이 테스트는 구독 사용량을 소량 사용합니다.
4. 마이크·알림 권한을 허용하고 영어 음성 인식/읽기 데이터를 준비합니다. `안드로이드 음성 설정` 버튼을 이용할 수 있습니다.
5. 정차한 상태에서 주제를 선택하고 `5분 음성 연습 시작`을 누릅니다. 상대가 말을 마치면 영어로 답합니다.
6. 듣는 동안 `Repeat`(다시 듣기), `Help`(예시 요청), `Stop`(종료)을 말할 수 있습니다. 상대가 말하는 동안에는 음성 명령을 인식하지 않습니다. 알림의 멈추기 버튼으로 종료할 수 있습니다.
7. AI 대화 이후 `지난 대화 반복 · AI 요청 없음`을 누르면 저장된 질문에 다시 답합니다. 이 모드는 AI가 답을 채점하지 않으며 새 AI 요청을 보내지 않습니다. 마지막 대화 질문만 기기 안에 저장합니다.

## 잠금 화면과 차량 오디오 확인

마이크/재생 foreground service와 최대 6분의 partial wake lock을 사용합니다. 대화는 최대 6번 답하거나 5분 후 종료합니다. 전화·다른 오디오의 focus loss, 반복 인식 오류, AI 요청 오류가 발생하면 종료합니다. 프로세스가 종료되어도 몰래 재시작하지 않습니다.

휴대폰 제조사, 설치된 음성 인식 서비스, 영어 모델, 절전 설정, 블루투스 오디오 경로에 따라 화면 잠금 상태의 인식과 재생이 다릅니다. 자동차 Bluetooth 마이크 경로는 별도 실기기 검증 전까지 지원을 보장하지 않습니다. Android Auto 앱이 아닙니다.

출발 전에 아래를 정차 상태에서 확인하세요. 운전 중 화면 조작으로 복구하지 마세요.

- 휴대폰 자체 스피커로 질문/답변이 왕복되는지 확인합니다.
- 화면을 잠근 상태에서 최소 두 번 대화를 이어보고 `Stop`으로 종료합니다.
- 같은 검사를 차량 Bluetooth 연결 상태에서 따로 수행합니다.
- 끊기면 정차 후 Google 음성 인식의 영어 데이터, TTS 영어 음성, 앱 권한, 해당 기기의 배터리 제한을 확인합니다.

## 검증 범위

빌드·JVM 테스트·Android Lint는 개발 PC에서 실행합니다. 실제 계정 로그인, 구독 Responses 요청, 실기기 마이크·TTS, 잠금 화면·Bluetooth는 휴대폰 로그인과 실기기 테스트가 필요합니다. 설치 가능한 APK 생성은 이 테스트들의 성공을 의미하지 않습니다.

## 빌드

JDK 17과 Android SDK 35가 필요합니다. SDK 경로를 `local.properties` 또는 환경 변수로 지정하고 실행합니다.

```powershell
cd android
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

결과: `app/build/outputs/apk/debug/app-debug.apk`. 개인 디버그 서명은 다른 컴퓨터 빌드와 다를 수 있습니다. 업데이트 배포 전에는 별도 유지 가능한 release 서명을 설정해야 합니다.

## 공식 문서

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/reference/android/speech/SpeechRecognizer

구독 연결의 현재 프리뷰는 오디오 입력/전사 API를 지원하지 않으므로 ChatGPT 앱의 실시간 음성모드를 그대로 내장하지 않습니다. 텍스트 요청과 기기 음성 기능을 조합한 별도 구현입니다.
