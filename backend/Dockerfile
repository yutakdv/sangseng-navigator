# ECS Fargate(ARM64) 런타임 이미지. 로컬 통합 테스트(docker compose)도 같은 이미지를 쓰고
# 핫리로드만 compose 쪽 command 로 덮어쓴다 (docs/plan/09).
FROM python:3.12-slim

# 로그가 버퍼에 갇히면 awslogs 로 늦게/안 나가 장애 분석이 막힌다.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 의존성만 먼저 복사해 레이어 캐시를 살린다 (소스 수정 때 재설치 안 함)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# app/data 에는 build-and-push.sh 가 복사해 둔 data/processed 사본이 들어 있다.
# dataload.py 의 두 번째 후보 경로(Path(__file__).parent / "data")가 정확히 이 위치다.
#
# ⚠ 컨테이너에서 dataload 의 **첫 번째** 후보 경로는 /data/processed 로 풀린다(존재하지 않아 폴백).
#   이미지에도 태스크 정의에도 /data 디렉터리나 볼륨을 절대 만들지 말 것 —
#   만들면 그쪽이 먼저 잡혀 이미지에 구운 /app/app/data 를 조용히 가린다.
COPY app ./app

# 비루트 실행. app/ 는 읽기만 하므로 소유권 변경 없이 실행 사용자만 바꾼다.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# exec form — uvicorn 이 PID 1 로 SIGTERM 을 직접 받아 graceful shutdown 한다.
#   --workers 1 : 0.5GB 제약. OpenAI SDK 로드 후 RSS 116MB(실측)라 2워커는 OOM 위험.
#                 확장은 ECS desiredCount 로 한다.
#   --timeout-graceful-shutdown 30 : stopTimeout 60초 안에 반드시 끝나게
#   --timeout-keep-alive 75        : ALB idle_timeout 65초보다 길게 (역전 시 간헐 502)
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--timeout-graceful-shutdown", "30", \
     "--timeout-keep-alive", "75"]
