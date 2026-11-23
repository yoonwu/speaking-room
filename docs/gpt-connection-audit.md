# GPT 연결 감사 및 의미 중심 모드 운영 안내

확인일: 2026-11-07. 이 변경에서는 계정 연결, 크레딧 지급, 결제 수단, 자동 충전, 서버 비밀정보를 변경하지 않았다. OpenAI 실제 호출은 수행하지 않았고 테스트는 전부 fetch 대역을 사용한다.

## 기존 연결 분석

| 기존 구현 | 확인된 역할 | 이번 변경에서의 처리 |
| --- | --- | --- |
| Android `PlanClient.java` | `auth.openai.com` 로그인, PKCE S256, 계정별 OAuth 토큰 갱신. 요청 scope에 `chatgpt.tokens.use.direct` 포함 | 기존 계정 연결과 AI 대화 기능 유지 |
| `PlanClient.models()` / `respond()` | 로그인 토큰으로 모델 조회 및 `/v1/responses` 텍스트 응답 | 기존 텍스트 기능에서 계속 사용. 음성 API 권한이나 조직 크레딧 증명으로 해석하지 않음 |
| Android 인증정보 저장 | 앱 전용 `plan` SharedPreferences의 `credentials`에 AES/GCM 암호문. 암호화 키는 AndroidKeyStore의 `speaking-room-plan` | 비밀정보 조회·추출·이동 없음. 브라우저 저장소로 전달하지 않음 |
| 기존 Worker `/stt2` | 서버 `env.OPENAI_API_KEY`로 `/v1/audio/transcriptions` 호출. 기존 기본 모델 `gpt-4o-transcribe` | 레거시 동작 그대로 유지 |
| 기존 `/stt`, `/pronounce` | 서버 Azure Speech 비밀키 사용 | 정확도 중심 모드와 발음 점수 유지 |

기존 코드만으로 OAuth 계정의 현재 동의 범위, API 조직 연결, 실제 크레딧 지급 또는 잔액을 증명할 수 없다. 따라서 의미 중심 모드는 **기존 Worker API 키 보관 구조를 재사용**한다. 소비자 로그인 토큰을 서버 API 키처럼 사용하거나 노출하지 않는다. 개발자 조직의 크레딧으로 여러 학습자의 요청을 처리하려는 목적에도 이 경로가 맞는다.

## 소유자가 직접 해야 하는 Pro 크레딧 확인

OpenAI 공식 문서에 따르면 자격을 충족한 Pro $200 구독의 전체 결제 주기 API 제공액은 $200이다. 최초 지급액은 남은 기간에 따라 달라질 수 있고, 구독은 최소 7일 활성 상태여야 한다. 구독 보유와 실제 지급은 별개다. [공식 API 크레딧 혜택 안내](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)

1. 구독 소유자가 같은 이메일의 ChatGPT와 API 계정으로 로그인한다.
2. ChatGPT **설정 → 결제 → API 크레딧 혜택**에서 받을 API 조직을 확인하고 활성화한다. 받을 조직의 소유자 권한이 필요하다.
3. API Platform에서 **연결한 조직**을 선택하고 **Billing → Credit grants**를 연다. 지급 여부, 실제 남은 제공 크레딧, 만료일을 직접 확인한다.
4. 그 조직 안의 전용 프로젝트를 사용한다. 기존 API 키가 그 프로젝트의 키인지 확인하고, 필요할 때만 서버 비밀정보 관리 화면에서 프로젝트 키를 교체한다. 키를 채팅, 앱 코드, HTML, localStorage 또는 로그에 붙이지 않는다.
5. 아래 서버 설정의 조직·프로젝트가 실제 지급 대상과 일치하는지 확인한 뒤에만 기능을 켠다. 이 작업에서는 이 설정을 대신 수행하지 않았다.

활성 프로모션 크레딧을 쓰는 데 API 결제 수단 추가는 필요하지 않다. 이 구현은 결제 수단 등록·유료 크레딧 구매·자동 충전을 수행하지 않는다. 제공 크레딧은 연결된 조직에만 적용되며, 별도 구매 크레딧이 있으면 제공액 소진 뒤에도 API 호출이 계속될 수 있다. 제공 크레딧만 사용하려면 **유료 크레딧과 자동 충전이 없는 전용 연결 조직/프로젝트 구성**을 소유자가 확인해야 한다. 프로젝트를 나누는 것만으로 조직 전체 잔액이 분리되는 것은 아니다. [공식 지급·과금 설명](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)

## 서버 설정: 기본값은 비활성

다음 항목은 모두 Cloudflare Worker의 서버 환경변수/비밀정보다. 실제 값은 배포 코드나 앱으로 전달하지 않는다.

| 이름 | 소유자가 확인하고 넣을 값 |
| --- | --- |
| `OPENAI_API_KEY` | 기존 서버 API 비밀키. 지급 대상 조직의 전용 프로젝트 키 |
| `OPENAI_ORGANIZATION` | 지급 대상 `org-...` |
| `OPENAI_PROJECT` | 전용 `proj_...` |
| `PRACTICE_AI_CREDIT_ORGANIZATION` | 소유자가 Credit grants에서 확인한 조직. 위 조직과 반드시 일치 |
| `PRACTICE_AI_CREDIT_PROJECT` | 소유자가 확인한 전용 프로젝트. 위 프로젝트와 반드시 일치 |
| `PRACTICE_AI_CREDIT_GRANT_USD` | 확인 시점에 실제로 사용 가능한 제공 크레딧 금액. 명목 $200을 추측해서 입력하지 않음 |
| `PRACTICE_AI_CREDIT_EXPIRES_AT` | 실제 제공 크레딧 만료일의 ISO 8601 시각 |
| `PRACTICE_AI_CREDIT_CHECKED_AT` | 실제 잔액/지급/조직을 확인한 ISO 8601 시각. 24시간이 지나면 닫힘 |
| `PRACTICE_AI_MONTHLY_BUDGET_USD` | 앱의 보수적인 월 예약 한도. `0`보다 크고 실제 확인액과 `$5` 중 작은 값 이하 |
| `PRACTICE_AI_CREDITS_VERIFIED` | 위 실제 확인을 마친 경우에만 문자열 `true` |
| `PRACTICE_AI_CREDITS_ONLY_CONFIRMED` | 제공액만 사용하는 조직의 결제/충전 구성을 소유자가 확인한 경우에만 `true` |
| `PRACTICE_AI_ENABLED` | 모든 확인을 마친 뒤에만 `true`. 없거나 다른 값이면 항상 닫힘 |
| `USERDATA` | 기존 KV 바인딩 재사용. 새 저장소 바인딩 없음 |

날짜는 UTC `Z` 또는 명시적 시간대 오프셋을 포함한다. 서버는 확인 시각이 24시간 이내인지, 만료가 지나지 않았는지, 조직/프로젝트가 일치하는지 확인하고 두 식별자를 OpenAI 요청 헤더에 명시한다. 소유자는 매일 실제 잔액과 지급 상태를 다시 확인해야 하며, 갱신 시 확인 시각만 기계적으로 미루면 안 된다. 외부 앱이 같은 조직의 크레딧을 쓰면 남은 액수가 달라질 수 있다.

이 설정은 소유자의 **수동 확인 기록**이다. API 실제 잔액 조회나 소유권 검증을 수행하지 않는다. 공개 status의 `creditsVerified:true`는 그 기록이 유효하다는 뜻이고, `balanceVerified`는 항상 `false`다. 실제 잔액 확인 전에는 `PRACTICE_AI_ENABLED`를 켜지 않는다.

## API 계약

모든 새 응답은 `Cache-Control: no-store`다. 오류는 `{ok:false,error:{code,message,retryable}}` 형식으로 반환하며 업스트림 오류 원문이나 비밀키를 반환하지 않는다.

### `GET /practice-ai/status`

비밀정보를 포함하지 않는 준비 상태다. OpenAI 호출을 하지 않는다.

```json
{
  "enabled": false,
  "creditsVerified": false,
  "balanceVerified": false,
  "verification": "unverified",
  "reason": "ai_disabled",
  "models": {"transcribe":"gpt-4o-mini-transcribe","judge":"gpt-5-nano"},
  "limits": {"maxAudioBytes":1048576,"maxAudioSeconds":25},
  "usage": {
    "month":"2026-11", "reservedUsd":0,
    "calls":{"transcribe":0,"judge":0},
    "monthlyBudgetUsd":0, "estimated":true, "hardLimit":false
  }
}
```

준비 불가 이유: `ai_disabled`, `api_key_missing`, `credits_unverified`, `credit_scope_mismatch`, `credits_expired`, `credit_check_stale`, `budget_unconfigured`, `budget_exhausted`, `storage_unavailable`. 정상 준비 시 `reason:"ready"`, `verification:"owner-attested"`다.

### `POST /practice-ai/transcribe`

- 본문: 실제 PCM WAV 바이트. `Content-Type: audio/wav`.
- 헤더: `X-Practice-Request-Id`에 새 발화별 8~80자 영숫자/`_`/`-` ID.
- RIFF/PCM 형식, 16-bit, 1~2채널, 8~48 kHz, 실제 컨테이너 길이, 0.1~25초 및 1 MiB 제한을 서버에서 확인한다. 임의의 클라이언트 duration 값을 믿지 않는다. 브라우저 압축 녹음은 클라이언트에서 PCM WAV로 변환한다.
- 목표 정답/문맥 prompt는 받지도, OpenAI STT에 전달하지도 않는다. 영어 언어 힌트만 사용한다.
- 무음에 가까운 PCM은 로컬 `NoMatch`로 처리한다. 텍스트가 비거나 알아들을 수 없으면 추측하지 않고 다시 말하기를 반환한다. 에너지 검사만으로 말소리 여부를 완벽히 증명하지는 못하므로 클라이언트 VAD도 유지한다.
- 응답: `{ok:true,requestId,transcript,DisplayText,RecognitionStatus,retry,usage}`. Azure 호환 필드도 포함한다.
- `usage`: 모델, 실제 호출 수, 오디오 초, 추정 USD, 보수적인 예약 USD, 전체 처리 `elapsedMs`.

### `POST /practice-ai/judge`

본문: `{requestId,expected,transcript}`. 문장당 최대 400자, 전체 요청 4 KiB. 목표/실제 발화를 별도 JSON 데이터로 전달한다.

정규화한 동일 문장, 빈 발화, 명백한 부정·수량 변경 및 일부 고확신 항목 변경은 서버에서도 로컬 판정한다. 그 외에만 추가 모델 호출을 사용한다. 예를 들어 물과 커피를 바꾸면 모델이 잘못 통과시켜도 로컬에서 거절한다. 이 사전 검사는 의미 사전 전체를 대신하지 않는다.

모델에는 엄격한 JSON Schema를 지정한다. `verdict`, 수치 confidence, 핵심어 일치 여부, 부정/항목/수량 변경 boolean을 서버에서 다시 검사한다. `equivalent`, confidence 0.85 이상, 핵심어 일치, 모든 모순 플래그 false인 경우에만 통과한다. 누락 필드, 추가 필드, 문자열 boolean, 거부, 토큰 한도 종료, 잘못된 JSON은 통과하지 않는다. 불명확한 발화나 불충분한 근거는 재시도다. 문자열에 담긴 지시를 모델 지시로 취급하지 않는다.

응답: `{ok:true,requestId,pass,retry,reason,usage}`. reason은 `equivalent`, `meaning_changed`, `unintelligible`, `uncertain` 중 하나다. 의미 비교는 음소별 발음 점수가 아니다. 기존 Azure 발음 점수와 정확도 중심 판정은 유지한다.

### 오류, 시간 제한, 중복 방지

주요 오류: `bad_audio`/`bad_request` 400, 큰 입력 413, `request_conflict`/`request_in_progress` 409, `budget_exhausted`/`upstream_quota` 402, `rate_limited` 429, `upstream_error`/`invalid_judgment` 502, 준비 불가 503, `upstream_timeout` 504.

STT 12초, 추가 의미 비교 6초로 업로드/응답 전체 기한을 둔다. 자동 업스트림 재시도는 없다. 동일 IP 해시·기능·요청 ID·입력 해시는 10분 동안 저장된 결과를 재사용하며, 같은 ID에 다른 입력은 충돌로 처리한다. 타임아웃/오류 결과도 저장해서 결과를 모른 채 같은 요청을 곧바로 재전송하여 비용이 중복될 가능성을 줄인다. 새 실제 발화에는 새 ID가 필요하다. 새 ID로 무조건 재시도하는 루프를 만들지 않는다.

## 비용, 저장 및 한도에 대한 정확한 의미

[공식 API 가격표](https://developers.openai.com/api/docs/pricing) 기준 `gpt-4o-mini-transcribe`의 추정 요금은 분당 `$0.003`이다. 5초 약 `$0.00025`, 10초 약 `$0.0005`, 25초 약 `$0.00125`다. 청구는 제공자 토큰/사용량 규칙을 따르므로 초 단위 값은 예상치다.

[GPT-5 nano 공식 모델 문서](https://developers.openai.com/api/docs/models/gpt-5-nano) 기준 텍스트 입력 100만 토큰 `$0.05`, 출력 `$0.40`이며 Structured Outputs를 지원한다. 500 입력 + 80 출력 토큰이면 약 `$0.000057`다. `reasoning_effort:minimal`, 출력 최대 400 토큰을 사용한다. 실제 추가 비교가 생략되면 이 호출 비용은 0이다. 출력 한도에 걸리면 정답을 추측하지 않는다.

확인일 현재 `gpt-5-nano`와 `gpt-4o-mini-transcribe`는 deprecated 상태지만 아직 제공된다. [음성 API 공식 문서](https://developers.openai.com/api/docs/guides/speech-to-text)는 기존 mini transcription 모델 종료일을 2027-02-26으로 안내한다. **실제 사용 활성화 전과 해당 날짜 전에** 모델 지원·가격·대표 아동/초보 발화 정확도를 재확인하고, 모델과 비용 상수를 함께 교체해야 한다. `gpt-4.1-nano`는 공식 문서에서 종료 상태여서 기본 모델로 채택하지 않았다. 모델 ID만 바꾸면 비용 예상이 틀릴 수 있어 새 경로의 모델을 임의 env override로 받지 않는다.

각 유료 호출 전에 STT `$0.00125`, judge `$0.001`를 보수적으로 예약한다. 실패/타임아웃도 예약을 돌려주지 않는다. 월 `reservedUsd`는 **실제 청구액/남은 제공 잔액이 아닌 앱의 예약 합계**다. 월은 UTC 달력 기준이며 구독 결제 주기와 다를 수 있다. 기능별 호출 수와 개별 응답의 모델·시간·예상비용을 제공한다. 전사 오디오 자체는 KV에 저장하지 않는다. 요청 fingerprint, 10분짜리 결과(전사 텍스트 포함), 비가역 IP 해시 기반 요청/속도 키와 월 예약 합계가 저장된다.

**현재 KV 한도와 중복 방지는 최선형 보호이며 결제 상한 보장이 아니다.** KV는 최종 일관성이고 원자적 read-modify-write가 아니므로 다른 지역/동시 요청은 같은 예산을 보고 예약을 중복 처리하거나 중복 호출할 수 있다. 격리 인스턴스 안에서는 중복 요청을 추가로 막는다. 공개 엔드포인트는 사용자 인증을 추가하지 않았으므로 인증된 접근 계층과 원자적 예산 예약이 없는 대규모 공개 서비스의 비용 방어 수단으로 사용하면 안 된다. 실제 결제 방지는 소유자가 확인한 제공액 전용 조직 구성에 의존한다. [Cloudflare KV 일관성 설명](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

같은 KV 키 쓰기는 초당 1회 제한이 있다. 매우 빠르거나 동시인 요청은 예약 저장에 실패하여 **유료 호출 전에** `storage_unavailable`로 닫힐 수 있다. 결과와 진행 표시는 서로 다른 키로 써서 정상 요청 안에서 같은 키를 두 번 쓰지 않는다. [KV 공식 제한](https://developers.cloudflare.com/kv/platform/limits/)

키가 있는 기존 `/stt2` 등 레거시 경로에는 이번 새 크레딧 게이트를 소급 적용하지 않았다. 이 호환성 보존 선택 때문에 새 경로의 월 예약 수치가 조직 전체 비용을 대표하지 않는다. 다른 앱·Playground·기존 경로가 같은 조직을 쓰는 경우도 실제 잔액에서 따로 확인해야 한다.

## 정확도 중심 실시간 Azure 경로

`GET /practice-realtime/status`는 `{available,version:"worker-v10"}`을 반환한다. `available`은 기존 Azure 비밀키, 안전한 지역 설정, WebSocket 실행 환경 유무만 확인한다. 서비스 건강이나 유료 잔액을 확인하는 API 호출은 하지 않는다.

`GET /practice-realtime?language=en-US&format=detailed`는 WebSocket Upgrade 및 `USP` 하위 프로토콜을 받는다. Worker는 목적지를 기존 지역의 고정 Azure STT conversation 주소로 만들고 **서버 Azure 키만** 넣는다. 클라이언트 Authorization, subscription key, 대상 host, 정답/phrase 힌트 또는 미지의 쿼리는 업스트림으로 보내지 않는다. 영어/상세 결과, 유효 연결 UUID, 제한된 profanity/무음 시간 설정만 허용한다. Azure의 101 응답과 실제 소켓을 확인하고, 프로토콜 헤더가 `USP`이거나 없는 경우에만 클라이언트와 `USP`를 협상한다. 명시적으로 다른 프로토콜은 거절한다. 운영 진단에서 Azure의 헤더 생략을 확인했다. `redirect:manual`로 다른 목적지에 키를 재전송하지 않는다.

연결 준비 10초, 전체 연결 30초, 전송 오디오 총 1 MiB, 텍스트 총 64 KiB/프레임 16 KiB, 메시지 1,500개, 서버 응답 총 2 MiB로 제한한다. 한쪽 종료/오류/제한 초과 시 양쪽을 닫는다. 기존 Azure 비용/키를 재사용하며 Pro/OpenAI 크레딧과 별개다. [Cloudflare 공식 WebSocket 예제](https://developers.cloudflare.com/workers/examples/websockets/), [바이너리 프레임과 연결 처리](https://developers.cloudflare.com/workers/runtime-apis/websockets/)

Worker 테스트는 실제 Azure 연결 품질이나 단말의 마이크 지연을 증명하지 않는다. 실제 SDK/단말 테스트는 별도로 수행해야 하며, 빨라 보이기 위해 문장 중간 휴지를 정답으로 추정하는 처리는 넣지 않는다.

## 검증 명령

```powershell
node --test android/tests/meaning-worker.test.cjs android/tests/worker-realtime.test.cjs android/tests/worker-speech.test.cjs
```

크레딧 비활성 시 업스트림 0회, 잘못된 조직/프로젝트·만료·오래된 확인·예산·KV 오류, WAV 크기/길이/무음, 중복/동시 요청, 잔액 소진/타임아웃, 의미상 동의어와 부정/항목/숫자 모순, 지시문 주입과 잘못된 모델 출력, WebSocket 목적지/키 격리·프레임 순서·용량·종료·시간 제한 및 기존 STT 스트리밍을 대역 테스트한다. 실제 크레딧 활성화, 실제 API 사용/과금과 운영 배포는 이 테스트에 포함되지 않는다.
