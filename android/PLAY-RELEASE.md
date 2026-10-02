# Play 스토어 배포 준비

현재 상태: 배포용 코드/빌드 검증 중. Play Console 업로드, 계정별 로그인/음성 실기기 검증, 스토어 심사는 완료되지 않았습니다. APK 직접 설치나 보안 해제를 사용자 배포 경로로 안내하지 않습니다.

앱 이름: 3초영어. 패키지: com.speakingroom.voice. 버전: 0.5.0 / code 5. Android 8 이상, target API 36. 여행 표현·골라서 연습·자주 틀리는 문장·AI 실전회화만 포함하며 이후 학습 화면은 [자동 배포](WEB-UPDATES.md)로 갱신합니다. 사용자는 각자의 ChatGPT 계정으로 공식 로그인하고 앱 사용을 승인합니다.

## AAB 빌드와 서명

JDK 17, SDK 36을 준비하고 android/gradlew.bat bundleRelease testDebugUnitTest lintRelease 를 실행합니다. 업로드 키가 없으면 AAB는 서명되지 않으며 Play Console에 제출할 수 없습니다. 디버그 키는 정식 제출에 사용하지 않습니다.

업로드 키를 안전하게 보관하고 아래 환경 변수를 빌드 프로세스에 제공하세요. 비밀번호와 키를 Git/채팅에 넣지 않습니다.

- SR_UPLOAD_STORE: 업로드 키스토어 절대 경로
- SR_UPLOAD_STORE_PASSWORD
- SR_UPLOAD_KEY_ALIAS
- SR_UPLOAD_KEY_PASSWORD

Play App Signing을 사용하면 Google이 배포 서명을 관리하고 개발자의 업로드 키로 AAB를 제출합니다. 기존 공개 앱이 있다면 새 키나 패키지를 만들지 말고 기존 등록과 서명을 먼저 확인합니다. 이전 시험 APK의 디버그 서명은 Play 배포 서명과 달라 스토어 버전으로 갈아탈 때 학습 기록 이전이 필요할 수 있습니다.

## 제출 전에 필요한 항목

- Play 개발자 계정 및 기존 앱 등록 여부 확인. 계정이 없는 경우 운영자가 등록/본인 확인/결제를 직접 완료합니다.
- 운영자 이름, 문의 이메일, 최종 개인정보 처리방침 공개 URL.
- privacy.html은 검토용: 운영자·클라우드 보관/삭제 절차를 확인하기 전 공개용 정책으로 제출하지 않습니다.
- 닉네임 동기화·랭킹은 사용자의 요청으로 복원했습니다. 이전 동기화 서버에 남은 기록의 보관/삭제 요청 절차는 운영자가 확인해야 합니다.
- 데이터 보안 양식은 현재 네 가지 연습의 대화 전달, 프록시/Microsoft 음성 처리, Android 음성 서비스의 전송을 포함해 실제 동작과 맞게 작성합니다. 동기화를 연결하면 학습 기록이 서버에 저장되고 표시 이름과 요약 통계가 랭킹에 공개됩니다. 로그인 토큰과 대화 내용은 동기화하지 않습니다. 발음 점수 기능은 제거했습니다. ‘아무 데이터도 수집하지 않음’으로 작성하지 않습니다.
- 마이크/재생 foreground service 용도와 시연 자료, 콘텐츠 등급, 대상 연령, 광고/앱 접근 권한 양식.
- 실제 두 개 이상의 사용자 계정에서 로그인, 계정 변경, 구독 요청 성공/거절/한도, 로그아웃/연결 정보 삭제, 학습 기록 연결을 확인합니다.
- Android 8 및 최신 OS의 마이크/TTS/화면 잠금/통화 충돌/뒤로 가기/재접속, 설치·업데이트를 확인합니다. 차량 Bluetooth는 별도 검증 전 지원을 표시하지 않습니다.
- 스토어 아이콘/스크린샷/피처 이미지와 내부 테스트. 새 개인 개발자 계정은 프로덕션 신청 전 별도 비공개 테스트 요건이 적용될 수 있습니다.

## 스토어 문구 초안

이름: 3초영어
짧은 설명: 짧은 표현을 반복하고, 상황 속에서 영어로 듣고 답하는 학습 앱
상세 설명: 3초영어는 짧은 시간에 표현을 떠올리고 말하는 연습을 돕습니다. 기존 표현 학습과 실전회화에서 상황을 골라 연습하고, 안드로이드 음성 기능으로 듣고 답할 수 있습니다. ChatGPT 연결은 각자의 계정으로 로그인한 후 이용하며 해당 계정의 승인·이용 가능 여부·사용량 한도가 적용됩니다. 별도 지난 대화 반복 메뉴는 없습니다. 발음·읽어주기는 기기와 음성 서비스에 따라 달라질 수 있습니다. 화면 잠금과 차량 Bluetooth 동작은 기기별로 확인이 필요합니다.

## 공식 문서

- https://developer.android.com/studio/publish/app-signing
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in

2026-09-30 기준 확인. 심사 통과나 모든 계정의 구독 사용을 보장하지 않습니다.
