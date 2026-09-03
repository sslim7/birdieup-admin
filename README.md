# birdieup-admin

버디업 어드민 콘솔 (React 18 + Vite SPA)

- 운영: https://admin.birdieup.kr
- 백엔드 API: [birdieup-was](../birdieup-was) (로컬 8081, 운영 `https://api.birdieup.kr`)
- 인프라·배포: [birdieup-terraform](../birdieup-terraform)

## 이 저장소가 하는 일

버디업 앱에 들어가는 **운영자 입구**다. 이게 생기기 전까지 공지·업데이트는 `cmd/post`,
제안 답변은 `cmd/answer-suggestion`, 이모티콘은 `cmd/seed-emoticons` 로 터미널에서 넣었다
(birdieup-was `docs/spec-notices-suggestions.md` §4 가 그 상태를 「미결」로 적어 둔 그 자리다).

## 주요 기능

- 이메일/비밀번호 로그인 (JWT, localStorage `adminToken`) + 첫 로그인 시 비밀번호 강제 변경
- **공지사항** / **업데이트** (`/posts/notices`, `/posts/releases`): 작성·수정·삭제, 예약 발행
- **제안받아요** (`/suggestions`): 목록 → 상세 → 답변. 답변을 저장하면 제안자에게 문자가 나간다
- **이모티콘** (`/emoticons`): 캐릭터·이모티콘 등록/수정, 이미지 업로드, 활성 토글
- 사용자 관리(`/users`, 어드민 전용): 어드민 계정 생성/수정, 관리자 권한 부여, 메뉴 접근 권한 지정
- 활동 로그(`/audit-logs`, 어드민 전용): 검색·기간·대상 필터, 정렬, 페이지네이션, 행 펼침 상세

## 권한 모델

- 토큰 클레임 `sub.isAdmin` / `sub.permissions` 기준. `isAdmin` 이면 전 메뉴 접근
- 일반 계정은 `permissions`(`{ "<menu-key>": true }` 맵)에 있는 메뉴만 접근
- menu-key 는 `src/config/navigation.js` 가 href 로부터 정의한다(`/posts/notices` → `posts-notices`)
- 권한 없는 메뉴는 사이드바에서 숨겨지고, URL 직접 접근도 라우트 가드가 홈으로 돌려보낸다
- **최종 판정자는 서버다.** 사이드바 숨김·라우트 가드는 편의일 뿐이고 권한 없는 호출은 403 이다
- 권한 변경은 대상자가 다시 로그인해야(토큰 재발급) 반영된다

## 구조

```
src/
├── pages/               # 라우트 단위 페이지 (App.jsx 의 pageRoutes 에 등록)
├── components/
│   ├── layout/          # 사이드바·헤더 등 인증 후 셸
│   ├── posts/           # 공지사항·업데이트가 공유하는 게시판 본체
│   └── ui/              # shadcn 스타일 공용 컴포넌트
├── services/            # API 호출 (apiClient.js 가 baseURL·토큰 헤더 공통 처리)
├── config/navigation.js # 메뉴·권한 키 정의 (사이드바/라우트 가드/권한부여 UI 가 공유)
└── utils/auth.js        # 토큰 저장/디코딩, 클레임 헬퍼

docs/admin-api.md        # ★ 어드민 API 계약. birdieup-was 와 함께 지킨다
deploy/nginx.conf        # 운영 컨테이너가 dist/ 를 서빙하는 설정
```

레이아웃과 사용자 관리·활동 로그·로그인 화면은 [kiik-admin](../kiik-admin) 에서 이식했다.
업무 페이지(공지·업데이트·제안·이모티콘)는 버디업 전용이다.

## 시작하기

```bash
cp .env.example .env   # 값 확인/수정
npm install
npm run dev            # 개발 서버 (기본 3001, .env 의 PORT 로 변경)
```

백엔드도 함께 띄워야 한다:

```bash
cd ../birdieup-was
firebase emulators:start   # Firestore/Storage 에뮬레이터
go run .                   # 8081
go run ./cmd/create-admin -email you@birdieup.kr -name 홍길동 -password '초기비번' --write
```

`ADMIN_JWT_SECRET` 이 birdieup-was 의 `.env` 에 없으면 **어드민 라우트가 아예 등록되지 않아**
로그인이 404 가 난다. `JWT_SECRET` 과 다른 값이어야 한다(같으면 서버가 기동을 거부한다).

## 환경변수

`.env.example` 참고. `VITE_` 접두사가 붙은 변수만 앱 코드(`import.meta.env`)에 노출되며,
값은 **빌드 시점**에 번들에 새겨진다. 운영 값은 Cloud Build 트리거의 치환 변수
(`_VITE_API_BASE_URL`)가 도커 `--build-arg` 로 주입하며, 그 소유자는 birdieup-terraform 이다.
`.env` 는 `.dockerignore` 로 이미지에서 빠진다 — 안 빼면 운영 번들이 localhost 를 가리킨다.

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` (= `npm start`) | Vite 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 (`dist/` 생성) |
| `npm run preview` | 빌드 결과물 로컬 확인 |

## 브랜치 · 배포

모든 birdieup 프로젝트가 같은 전략을 쓴다.

- `staging` — 기본 브랜치. 여기서 개발하고 로컬에서 확인한다
- `release` — 검증이 끝나면 staging 을 머지하고 **태그를 붙인다**

```bash
git checkout release && git merge staging && git push
git tag v1.0.0 && git push origin v1.0.0   # ← 이 순간 빌드·배포가 시작된다
```

`^v.*$` 태그 push 가 Cloud Build 트리거를 깨우고, `cloudbuild.yaml` 이 이미지를 만들어
Artifact Registry 에 올린 뒤 Cloud Run `birdieup-admin` 을 새 이미지로 갱신한다.
`admin.birdieup.kr` 은 Firebase Hosting rewrite 로 그 서비스 앞에 선다
(`asia-northeast3` 는 Cloud Run 커스텀 도메인을 지원하지 않는다).

브랜치 push 로 배포되는 경로는 없다. GCP 에 staging 환경도 없다 —
개발은 로컬 에뮬레이터로 한다(birdieup-terraform README 참고).

🔴 **배포 단계는 이미지 교체만 한다.** 환경변수·시크릿·CPU·min-instances 같은 서비스 설정의
소유자는 Terraform 이다. `cloudbuild.yaml` 에 그런 플래그를 넣지 마라.
