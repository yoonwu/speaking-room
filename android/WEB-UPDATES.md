# 학습 화면 자동 배포

0.4.0 (code 4)부터 학습 HTML/JavaScript/표현 자료는 Play 설치 파일과 별도로 갱신합니다. 현재 빌드는 0.5.0이며 네 가지 연습으로 간소화했습니다. 아직 정식 Play 배포와 실기기 검증은 완료되지 않았습니다. 이전 시험 APK에는 이 기능이 없어 최초 전환에는 새 앱 버전 설치가 필요합니다.

## 사용자에게 반영되는 시점

- 앱을 새로 실행할 때 최신 배포를 확인하고 완전히 내려받은 뒤 엽니다. 확인/다운로드는 약 20초의 제한이 있으며 네트워크 읽기 제한 때문에 수 초 더 걸릴 수 있습니다.
- 1분 이상 다른 앱에 있다가 돌아오면 다시 확인합니다. 홈 화면일 때만 적용하고 진행 중인 학습은 바꾸지 않습니다.
- 홈 하단의 ‘업데이트 확인’으로 즉시 확인할 수 있습니다. 대화·듣기·단어 학습 등에서는 먼저 홈으로 돌아갑니다.
- 오프라인/배포 오류/검증 실패 시 마지막 정상 배포를 사용하고, 캐시가 없으면 설치 파일의 화면을 사용합니다. 원래 HTTPS 앱 출처를 유지하므로 학습 localStorage와 로그인 정보는 유지됩니다.

## 수정 → 배포

현재 통합 작업 브랜치 `codex/android-chatgpt-voice` 또는 통합 후 `main`에 학습 파일을 커밋하고 push하면 `Publish Android learning screen` GitHub Actions가 실행됩니다. 로컬 수정만으로는 반영되지 않습니다. 검증 후 `android-web-live` 브랜치의 배포 설명서를 갱신합니다. 네이티브 코드만 바꿀 때는 학습 배포가 실행되지 않습니다.

설명서는 원본의 불변 커밋 SHA와 파일별 크기/SHA-256을 담습니다. 앱은 고정된 저장소의 HTTPS 주소만 사용하고 리다이렉트를 거부합니다. 모든 파일이 일치할 때만 원자적으로 활성화합니다. 배포 설명서의 해시는 GitHub 계정과 TLS에 대한 신뢰에 기반하며 별도의 개발자 서명은 아닙니다. GitHub 쓰기 권한은 실행 가능한 앱 화면의 배포 권한입니다.

자동 배포 목록은 `scripts/android-web-release.cjs`에서 관리합니다. 새 CSS/JS/이미지 파일을 추가하면 여기에 포함해야 합니다. 파일을 임의 외부 URL에서 로드하거나 네이티브 토큰을 JS에 전달하지 않습니다. 배포 파일은 80개/합계 24MB/파일 8MB 이내입니다. 새 앱 시작 시 이전 캐시는 하나만 남깁니다.

## Play 업데이트가 필요한 변경

로그인/마이크/Android 권한/새 네이티브 메시지 동작/서명/target API는 AAB 재배포가 필요합니다. 이때 `android/web-release-config.json`의 `minimumNativeVersion` 또는 `bridgeVersion`을 함께 조정합니다. 구버전 앱은 호환되지 않는 화면을 적용하지 않고 이전 화면을 유지합니다. 웹 배포에도 Play 정책과 데이터 공개 의무가 적용되며 심사 통과를 보장하지 않습니다.

문제가 있는 학습 배포는 GitHub Actions에서 이전 정상 소스 커밋을 다시 배포하거나 정상 상태를 복원하여 push합니다. 되돌릴 때도 학습 기록은 삭제하지 않습니다.

검증: Node 네 가지 연습·음성 연결·배포 설명서 검사, JVM 크기/해시/경로/호환성/부분 다운로드 검사, release lint/AAB 빌드. 실제 폰에서 네트워크 차단·복귀·다운로드 중 종료·기록 유지·연습 중 미갱신은 추가 검증이 필요합니다.

[Android WebView 콘텐츠 문서](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [Google Play 네이티브 연결 보안 안내](https://support.google.com/googleplay/android-developer/answer/10768383?hl=en).
