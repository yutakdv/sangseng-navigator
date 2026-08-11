"""한국어 조사 생성 — 값을 문장에 끼워 넣을 때 받침을 판정해 조사를 고른다 (05 문서 §8).

서버가 만드는 문장에 값이 그대로 박히므로("Score 0.48을 …"), 조사를 문자열 리터럴로 굳히면
값에 따라 반드시 틀린다. `은(는)`처럼 병기로 도망가는 자리도 이 모듈로 정리한다.

숫자는 **읽는 소리**로 판정한다 — `0.48`은 "영점사팔"이라 받침이 있고(`0.48을`),
`1,552`는 "천오백오십이"라 받침이 없다(`1,552를`). 자릿수 읽기까지 필요한 이유는 정수의 마지막
자리가 0일 때다: `1,550`은 "…오십"이라 받침이 있는데 마지막 글자 `0`("영")만 보면 우연히 같은
답이 나오지만, `100`("백")·`1,000`("천")·`10`("십")도 마찬가지로 마지막 **자릿수 이름**이 소리를
결정한다. 소수는 자릿수 이름이 붙지 않아(`0.30`은 "영점삼공") 마지막 숫자 그대로 읽는다.
"""
import re

# 마지막 소리의 받침을 세 갈래로 나눈다: 없음 · ㄹ · 그 밖의 받침.
# ㄹ을 따로 두는 이유는 `(으)로`뿐이다 — "일로"·"서울로"처럼 ㄹ 뒤에는 `로`가 붙는다.
NONE, RIEUL, OTHER = "none", "rieul", "other"

# 숫자 낱자 읽기 — 일(ㄹ)·칠(ㄹ)·팔(ㄹ)은 ㄹ 받침, 영/공·삼·육은 그 밖의 받침, 이·사·오·구는 없음.
_DIGIT_FINAL = {
    "0": OTHER,  # 영/공
    "1": RIEUL,  # 일
    "2": NONE,   # 이
    "3": OTHER,  # 삼
    "4": NONE,   # 사
    "5": NONE,   # 오
    "6": OTHER,  # 육 — "륙"으로 읽어도 받침이 있는 것은 같다
    "7": RIEUL,  # 칠
    "8": RIEUL,  # 팔
    "9": NONE,   # 구
}
# 정수의 마지막 유효 자리가 0이면 자릿수 이름이 마지막 소리다 — 십(ㅂ)·백(ㄱ)·천(ㄴ)·만(ㄴ)·억(ㄱ).
# 전부 ㄹ이 아닌 받침이라 한 값으로 충분하다.
_PLACE_FINAL = OTHER

# 로마자 알파벳 이름의 받침 — "AC-001"·"kim.js"처럼 영문으로 끝나는 값에 조사가 붙는다.
# 엘(ㄹ)·엠·엔만 받침이 있고, 아르·에프·에스·엑스는 르/프/스로 끝나 **받침이 없다**.
_ALPHA_FINAL = {
    "l": RIEUL,                  # 엘
    "m": OTHER, "n": OTHER,      # 엠 · 엔
}


def _strip_trailing_noise(text: str) -> str:
    """조사 판정에 쓰지 못하는 꼬리(괄호·따옴표·구두점·공백·단위 기호)를 걷어낸다.

    "(Score 0.57)"처럼 닫는 괄호로 끝나는 값이 실제로 문장에 들어간다 — 괄호로 판정하면
    항상 같은 답이 나오므로 그 앞의 실제 마지막 글자를 찾는다.
    """
    return re.sub(r"[)\]}»”’\"'.,·…\s%]+$", "", text)


def final_kind(text) -> str:
    """마지막 소리의 받침 종류 — `NONE` | `RIEUL` | `OTHER`. 판정 불가면 `OTHER`.

    받침 있음을 기본값으로 두는 이유: 한국어에서 `을`·`은`·`과`는 받침 없는 말에 붙어도
    문어체로 읽히지만, 반대(`를`·`는`·`와`가 받침 있는 말에 붙는 것)는 곧바로 오문이 된다.
    """
    raw = _strip_trailing_noise(str(text))
    if not raw:
        return OTHER
    tail = raw[-1]

    if "0" <= tail <= "9":
        return _number_final(raw)
    if tail.isalpha() and tail.isascii():
        return _ALPHA_FINAL.get(tail.lower(), NONE)
    code = ord(tail)
    if 0xAC00 <= code <= 0xD7A3:            # 완성형 한글 — (코드 − 가) % 28 이 종성 인덱스
        jong = (code - 0xAC00) % 28
        return NONE if jong == 0 else (RIEUL if jong == 8 else OTHER)
    return OTHER


def has_final_consonant(text) -> bool:
    """마지막 소리에 받침이 있는가 (ㄹ 포함)."""
    return final_kind(text) != NONE


def _number_final(raw: str) -> str:
    """숫자로 끝나는 문자열의 받침 — 소수부가 있으면 낱자, 없으면 자릿수 이름까지 본다."""
    digits = re.sub(r"[^0-9.]", "", raw)        # 천 단위 쉼표 제거
    if "." in digits:
        decimals = digits.split(".")[-1]
        return _DIGIT_FINAL.get(decimals[-1], OTHER) if decimals else OTHER
    trimmed = digits.lstrip("0") or "0"
    if trimmed[-1] != "0":                       # 1의 자리가 살아 있으면 낱자 읽기가 마지막 소리
        return _DIGIT_FINAL[trimmed[-1]]
    return _PLACE_FINAL                          # …십·백·천·만 으로 끝나면 ㄹ이 아닌 받침


def _pick(text, with_final: str, without_final: str) -> str:
    return f"{text}{with_final if has_final_consonant(text) else without_final}"


def eul(text) -> str:
    """목적격 — 을/를."""
    return _pick(text, "을", "를")


def eun(text) -> str:
    """주제 — 은/는."""
    return _pick(text, "은", "는")


def i_ga(text) -> str:
    """주격 — 이/가."""
    return _pick(text, "이", "가")


def wa(text) -> str:
    """접속 — 와/과. 받침이 있으면 `과`다."""
    return _pick(text, "과", "와")


def euro(text) -> str:
    """방향·수단 — (으)로. 받침이 없거나 ㄹ이면 `로`다 ("서울로", "1로", "적격성 확인으로")."""
    return f"{text}{'로' if final_kind(text) in (NONE, RIEUL) else '으로'}"
