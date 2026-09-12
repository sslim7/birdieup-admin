# --- build: vite 정적 빌드 ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* 값은 빌드 시점에 번들에 인라인된다 — cloudbuild.yaml substitution 에서 --build-arg 로 주입한다.
# Cloud Run 환경변수로는 전혀 먹지 않는다. 값이 바뀌면 이미지를 다시 빌드해야 한다.
#
# 🔴 ARG → ENV 2단계가 핵심이다. ARG 만 두면 그 값은 Dockerfile 명령어 치환에만 쓰이고
# RUN 으로 도는 프로세스의 환경에는 들어가지 않는다. Vite 는 빌드 프로세스의 환경변수에서
# VITE_ 접두사 변수를 읽으므로, ENV 로 승격하지 않으면 값을 아예 보지 못한다.
# 그러면 import.meta.env.VITE_API_BASE_URL 이 undefined 인 번들이 조용히 나가고,
# 빌드는 성공하는데 브라우저에서만 API 호출이 전부 깨진다.
ARG VITE_API_BASE_URL=https://api.birdieup.kr
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# 구글 지도 키(장면 위치 보정 화면 전용). **기본값은 비어 있다** —
# 없으면 그 화면이 지도를 띄우지 않고 좌표 입력 칸만 쓰게 되며, 다른 화면은 영향이 없다.
ARG VITE_GOOGLE_MAPS_API_KEY=
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

RUN npm run build

# --- serve: nginx on Cloud Run ($PORT=8080) ---
FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
