# 개발용 이미지 — `docker compose up`으로 화면을 확인하는 용도다.
# 배포는 Vercel 네이티브(git 연동)라 이 이미지를 프로덕션에 쓰지 않는다 (docs/plan/09 §4).
FROM node:20-alpine
WORKDIR /app

# 의존성만 먼저 복사해 레이어 캐시를 살린다 (소스 수정 때 npm 재설치 안 함)
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
