"""Mutation 권한 경계.

공개 데모는 읽기 전용으로 잠그고, 변경 요청은 프론트 서버와 백엔드가 공유하는 Bearer 토큰을
검증한다. 사용자 계정/역할 체계가 붙기 전까지도 인터넷에 노출된 POST가 무인증으로 열리지 않게
하는 최소 경계다. 토큰이 설정되지 않은 운영은 허용으로 폴백하지 않고 안전하게 실패한다.
"""
import os
import secrets

from fastapi import HTTPException, Request


def demo_read_only() -> bool:
    return os.environ.get("DEMO_READ_ONLY", "false").strip().lower() in {"1", "true", "yes", "on"}


def _require_bearer(request: Request) -> None:
    expected = os.environ.get("MUTATION_API_TOKEN", "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="상태 변경 인증이 구성되지 않았습니다. MUTATION_API_TOKEN을 설정해 주세요",
        )

    authorization = request.headers.get("authorization", "")
    scheme, separator, credential = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not credential.strip():
        raise HTTPException(
            status_code=401,
            detail="상태 변경 인증이 필요합니다",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not secrets.compare_digest(credential.strip(), expected):
        raise HTTPException(
            status_code=401,
            detail="상태 변경 인증 정보가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 이후 사용자 계정/역할 체계가 도입되면 이 지점에서 주체와 권한을 request.state에 연결한다.
    request.state.mutation_authorized = True


def require_mutation_access(request: Request) -> None:
    if demo_read_only():
        raise HTTPException(
            status_code=403,
            detail="공개 데모는 읽기 전용입니다. 상태 변경은 운영 인증이 연결된 환경에서만 허용됩니다",
        )
    _require_bearer(request)


def require_internal_access(request: Request) -> None:
    """담당자 메모·담당자명·장애물이 포함된 추진 이력 조회 권한."""
    _require_bearer(request)
