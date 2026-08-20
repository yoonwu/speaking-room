/* ============================================================
 * speaking-room 기본동사 덱 — 레퍼런스 파일
 *
 * 이 파일이 신규 동사 제작의 유일한 기준이다.
 * 스키마 / 갈래 이름 / 한국어 문체 / 주석 톤을 그대로 따를 것.
 *
 * 구성
 *   1. BASIC_VERBS  — get 42개 (수정 금지) + have 42개
 *   2. SENSE_INFO   — SENSE_INFO[verb][sense] 갈래별 코어 이미지
 *   3. ITEM_NOTE    — 개별 주석 (동사당 전부가 아니라 틀리는 지점에만)
 *   4. getExplainHTML / attachExplain — 답지 설명 패널
 * ============================================================ */


/* ---------- 1. 덱 ---------- */

const BASIC_VERBS = [
  { verb: 'get', sense: '획득', ko: '표 어디서 사요?',            en: 'Where can I get a ticket?' },
  { verb: 'get', sense: '획득', ko: '문자 받았어',                en: 'I got a text' },
  { verb: 'get', sense: '획득', ko: '커피 사올게',                en: "I'll get a coffee" },
  { verb: 'get', sense: '획득', ko: '물 좀 갖다줄래?',            en: 'Can you get me some water?' },
  { verb: 'get', sense: '획득', ko: '(전화·초인종) 내가 받을게',  en: "I'll get it" },
  { verb: 'get', sense: '획득', ko: '이건 내가 계산할게',         en: "I'll get this" },
  { verb: 'get', sense: '획득', ko: '그거 어디서 났어?',          en: 'Where did you get that?' },
  { verb: 'get', sense: '획득', ko: '방 하나 잡았어',             en: 'I got a room' },

  { verb: 'get', sense: '이동', ko: '공항 어떻게 가요?',          en: 'How do I get to the airport?' },
  { verb: 'get', sense: '이동', ko: '몇 시에 집에 와?',           en: 'What time do you get home?' },
  { verb: 'get', sense: '이동', ko: '차 타',                      en: 'Get in the car' },
  { verb: 'get', sense: '이동', ko: '여기 어제 도착했어',         en: 'I got here yesterday' },
  { verb: 'get', sense: '이동', ko: '지하철 타',                  en: 'Get on the subway' },
  { verb: 'get', sense: '이동', ko: '여기서 내려요',              en: 'Get off here' },
  { verb: 'get', sense: '이동', ko: '나가',                       en: 'Get out' },
  { verb: 'get', sense: '이동', ko: '몇 시에 일어나?',            en: 'What time do you get up?' },
  { verb: 'get', sense: '이동', ko: '언제 돌아와?',               en: 'When do you get back?' },

  { verb: 'get', sense: '변화', ko: '피곤해지네',                 en: "I'm getting tired" },
  { verb: 'get', sense: '변화', ko: '어두워지고 있어',            en: "It's getting dark" },
  { verb: 'get', sense: '변화', ko: '길 잃었어',                  en: 'I got lost' },
  { verb: 'get', sense: '변화', ko: '걔네 작년에 결혼했어',       en: 'They got married last year' },
  { verb: 'get', sense: '변화', ko: '감기 걸렸어',                en: 'I got a cold' },
  { verb: 'get', sense: '변화', ko: '점점 나아지고 있어',         en: "It's getting better" },
  { verb: 'get', sense: '변화', ko: '배고파지네',                 en: "I'm getting hungry" },
  { verb: 'get', sense: '변화', ko: '나 취했어',                  en: 'I got drunk' },
  { verb: 'get', sense: '변화', ko: '늦었네',                     en: "It's getting late" },
  { verb: 'get', sense: '변화', ko: '적응되고 있어',              en: "I'm getting used to it" },
  { verb: 'get', sense: '변화', ko: '나 잘렸어',                  en: 'I got fired' },

  { verb: 'get', sense: '사역', ko: '이거 고쳐줄 수 있어?',       en: 'Can you get this fixed?' },
  { verb: 'get', sense: '사역', ko: '걔한테 전화하라고 할게',     en: "I'll get him to call you" },
  { verb: 'get', sense: '사역', ko: '애들 준비시켜',              en: 'Get the kids ready' },
  { verb: 'get', sense: '사역', ko: '나 머리 잘랐어',             en: 'I got my hair cut' },
  { verb: 'get', sense: '사역', ko: '도와줄 사람 구해볼게',       en: "I'll get someone to help" },
  { verb: 'get', sense: '사역', ko: '그거 다 끝냈어',             en: 'I got it done' },

  { verb: 'get', sense: '이해', ko: '무슨 말인지 모르겠어',       en: "I don't get it" },
  { verb: 'get', sense: '이해', ko: '알아들었어?',                en: 'Did you get that?' },
  { verb: 'get', sense: '이해', ko: '이해했어',                   en: 'I got it' },
  { verb: 'get', sense: '이해', ko: '무슨 말인지 알겠어',         en: 'I get what you mean' },
  { verb: 'get', sense: '이해', ko: '아 이제 알겠다',             en: 'Now I get it' },

  { verb: 'get', sense: '관용', ko: '이거 좀 버려줘',             en: 'Get rid of this' },
  { verb: 'get', sense: '관용', ko: '걔랑 잘 지내?',              en: 'Do you get along with him?' },
  { verb: 'get', sense: '관용', ko: '자, 슬슬 가자',              en: "Let's get going" },

  { verb: 'have', sense: '소유', ko: '시간 있어?',                en: 'Do you have time?' },
  { verb: 'have', sense: '소유', ko: '방 있어요?',                en: 'Do you have a room?' },
  { verb: 'have', sense: '소유', ko: '자리 있어요?',              en: 'Do you have a table?' },
  { verb: 'have', sense: '소유', ko: '더 작은 거 있어요?',        en: 'Do you have a smaller size?' },
  { verb: 'have', sense: '소유', ko: '차 있어?',                  en: 'Do you have a car?' },
  { verb: 'have', sense: '소유', ko: '애들 있어요?',              en: 'Do you have kids?' },
  { verb: 'have', sense: '소유', ko: '현금이 없어',               en: "I don't have cash" },
  { verb: 'have', sense: '소유', ko: '예약했어요',                en: 'I have a reservation' },
  { verb: 'have', sense: '소유', ko: '질문 있어요',               en: 'I have a question' },
  { verb: 'have', sense: '소유', ko: '감기 걸렸어',               en: 'I have a cold' },
  { verb: 'have', sense: '소유', ko: '머리 아파',                 en: 'I have a headache' },
  { verb: 'have', sense: '소유', ko: '열이 나요',                 en: 'I have a fever' },

  { verb: 'have', sense: '경험', ko: '아침 먹었어?',              en: 'Did you have breakfast?' },
  { verb: 'have', sense: '경험', ko: '점심 뭐 먹지?',             en: 'What should we have for lunch?' },
  { verb: 'have', sense: '경험', ko: '저녁 같이 먹을래?',         en: 'Do you want to have dinner?' },
  { verb: 'have', sense: '경험', ko: '커피 한잔 하자',            en: "Let's have a coffee" },
  { verb: 'have', sense: '경험', ko: '한잔 할래?',                en: 'Do you want to have a drink?' },
  { verb: 'have', sense: '경험', ko: '좀 봐도 될까요?',           en: 'Can I have a look?' },
  { verb: 'have', sense: '경험', ko: '재밌게 놀아',               en: 'Have a good time' },
  { verb: 'have', sense: '경험', ko: '좋은 하루 보내세요',        en: 'Have a nice day' },
  { verb: 'have', sense: '경험', ko: '조심히 가세요',             en: 'Have a safe trip' },
  { verb: 'have', sense: '경험', ko: '우리 재밌었어',             en: 'We had fun' },
  { verb: 'have', sense: '경험', ko: '우리 파티 할 거야',         en: "We're having a party" },
  { verb: 'have', sense: '경험', ko: '오늘 힘들었어',             en: 'I had a long day' },

  { verb: 'have', sense: '의무', ko: '나 가야 돼',                en: 'I have to go' },
  { verb: 'have', sense: '의무', ko: '꼭 가야 돼?',               en: 'Do you have to go?' },
  { verb: 'have', sense: '의무', ko: '안 가도 돼',                en: "You don't have to go" },
  { verb: 'have', sense: '의무', ko: '기다려야 돼요?',            en: 'Do I have to wait?' },
  { verb: 'have', sense: '의무', ko: '갈아타야 돼요?',            en: 'Do I have to transfer?' },
  { verb: 'have', sense: '의무', ko: '예약해야 돼요?',            en: 'Do I have to book?' },
  { verb: 'have', sense: '의무', ko: '일찍 일어나야 돼',          en: 'I have to get up early' },
  { verb: 'have', sense: '의무', ko: '미안하다고 안 해도 돼',     en: "You don't have to say sorry" },

  { verb: 'have', sense: '사역', ko: '나 머리 잘랐어',            en: 'I had my hair cut' },
  { verb: 'have', sense: '사역', ko: '차 고쳤어',                 en: 'I had my car fixed' },
  { verb: 'have', sense: '사역', ko: '이거 배달돼요?',            en: 'Can I have this delivered?' },
  { verb: 'have', sense: '사역', ko: '방 청소해 주세요',          en: 'Can I have my room cleaned?' },
  { verb: 'have', sense: '사역', ko: '이거 세탁 맡길게요',        en: 'Can I have this washed?' },
  { verb: 'have', sense: '사역', ko: '걔한테 전화하라고 할게',    en: "I'll have him call you" },

  { verb: 'have', sense: '관용', ko: '전혀 모르겠어',             en: 'I have no idea' },
  { verb: 'have', sense: '관용', ko: '잠깐 얘기 좀 해',           en: 'Can I have a word?' },
  { verb: 'have', sense: '관용', ko: '마음대로 해',               en: 'Have it your way' },
  { verb: 'have', sense: '관용', ko: '나 요즘 정신없어',          en: 'I have a lot going on' },
];


/* ---------- 2. 갈래별 코어 이미지 ----------
 * SENSE_INFO[verb][sense] 2단 구조. 같은 갈래 이름이라도 동사마다 코어 이미지가 다르다.
 */

const SENSE_INFO = {
 'get': {
  '획득': {
    title: '없던 게 내 쪽으로 넘어옴',
    core: '물건이든 정보든 자리든, 내 손에 없던 것이 들어오는 것. buy / receive / bring 자리를 get이 다 먹는다.',
  },
  '이동': {
    title: '내가 그 위치로 넘어감',
    core: 'go는 출발에, get은 도착에 초점이 있다. 뒤에 붙는 부사가 방향만 지정한다 — up 위로, off 떨어져서, on 올라타서, in 안으로, out 밖으로, back 돌아와서. 이 부사들은 take / put / go 에도 똑같은 방향으로 붙으니 여기서 익혀두면 뒤가 편하다.',
  },
  '변화': {
    title: '상태가 그쪽으로 넘어감',
    core: 'be는 그 상태에 있는 것, get은 그 상태로 넘어가는 순간. I am tired(지금 피곤하다) / I am getting tired(피곤해지는 중이다). 한국어의 "-해지다"가 거의 전부 여기로 온다.',
  },
  '사역': {
    title: '대상을 그 상태로 넘김',
    core: 'get + 대상 + 뒤에 붙는 것. 뒤에 to+동사면 시키다, 과거분사면 남 시켜서 되게 하다, 형용사면 그 상태로 만들다. 내가 직접 한 게 아니라는 뜻이 깔린다.',
  },
  '이해': {
    title: '뜻이 내 머리로 넘어옴',
    core: 'understand 자리를 구어에서 get이 대신한다. 뒤에 it / that 같은 단어도 오고 문장이 통째로 오기도 한다.',
  },
  '관용': {
    title: '코어 이미지로 안 풀림',
    core: '"넘어감"으로 설명이 안 되는 덩어리. 억지로 끼워 맞추지 말고 통째로 외운다. 다른 동사에도 이런 게 3~4개씩 있다.',
  },
 },

 'have': {
  '소유': {
    title: '내 영역 안에 있음',
    core: 'get이 없던 게 넘어오는 순간이라면 have는 이미 내 쪽에 있는 상태다. 물건·시간·가족처럼 가진 것뿐 아니라 감기·두통처럼 몸에 있는 것도 have로 말한다. 한국어의 "있다 / 없다"가 거의 전부 여기로 온다.',
  },
  '경험': {
    title: '그 시간을 통과함',
    core: '먹고 마시고 겪는 것. eat / drink / spend 자리를 have가 다 먹는다. 손에 쥐는 게 아니라 그 시간을 지나간다는 쪽이라, 이 뜻일 때만 진행형(having)이 된다.',
  },
  '의무': {
    title: '해야 할 일이 내게 있음',
    core: 'have to + 동사원형. 할 일이 내 쪽에 얹혀 있다는 이미지다. 내가 정한 게 아니라 상황이 그렇게 만든 느낌이 깔린다. 부정하면 "하면 안 된다"가 아니라 "안 해도 된다"가 되는 것이 핵심이다.',
  },
  '사역': {
    title: '남을 시켜서 되게 함',
    core: 'have + 대상 + 뒤에 붙는 것. 과거분사면 남 시켜서 그렇게 되게 하다, 동사원형이면 그 사람에게 시키다. get과 틀은 같은데 사람에게 시킬 때 to를 붙이지 않는다.',
  },
  '관용': {
    title: '코어 이미지로 안 풀림',
    core: '"내 영역 안에 있음"으로 설명이 안 되는 덩어리. 뜯어보지 말고 통째로 외운다.',
  },
 },
};


/* ---------- 3. 개별 주석 ----------
 * 한국어 직관과 어긋나 실제로 틀리는 지점에만 단다. 42개 전부에 달지 않는다.
 * 문체: 평서형 종결(~한다), 1~2문장.
 */

const ITEM_NOTE = {
  // 획득
  "I'll get a coffee":
    'get 하나가 사다 / 가져오다를 다 덮는다. buy를 안 써도 된다.',
  'Can you get me some water?':
    'get + 사람 + 물건 = ~에게 갖다주다. give와 형태가 똑같다.',
  'Where did you get that?':
    '샀는지 받았는지 주웠는지 안 따진다. "그거 어디서 났어"에 가장 가깝다.',
  'I got a room':
    '방을 잡다(예약·확보). 호텔·식당 자리에 그대로 쓴다.',
  "I'll get it":
    '전화벨·초인종이면 "내가 받을게", 계산서 앞이면 "내가 낼게". 상황이 뜻을 정한다.',

  // 이동
  'How do I get to the airport?':
    '여행에서 가장 많이 쓰는 문장. go to가 아니라 get to — 도착에 초점이 있다.',
  'What time do you get home?':
    'home 앞에 to를 붙이지 않는다. home은 여기서 부사다.',
  'I got here yesterday':
    'here / there도 마찬가지로 to 없이 바로 붙는다.',
  'Get in the car':
    '차·택시는 in. 몸을 굽혀 들어가는 좁은 공간이라서다.',
  'Get on the subway':
    '지하철·버스·비행기는 on. 올라타서 서서 다닐 수 있는 공간이라서다. 이 in/on 구분은 그대로 굳어져 있다.',
  'Get off here':
    '내리다. on의 반대. 택시에서는 get out을 쓴다(in의 반대).',
  'When do you get back?':
    'back이 "돌아와서" 방향을 지정한다. come back과 거의 같게 쓴다.',

  // 변화
  "I'm getting tired":
    'I am tired는 이미 피곤한 상태, getting은 피곤해지는 중. 이 차이가 get 변화 갈래의 전부다.',
  'I got lost':
    '여행 필수. 길을 잃은 상태로 넘어갔다는 뜻.',
  'They got married last year':
    '결혼한 상태로 넘어간 그 시점. are married는 결혼해 있는 상태.',
  "I'm getting used to it":
    'used to it은 "익숙한 상태". "used to + 동사원형"(예전엔 ~했다)과 완전히 다른 표현이니 섞이지 않게 주의. 혼동 1순위다.',
  'I got fired':
    'get + 과거분사 = 당하다. was fired와 뜻은 같지만 구어에선 get 쪽이 훨씬 많고, 내 의지와 무관하게 그렇게 됐다는 느낌이 붙는다.',
  'I got drunk':
    '취한 상태로 넘어감. 지금 취해 있으면 I am drunk.',

  // 사역
  'I got my hair cut':
    '내가 자른 게 아니라 미용실에서 자른 것. cut의 과거분사는 cut 그대로다.',
  "I'll get him to call you":
    '사람을 시킬 때는 to + 동사원형. make him call과 달리 강제성이 약하다.',
  'I got it done':
    '끝내다. it done 순서가 고정이다. 앞의 got my hair cut과 같은 틀.',

  // 이해
  'I get what you mean':
    'get 뒤에 단어가 아니라 문장이 통째로 온다. what you mean = 네가 뜻하는 것.',

  // 관용
  'Get rid of this':
    '버리다 / 없애다. rid는 이 덩어리 밖에서 거의 안 쓰이니 통째로 외운다.',
  'Do you get along with him?':
    '사이좋게 지내다. 사람 관계 전용 표현.',
  "Let's get going":
    "슬슬 출발하자. Let's go보다 \"이제 움직이자\"는 느낌이 강하다.",

  // have · 소유
  'Do you have time?':
    '"시간 있어?"에 be동사를 쓰지 않는다. 있다 / 없다는 have다.',
  'Do you have a room?':
    '호텔에서 빈방이 있냐는 뜻. get a room은 방을 잡는 것, have a room은 방이 있는 것이다.',
  'Do you have a table?':
    '식당에서 자리 있냐고 물을 때 seat이 아니라 table을 쓴다.',
  'Do you have a smaller size?':
    '가게에서 그대로 쓴다. "있어요?"를 Is there로 옮기면 어색해진다 — 파는 쪽에 물을 땐 have다.',
  'I have a reservation':
    '예약"했다"인데 did가 아니라 have다. 예약이 지금 내 앞에 살아 있다는 뜻이라서다.',
  'I have a cold':
    '감기를 "걸렸어"라고 하지만 영어는 갖고 있다고 말한다. get a cold는 걸리는 순간, have a cold는 걸려 있는 상태다.',
  'I have a headache':
    '아픈 걸 형용사로 말하지 않고 have + 명사로 말한다. 약국에서 이 틀 하나로 거의 다 통한다.',

  // have · 경험
  'Did you have breakfast?':
    '식사·음료에는 eat / drink보다 have가 자연스럽다.',
  'Can I have a look?':
    '보다에 see를 쓰지 않는다. 잠깐 훑어본다는 느낌이다.',
  "Let's have a coffee":
    'a가 붙는다. 커피라는 물질이 아니라 커피 한 잔을 뜻해서다.',
  'Have a good time':
    '명령문 모양이지만 시키는 말이 아니라 인사말이다. 헤어질 때 그대로 쓴다.',
  "We're having a party":
    'have는 보통 진행형을 안 쓰는데 이 갈래에서는 쓴다. 소유 뜻일 때는 안 된다 — I\'m having a car라고 말하지 않는다.',
  'We had fun':
    'fun 앞에 a를 붙이지 않는다. a good time에는 붙는다.',

  // have · 의무
  'I have to go':
    'to + 동사원형이 붙으면 가진다는 뜻이 사라지고 의무가 된다.',
  "You don't have to go":
    '"가면 안 된다"가 아니라 "안 가도 된다"다. 정반대로 새기기 쉬운 자리다.',
  'Do I have to wait?':
    '의문문은 do로 만든다. Have I to wait?라고 하지 않는다.',

  // have · 사역
  'I had my hair cut':
    '내가 자른 게 아니라 미용실에서 자른 것. got my hair cut과 뜻은 같고 have 쪽이 조금 차분한 말투다.',
  'Can I have this delivered?':
    'this delivered 순서가 고정이다. 앞의 my hair cut과 같은 틀이다.',
  "I'll have him call you":
    '사람 뒤에는 to 없이 동사원형이 온다. get him to call you와 다른 점이 이것 하나다.',

  // have · 관용
  'I have no idea':
    '전혀 모르겠다는 뜻. I don\'t know보다 세다.',
  'Can I have a word?':
    'word가 단어가 아니라 "잠깐 얘기"를 뜻한다. 따로 불러서 말할 때 쓴다.',
  'Have it your way':
    '마음대로 하라는 뜻. 살짝 퉁명스러운 말이라 상대를 봐가며 쓴다.',
  'I have a lot going on':
    '요즘 벌어진 일이 많아 정신없다는 뜻. busy보다 넓게 쓴다.',
};


/* ---------- 4. 설명 패널 ---------- */

function getExplainHTML(item) {
  const s = (SENSE_INFO[item.verb] || {})[item.sense];
  if (!s) return '';
  const note = ITEM_NOTE[item.en];
  return (
    '<div class="verb-explain">' +
      '<div class="verb-explain-head">' + item.verb + ' · ' + item.sense + ' — ' + s.title + '</div>' +
      '<p class="verb-explain-core">' + s.core + '</p>' +
      (note ? '<p class="verb-explain-note">' + note + '</p>' : '') +
    '</div>'
  );
}

/* answerEl: 정답 문장이 표시된 엘리먼트. 누르면 바로 아래에 설명이 열리고 다시 누르면 닫힘. */
function attachExplain(answerEl, item) {
  if (!answerEl || !(SENSE_INFO[item.verb] || {})[item.sense]) return;
  answerEl.style.cursor = 'pointer';
  answerEl.addEventListener('click', function () {
    const next = answerEl.nextElementSibling;
    if (next && next.classList.contains('verb-explain')) {
      next.remove();
      return;
    }
    answerEl.insertAdjacentHTML('afterend', getExplainHTML(item));
  });
}


/* ---------- 참고: 최소 CSS ---------- */
/*
.verb-explain { margin-top: 10px; padding: 12px; border-radius: 8px; font-size: 14px; line-height: 1.65; }
.verb-explain-head { font-weight: 600; margin-bottom: 6px; opacity: .75; }
.verb-explain-core { margin: 0; }
.verb-explain-note { margin: 8px 0 0; padding-top: 8px; border-top: 1px solid currentColor; }
*/
