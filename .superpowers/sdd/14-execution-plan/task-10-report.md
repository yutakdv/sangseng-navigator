# Task 10 (T10) 보고서 — B3 LLM 어댑터 (`backend/app/llm.py`, `backend/app/prompts.py`)

## 생성 파일

- `backend/app/llm.py` — 07 문서 B3 원문 기반 + 확장 2가지(재시도 1회, `timeout` 인자)
- `backend/app/prompts.py` — 07 문서 부록 A-1~A-4 원문 그대로 (`CARD_SYSTEM_PROMPT`,
  `SIMULATE_PROMPT`, `INCENTIVE_PROMPT`, `WIDGET_BLURB_PROMPT`)
- `docs/plan/15-plan-review.md` §5의 T10 체크박스를 `[x]`로 닫음

## 구현 메모

- 재시도: `for attempt in range(2)` 루프로 최초 시도 + 실패 시 1회 재시도, 최종 실패면 마지막
  예외를 그대로 `raise` (규칙 기반 fallback은 호출부 몫 — 브리프 지시대로 구현하지 않음)
- `timeout`: OpenAI는 `client.with_options(timeout=timeout)`, Anthropic은
  `client.messages.create(..., timeout=timeout)` (SDK가 `create()`에 직접 `timeout` 키워드
  인자를 받는 것을 설치된 anthropic 0.120.2로 확인)
- 프롬프트 원문은 07 문서 부록 A에서 스크립트로 추출해 `prompts.py` 상수와 바이트 단위로
  diff 확인(아래 검증 참고) — 4개 모두 일치

## 검증 (순서대로 실행, 출력 기록)

### 1. OpenAI 실호출 1회 (`LLM_PROVIDER=openai`, `.env`의 실제 키 사용)
```
$ cd backend && python -c "
from dotenv import load_dotenv
load_dotenv('../.env')
from app.llm import generate_json
print(generate_json('한 단어로 답하라','ping',{'type':'object','properties':{'r':{'type':'string'}},'required':['r'],'additionalProperties':False}))
"
{'r': 'pong'}
```
스키마 준수 JSON(`{"r": "pong"}`) 반환 확인.

(주: 브리프의 검증 명령은 `.env`를 dotenv로 로드하는 진입점 없이 `app.llm`만 단독 import하므로,
그대로 실행하면 `OPENAI_API_KEY` 미설정으로 실패한다. `python -c` 안에서
`load_dotenv('../.env')`를 먼저 호출하도록 최소 조정해 동일한 검증 목적을 달성했다 — 코드
수정 아님, 검증 커맨드만 조정.)

### 2. Anthropic 코드 경로 확인 (`.env`에 `ANTHROPIC_API_KEY` 없음 — 실호출 스모크 생략)
```
$ python -c "
from dotenv import load_dotenv; load_dotenv('../.env')
import os; print('ANTHROPIC_API_KEY set:', bool(os.environ.get('ANTHROPIC_API_KEY')))
os.environ['LLM_PROVIDER'] = 'anthropic'
import app.llm as llm, inspect
print('anthropic branch present:', 'anthropic.Anthropic()' in inspect.getsource(llm.generate_json))
try:
    llm.generate_json('한 단어로 답하라','ping',{'type':'object','properties':{'r':{'type':'string'}},'required':['r'],'additionalProperties':False})
except Exception as e:
    print('Expected failure (no API key):', type(e).__name__, str(e)[:120])
"
ANTHROPIC_API_KEY set: False
anthropic branch present: True
Expected failure (no API key): TypeError "Could not resolve authentication method. Expected one of api_key, auth_token, or credentials to be set. Or for one of t
```
**anthropic 미검증(키 부재)** — 코드 경로 존재만 확인. 인증 단계에서 예상대로 실패(재시도
포함 2회 시도 후 예외 전파).

### 3. `timeout` 동작 (`timeout=0.001`)
```
$ python -c "
from dotenv import load_dotenv; load_dotenv('../.env')
import time
from app.llm import generate_json
t0 = time.time()
try:
    generate_json('한 단어로 답하라','ping',{...}, timeout=0.001)
    print('UNEXPECTED: no exception raised')
except Exception as e:
    print('Timeout exception after', round(time.time()-t0, 3), 's:', type(e).__name__, str(e)[:150])
"
Timeout exception after 3.064 s: APITimeoutError Request timed out.
```
`APITimeoutError` 발생 확인. 재시도 횟수는 별도로 `unittest.mock`으로 OpenAI 클라이언트
생성 자체를 실패시켜 카운트 검증:
```
$ python -c "... mock.patch('openai.OpenAI', side_effect=fake_openai_client) ..."
raised after 2 attempts: boom
```
정확히 2회(최초+재시도 1회) 시도 후 예외 전파 확인.

## 픽스 라운드 1 (리뷰 발견사항 대응)

**발견:** `timeout=None` 기본값을 OpenAI `with_options(timeout=timeout)` / Anthropic
`messages.create(..., timeout=timeout)`에 그대로 넘기면, 두 SDK 모두 "타임아웃 없음(무한 대기)"으로
해석한다. 인자를 아예 생략(NotGiven)했을 때의 "클라이언트 기본 타임아웃(약 10분)"과 다르므로,
`timeout`을 지정하지 않고 호출하는 B4/B5 등이 의도치 않게 무제한 대기로 회귀하는 문제였다.

**수정:** `timeout is not None`일 때만 값을 실어 보내고, `None`이면 파라미터 자체를 생략해 SDK
기본 동작을 유지하도록 변경.
- OpenAI: `if timeout is not None: client = client.with_options(timeout=timeout)` — 미지정 시
  `with_options` 자체를 호출하지 않음
- Anthropic: `extra = {"timeout": timeout} if timeout is not None else {}` 후 `**extra`로 전달 —
  미지정 시 `timeout` 키워드 인자 자체가 `create()` 호출에 포함되지 않음(NotGiven 기본값 유지)

### 재검증 (순서대로 실행, 출력 기록)

**1. `timeout=0.001` — 여전히 재시도 포함 2회 후 타임아웃 예외 전파 (실호출)**
```
$ python -c "... generate_json(..., timeout=0.001) ..."
Timeout exception after 3.122 s: APITimeoutError Request timed out.
```

**2. `timeout` 미지정 — `with_options`를 아예 거치지 않는지 (spy로 확인, 실호출)**
```
$ python -c "
... openai.OpenAI.with_options를 spy로 감싸 호출 여부 추적 ...
result: {'r': 'pong'}
with_options called (should be False): False
"
```
`with_options`가 호출되지 않아 SDK 기본 타임아웃(NotGiven)이 그대로 유지됨을 확인. (Anthropic
쪽도 동일 패턴 — `extra` dict가 비어 있으면 `**extra`로 `timeout` 키워드 자체가 전달되지 않음을
코드로 확인)

**3. OpenAI 실호출 1회 (`timeout` 미지정) — 정상 동작**
```
$ python -c "from app.llm import generate_json; print(generate_json('한 단어로 답하라','ping',{...}))"
{'r': 'pong'}
```

세 검증 모두 통과. 커밋: `fix: timeout 미지정 시 SDK 기본 타임아웃 유지`.

## 우려사항

- 검증 1·3의 실행 커맨드는 브리프 원문과 달리 `python -c` 내부에서 `load_dotenv('../.env')`를
  명시적으로 호출했다. `backend/app/main.py`만 로컬 `.env` 자동 로드를 담당하는 기존 컨벤션상
  `app.llm` 단독 import 시나리오에서는 dotenv가 로드되지 않는 게 정상 동작이라 판단해, 코드가
  아닌 검증 커맨드 쪽을 조정했다. `llm.py`에 자체 dotenv 로딩을 추가하지 않은 것은 의도적.
- anthropic 경로는 스키마 강제 출력(`output_config`)까지 포함한 전체 성공 경로가 실호출로
  검증되지 않았다(키 부재로 브리프가 명시적으로 생략 지시). 추후 `ANTHROPIC_API_KEY`가 채워지면
  1회 스모크 권장.
