"""LLM 어댑터 — provider 분기(OpenAI/Anthropic)는 이 파일 안에만 존재 (CLAUDE.md 규칙, docs/plan/07 B3)."""
import os, json, re, time, logging

log = logging.getLogger(__name__)
# Lambda 런타임이 root 로거에 INFO 핸들러를 붙이므로 아래 log.info는 CloudWatch에 그대로 남는다.
# 발표 Q&A("AI 응답 몇 초 걸리나") 근거 + 심사 기간 중 API 키 만료·rate limit을 로그로 감지하기 위함.

RETRY_BACKOFF_SECONDS = 0.5
# 재시도 사이 고정 대기. 최악 지연 = cardgen timeout 12s × 2회 + backoff 0.5s = 24.5s < Lambda 30s
# (09 문서 Timeout: 30, cardgen.LLM_TIMEOUT=12). 마지막 시도 뒤에는 대기하지 않는다.

# 인증 실패 응답에는 SDK가 부분 마스킹한 키가 그대로 들어 있다
# (예: "Incorrect API key provided: sk-proj-****ABCD"). 로그·트레이스백에 남기지 않는다.
_KEY_PATTERN = re.compile(r"\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_\-*]{4,}")


def redact(text: str) -> str:
    """로그에 실을 문자열에서 API 키 형태를 지운다."""
    return _KEY_PATTERN.sub("<redacted-key>", text)


class LLMError(Exception):
    """LLM 호출 최종 실패 — 원인 예외의 **마스킹된** 타입·메시지만 담는다.

    SDK 예외를 그대로 올리면 호출부의 `log.warning(..., exc_info=True)`가 트레이스백과 함께
    부분 마스킹된 키까지 CloudWatch에 남긴다. `raise ... from None`으로 원인 체인을 끊어
    키가 실릴 수 있는 유일한 경로를 이 한 곳으로 모은다 (호출부는 계속 `except Exception`이라
    잡는 방식은 그대로다). 실패 원인 구분(401·timeout·rate limit)은 메시지에 남는다.
    """


def generate_json(system: str, user: str, schema: dict, schema_name: str = "result",
                   timeout: float | None = None, attempts: int = 2) -> dict:
    """attempts 는 총 시도 횟수 — 기본 2(최초+재시도 1회).
    현재 호출부(cardgen 카드 생성·cards.simulate)는 모두 기본값을 쓴다. 위젯 추천 문구는 LLM을
    쓰지 않고 결정론 문구만 반환하므로(routes/widget.py `_fallback_blurb`) 여기 해당하지 않는다.
    지연 상한이 더 중요한 호출부가 생기면 attempts=1 로 재시도를 끄고 fallback 으로 넘긴다.
    """
    provider = os.environ.get("LLM_PROVIDER", "openai")
    if provider not in {"openai", "anthropic"}:
        # 오타를 OpenAI로 조용히 처리하면 배포 환경에서 의도하지 않은 provider·키를 사용한다.
        # 호출부는 LLMError를 받아 규칙 기반 fallback으로 전환하므로 사용자 흐름은 끊기지 않는다.
        raise LLMError(f"Unsupported LLM_PROVIDER: {provider}")
    model = (os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5") if provider == "anthropic"
             else os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    attempts = max(1, attempts)     # 0 이하면 아래 raise last_exc 가 None을 raise 하므로 최소 1회는 돈다
    last_exc: Exception | None = None
    started = time.perf_counter()   # 소요시간은 호출 전체(재시도·backoff 포함) 기준
    for attempt in range(1, attempts + 1):
        try:
            if provider == "anthropic":
                import anthropic
                client = anthropic.Anthropic()
                extra = {"timeout": timeout} if timeout is not None else {}
                # timeout 미지정(None)이면 SDK 기본 타임아웃(NotGiven)을 그대로 쓴다 —
                # 명시적으로 timeout=None을 넘기면 SDK가 "타임아웃 없음(무한 대기)"으로 해석한다.
                resp = client.messages.create(
                    model=model,
                    max_tokens=4096,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    thinking={"type": "disabled"},  # sonnet-5는 기본 adaptive thinking — 짧은 JSON 생성엔 지연만 늘어 끔 (Lambda 30s 내 응답 보장)
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                    **extra,
                )
                text = next(b.text for b in resp.content if b.type == "text")
                out = json.loads(text)
            else:
                # 기본: openai
                from openai import OpenAI
                client = OpenAI()
                # timeout 미지정(None)이면 with_options를 거치지 않고 SDK 기본 타임아웃을 유지한다 —
                # with_options(timeout=None)을 호출하면 "타임아웃 없음(무한 대기)"으로 바뀌어 버린다.
                if timeout is not None:
                    client = client.with_options(timeout=timeout)
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    response_format={"type": "json_schema",
                                     "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
                )
                out = json.loads(resp.choices[0].message.content)
            log.info("llm ok provider=%s model=%s schema=%s attempt=%d/%d elapsed=%.2fs",
                     provider, model, schema_name, attempt, attempts, time.perf_counter() - started)
            return out
        except Exception as exc:
            last_exc = exc
            if attempt < attempts:
                time.sleep(RETRY_BACKOFF_SECONDS)
    cause = redact(f"{type(last_exc).__name__}: {last_exc}")
    log.info("llm fail provider=%s model=%s schema=%s attempts=%d elapsed=%.2fs error=%s",
             provider, model, schema_name, attempts, time.perf_counter() - started, cause)
    raise LLMError(cause) from None     # 원인 체인을 끊어 마스킹 안 된 SDK 메시지가 새지 않게 (위 docstring)
