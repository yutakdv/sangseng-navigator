"""LLM 어댑터 — provider 분기(OpenAI/Anthropic)는 이 파일 안에만 존재 (CLAUDE.md 규칙, docs/plan/07 B3)."""
import os, json


def generate_json(system: str, user: str, schema: dict, schema_name: str = "result",
                   timeout: float | None = None) -> dict:
    provider = os.environ.get("LLM_PROVIDER", "openai")
    last_exc: Exception | None = None
    for attempt in range(2):  # 최초 시도 + 실패 시 1회 재시도
        try:
            if provider == "anthropic":
                import anthropic
                client = anthropic.Anthropic()
                extra = {"timeout": timeout} if timeout is not None else {}
                # timeout 미지정(None)이면 SDK 기본 타임아웃(NotGiven)을 그대로 쓴다 —
                # 명시적으로 timeout=None을 넘기면 SDK가 "타임아웃 없음(무한 대기)"으로 해석한다.
                resp = client.messages.create(
                    model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
                    max_tokens=4096,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    thinking={"type": "disabled"},  # sonnet-5는 기본 adaptive thinking — 짧은 JSON 생성엔 지연만 늘어 끔 (Lambda 30s 내 응답 보장)
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                    **extra,
                )
                text = next(b.text for b in resp.content if b.type == "text")
                return json.loads(text)
            # 기본: openai
            from openai import OpenAI
            client = OpenAI()
            # timeout 미지정(None)이면 with_options를 거치지 않고 SDK 기본 타임아웃을 유지한다 —
            # with_options(timeout=None)을 호출하면 "타임아웃 없음(무한 대기)"으로 바뀌어 버린다.
            if timeout is not None:
                client = client.with_options(timeout=timeout)
            resp = client.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema",
                                 "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as exc:
            last_exc = exc
    raise last_exc
