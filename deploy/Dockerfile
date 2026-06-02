# service-init-audit 컨테이너 — Playwright(Chromium) 포함 베이스
# Playwright npm 버전(^1.47)과 베이스 이미지 태그를 맞출 것.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# 의존성 먼저 (레이어 캐시)
COPY package*.json ./
RUN npm install --omit=dev

# Chromium 확보 (베이스에 이미 있으면 no-op)
RUN npx playwright install chromium

# 앱 소스
COPY . .

# 컨테이너 내 빈 프로필 → audit가 ensureSession(ID/PW)으로 자동 로그인
ENV CHROME_PROFILE_DIR=chrome_profile
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 트리거 웹훅 서버 (n8n Schedule이 POST /run?slot= 호출)
CMD ["node", "deploy/server.js"]
