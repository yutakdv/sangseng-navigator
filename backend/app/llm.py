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
                resp = client.messages.create(
                    model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
                    max_tokens=4096,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    thinking={"type": "disabled"},  # sonnet-5는 기본 adaptive thinking — 짧은 JSON 생성엔 지연만 늘어 끔 (Lambda 30s 내 응답 보장)
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                    timeout=timeout,
                )
                text = next(b.text for b in resp.content if b.type == "text")
                return json.loads(text)
            # 기본: openai
            from openai import OpenAI
            client = OpenAI()
            resp = client.with_options(timeout=timeout).chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema",
                                 "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as exc:
            last_exc = exc
    raise last_exc
