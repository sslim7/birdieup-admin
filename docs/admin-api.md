# BirdieUp 어드민 API 계약

birdieup-admin(React SPA) 과 birdieup-was(Go) 가 **함께 지키는 계약**이다.
한쪽만 바꾸면 조용히 어긋나므로, 바꿀 때는 이 문서를 먼저 고친다.

- 베이스 URL: `http://localhost:8081` (로컬) — **경로 접두사 없음**. `/api/v1` 은 kiik 쪽 관습이고 여기엔 없다.
- 시간: 응답의 모든 timestamp 는 RFC3339 UTC 문자열.
- JSON 키: **camelCase** (WAS 하우스 스타일). kiik-admin 의 snake_case 를 그대로 들고 오지 말 것.
- 에러: 항상 `{ "code": string, "message": string, "details"?: object }` (`internal/httpx`).
  `message` 는 한국어이고 화면에 그대로 띄워도 되는 문장이다.
- 목록: `?limit=1..50(기본 20)&cursor=<opaque>` → `{ items: [...], nextCursor: string|null }`.
  **활동 로그만 예외**로 page/total 을 쓴다(§5).

---

## 1. 어드민 인증

### 1.1 토큰

`localStorage.adminToken` 에 저장하는 JWT(HS256).

**서명 키는 `ADMIN_JWT_SECRET` 이며 `JWT_SECRET` 과 반드시 달라야 한다.** 같은 키를 쓰면
어드민 토큰이 일반 사용자 미들웨어(`internal/auth/middleware.go`)에서도 파싱되어,
`sub` 가 객체인 토큰이 userId 자리에 들어간다.

```json
{
  "sub": {
    "adminId": "9f2c…",
    "email": "admin@birdieup.kr",
    "name": "홍길동",
    "isAdmin": true,
    "permissions": { "posts-notices": true },
    "mustChangePassword": false
  },
  "isAdmin": true,
  "tokenUse": "admin_access",
  "iat": 1756800000,
  "exp": 1756843200
}
```

TTL: `rememberMe` 면 6주, 아니면 12시간.

### 1.2 권한 모델

- `isAdmin: true` → 전 메뉴·전 엔드포인트 접근.
- 아니면 `permissions` 맵에 있는 메뉴 키만 접근. 키는 SPA 의 `src/config/navigation.js` 가
  href 로부터 정의한다(`/posts/notices` → `posts-notices`).
- 현재 키: `posts-notices`, `posts-releases`, `suggestions`, `emoticons`, `metrics`.
- `metrics` 만 href 에서 파생되지 않는다 — 홈(`/`)이 지표 대시보드지만 홈 자체는
  누구나 들어와야 해서 메뉴에 권한을 달 수 없다. 자세한 이유는 §8.
- 어드민 계정 관리(`/admin/admins`)와 활동 로그(`/admin/audit-logs`)는 **`isAdmin` 전용**이다.
- **서버가 최종 판정자다.** 사이드바 숨김·라우트 가드는 편의일 뿐이고, 권한 없는 호출은 403 `FORBIDDEN`.

### 1.3 엔드포인트

| Method | Path | 인증 |
|---|---|---|
| POST | `/auth/admin.login` | 없음 |
| POST | `/auth/admin.change-password` | 어드민 토큰 |
| GET | `/admin/admins` | isAdmin |
| POST | `/admin/admins` | isAdmin |
| PATCH | `/admin/admins/{adminId}` | isAdmin |

**POST `/auth/admin.login`**
```
req  { "email": string, "password": string, "rememberMe"?: boolean }
res  200 { "accessToken": string }
err  400 VALIDATION_FAILED · 401 UNAUTHORIZED("등록된 어드민 계정이 아닙니다" / "비밀번호를 확인하세요")
     403 FORBIDDEN("비활성 계정입니다")
```
401 의 두 문구를 **응답에서 구분하지 마라**는 요구는 없다(어드민 계정은 공개 가입이 아니다).
로그인 성공·실패는 둘 다 활동 로그에 남는다.

**POST `/auth/admin.change-password`**
```
req  { "newPassword": string }        // 8자 이상, 기존과 달라야 한다
res  200 { "accessToken": string }    // mustChangePassword=false 가 반영된 새 토큰
err  400 VALIDATION_FAILED
```
현재 비밀번호는 묻지 않는다. 이 화면은 로그인 직후에만 도달하고, 본인 확인은 토큰이 한다.

**GET `/admin/admins`** → `200 { "items": [Admin] }` (createdAt 내림차순)
```
Admin = {
  adminId, email, name,
  isActive: boolean, isAdmin: boolean,
  permissions: { "<menu-key>": true },
  mustChangePassword: boolean,
  createdAt, updatedAt
}
```

**POST `/admin/admins`**
```
req  { email, name, password, isAdmin?, permissions?, mustChangePassword? }
     // password 8자 이상. isAdmin 기본 false, permissions 기본 {}, mustChangePassword 기본 true
res  201 { adminId, email, name }
err  409 EMAIL_ALREADY_EXISTS
```

**PATCH `/admin/admins/{adminId}`** (부분 수정)
```
req  { name?, isActive?, isAdmin?, permissions?, mustChangePassword?, password? }
res  200 Admin
```
- `email` 은 변경할 수 없다. 보내면 400.
- 🔴 **`password` 를 보내면 서버가 `mustChangePassword` 를 `true` 로 올린다** (요청이 그 필드를
  명시했으면 그 값이 이긴다).
  방향에 주의하라 — 여기서 비밀번호를 바꾸는 사람은 **계정 주인이 아니라 관리자**다.
  동료 비밀번호를 재설정해 주는 상황이고, 그러면 재설정한 사람이 그 비밀번호를 안다.
  내려 버리면 그 상태가 그대로 굳는다. 생성(`POST`)이 기본 `true` 인 것과 같은 이유다.
  본인이 스스로 바꾸는 경로는 `/auth/admin.change-password` 이고, **그쪽만 `false` 로 내린다**
  (거기서는 새 비밀번호를 아는 사람이 본인뿐이다).
- **본인 계정의 `isAdmin` / `isActive` 를 실제로 바꾸려 하면 400 `SELF_DEMOTION_FORBIDDEN`.**
  (kiik 은 조용히 무시했는데, 눌렀는데 안 바뀌는 화면이 되어 여기서는 명시적으로 거절한다.)
  **판정은 "값이 실제로 달라질 때"만이다** — 키가 실렸어도 현재 값과 같으면 통과시킨다.
  이름만 고치는 PATCH 에 폼이 들고 있던 `isAdmin` 이 딸려 왔다고 400 을 주면,
  화면은 "이름 수정이 왜 실패하지"가 되고 원인을 알 수 없다.
  SPA 도 본인 행의 두 토글을 비활성 처리한다.

---

## 2. 공지사항 · 업데이트 (posts)

한 컬렉션에 `kind` 로 갈린다. `notice` = 공지사항, `release` = 업데이트.
공개 API(`GET /posts`)는 `publishedAt <= now` 만 보여 주지만, **어드민 목록은 예약분까지 전부** 보여 준다.

권한 키: `notice` → `posts-notices`, `release` → `posts-releases`.

🔴 **`/admin/posts` 한 라우트가 두 권한을 오간다.** `?kind=` 로 갈리므로 권한 키를 라우트
등록 시점에 고정할 수 없다 — 하나로 못박으면 공지 권한만 가진 사람이 업데이트까지 쓰게 된다.
요청마다 `kind` 를 읽어 키를 고른 뒤 판정해야 하며, `kind` 를 생략한 목록 조회는
**두 권한 중 하나라도 있으면 통과**시키고 응답은 가진 권한의 `kind` 로 좁힌다
(생략을 "전부 허용"으로 읽으면 그것도 같은 구멍이다).
상세·수정·삭제는 **저장된 문서의 `kind`** 로 판정한다 — 요청이 주장하는 `kind` 를 믿으면
`kind` 만 바꿔 보내서 남의 메뉴 글을 지울 수 있다.

| Method | Path |
|---|---|
| GET | `/admin/posts?kind=notice\|release&status=published\|scheduled&search=&limit&cursor` |
| GET | `/admin/posts/{postId}` |
| POST | `/admin/posts` |
| PATCH | `/admin/posts/{postId}` |
| DELETE | `/admin/posts/{postId}` |
| POST | `/admin/posts/images/upload-url` |

```
목록 item = { postId, kind, title, publishedAt, excerpt, createdAt, updatedAt }
상세      = { postId, kind, title, body, publishedAt, createdAt, updatedAt }

POST   req { kind, title, body, publishedAt }   → 201 상세
PATCH  req { kind?, title?, body?, publishedAt? } → 200 상세
DELETE                                          → 204
```

### 2.1 본문은 마크다운이다

- `body` 는 **마크다운**이다. 서버는 마크다운을 파싱하지도 렌더하지도 않고 **문자열 그대로**
  저장·반환한다 — 렌더는 읽는 쪽(어드민 미리보기, 앱 상세)이 한다.
  🔴 **`internal/posts` 의 원래 결정(「평문, 줄바꿈만 산다」)을 이 문서가 대체한다.**
  코드 주석이 아직 평문이라고 말하고 있으면 그 주석이 낡은 것이다.
- 허용 문법은 아래 **§2.1.1 의 목록으로 한정한다.**
  이유는 **렌더러가 둘이기 때문이다** — 어드민 미리보기(`marked`)와 앱 상세(`markdown-it`)가
  서로 다른 구현으로 같은 글을 그린다. 넓은 문법을 허용할수록 "어드민에서는 멀쩡한데
  앱에서는 깨진 글"이 늘고, 그건 작성자가 저장하기 전에는 알 수 없다.

#### 2.1.1 허용·금지 문법 (양쪽 렌더러가 글자 하나까지 맞춘다)

**허용** — 두 렌더러가 **똑같이 그려야** 하는 것. 전부 CommonMark 범위 안이라 어느 쪽도
플러그인이 필요 없다.

| 문법 | 표기 |
|---|---|
| 제목 | `#` ~ `######` (h1~h6) |
| 굵게 / 기울임 | `**굵게**`, `*기울임*` (`__`/`_` 도 같게 동작) |
| 비순서 목록 | `- 항목` (중첩 허용) |
| 순서 목록 | `1. 항목` (중첩 허용) |
| 링크 | `[글자](https://...)` |
| 이미지 | `![대체글](https://...)` |
| 인용 | `> 인용` |
| 인라인 코드 / 코드 블록 | `` `code` `` / ```` ``` ```` (언어 하이라이팅 없음) |
| 수평선 | `---` |
| 문단 · 줄바꿈 | 빈 줄 / 줄 끝 공백 2개 |
| 빈 행 | 빈 줄만 있는 행에 `&nbsp;` 하나 |

**금지** — 두 렌더러가 **똑같이 안 그려야** 하는 것. 마크업이 글자 그대로 화면에 나오는
것이 정상 동작이다(한쪽만 그리면 그게 버그다).

| 금지 | 왜 |
|---|---|
| 날 HTML (`<div>`, `<script>` …) | §2.1 의 신뢰 경계. `marked` 는 옵션으로 끄고 `DOMPurify` 로 한 번 더 막는다. `markdown-it` 은 `html: false` (기본값이지만 **명시**한다 — 기본값이 바뀌면 조용히 열리는 구멍이다) |
| 자동 링크 (linkify) | 맨 URL 을 링크로 바꾸는 규칙이 두 구현에서 미묘하게 다르다. 켜 두면 「어드민에선 링크인데 앱에선 글자」가 된다. 링크는 `[글자](url)` 로만 쓴다 |
| 표 (`\| a \| b \|`) | 폭이 좁은 폰 화면에서 어차피 읽히지 않는다. 앱에 표 스타일이 얹혀 있다면 **쓰지 않는 코드로 남겨 두거나 지운다** |
| 취소선 (`~~취소~~`) | GFM 전용이라 양쪽 다 플러그인이 필요하다. 공지·업데이트에서 쓸 일이 없어 비용만 남는다 |
| 할 일 목록 (`- [ ]`) | 같은 이유. 읽는 글이지 체크하는 글이 아니다 |
| 각주 · 정의 목록 · 수식 | 같은 이유 |

몇 가지 못:

- 🔴 **제목은 h1~h6 을 전부 렌더한다.** 작성 관례는 h3 까지지만, 그 관례를 렌더러에서
  강제(h4 이상을 제거)하지 마라. 어드민이 `####` 를 지우고 앱이 그리면 바로 그
  「양쪽이 다르게 보이는 글」이 된다 — 막으려던 것을 스스로 만드는 셈이다.
  관례는 툴바가 h1~h3 만 제공하는 것으로 유도하고, 렌더러는 둘 다 그린다.
- **빈 행은 `&nbsp;` 로만 만든다.** 마크다운에서 빈 줄은 「문단을 나누라」는 신호이지 빈 행이
  아니다 — 빈 줄을 몇 개 넣든 결과는 문단 둘이고, 사이에는 문단 여백만 남는다. 한 행을
  통째로 비우려면 그 자리에 `&nbsp;` 하나를 둔다(양쪽 다 빈 문단 하나를 더 그린다).
  **문자 엔티티는 날 HTML 이 아니다** — 태그가 아니라 문자라 위 금지 항목에 걸리지 않고,
  `markdown-it` 과 `marked` 가 둘 다 기본으로 해석한다. 이 줄이 없으면 나중에 누군가
  「HTML 스러운 것」으로 보고 막아, 그날부터 올라간 글의 빈 행이 `&nbsp;` 글자로 보인다.
- 링크·이미지 URL 은 `http` / `https` 만 통과시킨다. `javascript:` 는 양쪽에서 막는다
  (`markdown-it` 은 `validateLink` 기본값이 이미 막고, 어드민은 `DOMPurify` 가 막는다).
- 이 표를 바꿀 때는 **두 저장소를 같은 날 고친다.** 한쪽만 먼저 넓히면 그날부터
  작성자가 "어드민에서 멀쩡한 글"을 저장하고, 앱에서 깨진 것은 아무도 모른다.
- 🔴 **날 HTML 을 렌더하지 마라.** 마크다운 안의 HTML 은 렌더러에서 꺼 두고, 렌더 결과는
  띄우기 전에 새니타이즈한다. 본문을 넣는 사람이 어드민 계정뿐이라 해도, 계정 하나가
  털리면 그 글을 읽는 **모든 앱 사용자**에게 스크립트가 실행된다. 신뢰 경계가 다르다.
- 🔴 **`excerpt` 는 이미 평문이다. 마크다운으로 렌더하지 마라.**
  서버가 이미지·링크·제목 기호를 걷어내고 눕혀서 준다. 다시 렌더하면 눕히기가 남긴
  잔여 기호를 문법으로 잘못 읽어, 목록 한 줄만 본문과 다르게 보인다.
- **이미지만 있는 본문의 `excerpt` 는 빈 문자열**이다. 오류가 아니다 — 대체 텍스트로
  자리를 채우지 않기로 한 결정이며, 그때 목록은 제목만 그린다.

### 2.2 본문 이미지 업로드

```
POST /admin/posts/images/upload-url
req  { contentType: "image/png"|"image/jpeg"|"image/webp"|"image/gif", bytes: number }
res  201 { uploadUrl, storagePath, url, expiresInSec }
```

- 저장 경로는 `admin/posts/images/{16hex}.{ext}`. 이모티콘과 달리 **글에 매이지 않는다** —
  작성 중(아직 postId 가 없을 때)에도 이미지를 넣을 수 있어야 하기 때문이다.
- 접두어 `admin/` 은 **관리자가 올린 것**이라는 표시다. 같은 버킷에 사는 사용자 자산
  (`users/{uid}/avatar/` · `rounds/{roundId}/media/`)과 **지우는 규칙이 정반대**라서 나눈다 —
  사용자 자산은 탈퇴·만료로 통째로 지우고, 관리자 자산은 참조가 끊겨도 남긴다(아래 고아
  이미지 항목). 정리 배치가 둘을 경로만 보고 가리지 못하면 실수 한 번이 되돌릴 수 없다.
  이모티콘(`emoticons/{characterId}/`)은 이미 심긴 자산이 있어 옮기지 않았다 —
  관리자 자산이 두 자리로 갈린 것은 **알고 받아들인 예외**다.
- 최대 5MB. 업로드 방식은 §4 와 같다: SPA 가 `uploadUrl` 로 직접 PUT 하고,
  요청한 `contentType` 을 헤더에 그대로 실어야 서명이 맞는다.
- 그 다음 **에디터가 `![](url)` 을 본문에 끼워 넣는다.**

🔴 **여기서만 "URL 을 저장하지 않는다" 는 집안 규칙을 깬다.** 다른 자리는 `storagePath` 만
저장하고 URL 을 응답마다 다시 만들지만, 마크다운 본문은 서버가 뜻을 모르는 자유 문자열이라
그렇게 할 수 없다. 되살리려면 `media:posts/images/ab12.png` 같은 placeholder 를 두고
읽을 때마다 펴고 저장할 때마다 접어야 하는데, 그 비용을 **한 번도 일어난 적 없는 도메인
변경**을 막으려고 상시로 치르는 셈이 된다.

대신 대가를 적어 둔다 — `MEDIA_PUBLIC_BASE_URL` 이 바뀌는 날 **이미 쓴 글의 이미지가 전부
깨진다.** 그때는 `posts` 컬렉션의 `body` 를 훑어 옛 베이스를 새 베이스로 치환하는 일회성
마이그레이션이 필요하다(글 수가 적어 실행 가능한 규모다). 이 문단을 지우지 마라 —
그날 이 사실을 아는 사람이 아무도 없으면 원인을 찾는 데 하루가 든다.

- 고아 이미지(본문에서 지웠지만 GCS 에 남은 파일)는 **지우지 않는다.** 본문을 파싱해
  참조를 세야 하는데, 그 판정이 틀리면 살아 있는 글의 그림이 사라진다. 되돌릴 수 없는 쪽의
  위험이 훨씬 크므로 남기는 쪽을 고른다.

### 2.3 앱 쪽 영향

`GET /posts/{postId}` 의 `body` 도 같은 마크다운이다. 앱의 공지·업데이트 화면은
**만들어졌다** — `birdieup-app` 의 설정 시트에서 열리고, 마크다운은 `markdown-body.tsx`
(`@ronradtke/react-native-markdown-display`)가 그린다.

그래서 이 문서의 §2.1 「허용·금지 문법」은 이제 **양쪽 렌더러의 계약**이다. 어드민 에디터가
내보내는 문법과 앱이 그리는 문법이 갈리면, 운영자가 화면에서 본 것과 회원이 보는 것이
달라진다 — 문법을 늘릴 때는 두 곳을 함께 본다.
- `title` 1..100자, `body` 1..20000자.
- `publishedAt` 이 미래면 앱에서 안 보인다(= 예약 발행). 목록에 「예약」 배지로 표시한다.
- `kind` 가 잘못되면 400 `VALIDATION_FAILED`.
- **정렬은 `publishedAt` 내림차순**이다(공개 `GET /posts` 와 같은 색인을 탄다).
  예약 글은 `publishedAt` 이 미래라 목록 맨 위에 온다 — 운영자가 "예약해 둔 것"을 먼저 보는 것이 맞다.
- `excerpt` 는 **서버가 마크다운을 평문으로 눕힌 뒤 앞 100룬**을 자른 값이다
  (`internal/posts/excerpt.go`). 잘렸으면 `…` 이 붙는다. 눕히기가 먼저인 이유는,
  자르고 나서 눕히면 잘린 자리에 반쪽 URL 이나 닫히지 않은 괄호가 남아 되돌릴 수 없기 때문이다.
- `status` (선택): `published` = `publishedAt <= now`, `scheduled` = 미래. 생략하면 전체.
- `search` (선택): **제목 부분검색.** Firestore 는 부분검색을 못 하므로 서버가 필터된 결과를
  상한까지 읽어 메모리에서 거른다. 상한과 그 한계(뒤쪽이 잘릴 수 있다)를 서버 코드 주석에 명시한다.
  이 둘이 없으면 공지가 수백 건 쌓였을 때 제목으로 찾을 방법이 없다 — 커서 페이지네이션이라
  **클라이언트 필터링으로는 흉내 낼 수 없다**(현재 페이지만 걸러져 사용자를 속인다).

---

## 3. 제안받아요 (suggestions)

권한 키: `suggestions`.

| Method | Path |
|---|---|
| GET | `/admin/suggestions?answered=true\|false&notified=true\|false&limit&cursor` |
| GET | `/admin/suggestions/{suggestionId}` |
| POST | `/admin/suggestions/{suggestionId}/answer` |
| POST | `/admin/suggestions/{suggestionId}/notify` |

```
목록 item = { suggestionId, userId, userName, excerpt, createdAt,
              answered: boolean, answeredAt, notifiedAt }
상세      = { suggestionId, userId, userName, phoneNo, body, createdAt,
              answer, answeredAt, notifiedAt }

answer  req { answer }  → 200 { suggestionId, answer, answeredAt, notified: boolean, notifiedAt, reason?: string }
notify                  → 200 { suggestionId, notified: boolean, notifiedAt, reason?: string }
```

- `answered` / `notified` 쿼리를 생략하면 전체. 정렬은 `createdAt` 내림차순.
- **두 응답 모두 `notifiedAt` 을 반드시 싣는다**(발송 실패면 `null`). 빼면 SPA 가 발송 시각을
  스스로 추정해 화면에 적게 되는데, 서버가 준 적 없는 시각이 사실처럼 보이는 것은
  감사 관점에서 그 자체가 결함이다.
- `notified=false` 필터가 있는 이유: 답변은 달렸는데 문자가 안 나간 제안을 **한 화면에서 전부**
  찾을 수 있어야 한다. `total` 이 없는 커서 목록이라 이 필터가 없으면 운영자가 「답변 완료」를
  끝까지 넘겨 보는 수밖에 없고, 그러면 결국 묻힌다.
- `excerpt` 는 `body` 앞 **100자**, 줄바꿈은 공백으로 편다.
- 답변이 없는 제안에 `/notify` 를 부르면 **400 `ANSWER_REQUIRED`**.
- 답변을 저장하면 제안자에게 SMS 가 나간다. **문안은 서버가 정하며 답변 전문을 싣지 않는다**
  (`internal/suggestions/answer.go` 의 `AnswerSMS`) — 길어지면 LMS 로 넘어가 요금이 뛴다.
- **발송 실패가 답변 저장을 되돌리지 않는다.** 그때 `notified: false` 와 `reason` 이 오고
  `notifiedAt` 은 비어 있다. 화면은 그 행에 「문자 미발송」 배지와 재발송 버튼을 둔다
  (= `/notify`). 에뮬레이터 모드에서는 실제로 나가지 않는다(로그만).
- 이미 답변한 제안에 `/answer` 를 다시 부르면 **덮어쓴다**(오타 수정). 그때도 SMS 는 다시 나간다.
- `answer` 1..2000자.
- `phoneNo` 는 상세에만 싣는다. 목록에 개인정보를 뿌리지 않는다.

---

## 4. 이모티콘 (emoticons)

권한 키: `emoticons`.

정본은 Firestore 의 `emoticon_characters/{characterId}` · `emoticons/{emoticonId}` 두 컬렉션이고,
**문서 ID 가 곧 슬러그다**(`birdieup`, `good`, `best` …). 피드가 `emoticonId` 만 저장하므로
자동 ID 를 쓰면 안 되고, **이미 쓰인 id 를 재사용하거나 지우면 과거 피드가 깨진다** —
숨길 때는 `active: false` 를 쓴다.

| Method | Path |
|---|---|
| GET | `/admin/emoticons` |
| POST | `/admin/emoticons/upload-url` |
| PUT | `/admin/emoticon-characters/{characterId}` |
| DELETE | `/admin/emoticon-characters/{characterId}` |
| PUT | `/admin/emoticons/{emoticonId}` |
| DELETE | `/admin/emoticons/{emoticonId}` |

```
GET → 200 {
  characters: [{ id, name, iconPath, iconUrl, order, active }],
  emoticons:  [{ id, characterId, name, imagePath, url, order, active }]
}
```
공개 `GET /emoticons` 와 달리 **`active:false` 와 이미지 없는 행까지 전부** 내려준다.
**정렬은 서버가 끝내서 준다** — `active` 를 거르기 *전에* `order` 오름차순, 같으면 id 오름차순.
공개 API 는 거른 뒤 정렬하지만 여기서는 숨긴 행도 제자리에 있어야 운영자가 순서를 읽을 수 있다.
SPA 는 다시 정렬하지 않는다.

응답의 `url`/`iconUrl` 은 `MEDIA_PUBLIC_BASE_URL + "/" + path` 로 매번 다시 만든 값이다.
저장되는 것은 `imagePath`/`iconPath` 뿐이다.

```
POST /admin/emoticons/upload-url
req  { contentType: "image/png"|"image/jpeg"|"image/webp", bytes: number,
       characterId: string, emoticonId?: string }
res  201 { uploadUrl, storagePath, url, expiresInSec }
```
- `emoticonId` 가 있으면 `emoticons/{characterId}/{emoticonId}-{16hex}.{ext}`,
  없으면 캐릭터 아이콘으로 보고 `emoticons/{characterId}/_character-{16hex}.{ext}`.
  `{ext}` 는 `contentType` 에서 나온다(§2.2 와 같다) — jpeg·webp 를 허용하면서 `.png` 로
  적어 두면 파일 이름이 내용과 어긋나고, 그 뒤로 이 경로를 읽는 도구가 전부 속는다.
- 응답의 `url` 은 업로드가 끝난 뒤 그 파일이 갖게 될 공개 주소다. **업로드 직후에는 아직
  객체가 없어 SPA 는 쓰지 않는다**(미리보기는 로컬 objectURL, 확정 후에는 목록 재조회).
  기존 두 업로드 엔드포인트(`/users/me/avatar/upload-url`, `/rounds/…/media/upload-url`)와
  응답 shape 을 맞추기 위해 남긴다 — 자리마다 모양이 다르면 클라이언트가 매번 다시 배운다.
- **매번 새 난수가 붙는다.** 기존 `cmd/seed-emoticons` 는 고정 경로를 덮어써서 CDN·브라우저
  캐시에 옛 그림이 남았다. 경로가 통째로 바뀌면 그 문제가 사라진다.
- 최대 2MB. 업로드는 SPA 가 `uploadUrl` 로 직접 PUT 하고(WAS 경유 없음), 요청한 `contentType`
  헤더를 그대로 실어야 서명이 맞는다. 그 뒤 `storagePath` 를 아래 PUT 에 넣는다.
- **저장되는 것은 `storagePath` 뿐이고 URL 은 응답마다 다시 만든다**(`MEDIA_PUBLIC_BASE_URL`).

```
PUT /admin/emoticon-characters/{characterId}
req  { name, iconPath, order, active }         → 200 Character   (upsert)
PUT /admin/emoticons/{emoticonId}
req  { characterId, name, imagePath, order, active } → 200 Emoticon (upsert)
DELETE 둘 다 → 204
```
- id 는 `^[a-z][a-z0-9_]{0,39}$`. 아니면 400.
- `name` 1~20자, `order` 는 0 이상 9999 이하 정수. 벗어나면 400.
- 캐릭터 삭제는 그 캐릭터에 이모티콘이 남아 있으면 409 `CHARACTER_NOT_EMPTY`.
- **이모티콘 삭제는 서버가 막지 않는다.** 그 id 가 피드에서 쓰였는지 세려면 피드 전체를 훑어야
  하는데, 그 비용을 삭제 한 번마다 치를 수 없다. 그래서 마지막 방어선은 화면의 경고 문구이고,
  운영 규칙은 **"지우지 말고 `active:false` 로 숨긴다"** 이다.
- 쓰기가 성공하면 서버가 `emoticons.Catalog` 의 5분 캐시를 즉시 무효화한다.
  안 하면 방금 등록한 이모티콘이 앱에 최대 5분 늦게 뜬다.
- ⚠ **그 무효화는 프로세스 안에서만 유효하다.** 신호가 패키지 전역 세대 카운터라
  (`internal/emoticons`), 인스턴스가 여럿인 Cloud Run 에서는 **쓰기를 받은 인스턴스만**
  캐시를 버리고 나머지는 최대 5분 옛 목록을 계속 준다. 로컬·단일 인스턴스에서는 드러나지
  않아 배포 뒤에야 "어떤 사람에게는 보이고 어떤 사람에게는 안 보인다" 로 나타난다.
  전 인스턴스에 걸치게 하려면 Firestore 의 개정 문서를 구독하는 공유 신호가 필요하다.

---

## 5. 활동 로그 (audit logs)

`isAdmin` 전용. **여기만 커서가 아니라 page/total 을 쓴다** — 감사 화면은 "몇 건 중 몇 페이지"가
필요하고, Firestore 의 집계 카운트 쿼리로 total 을 낼 수 있다.

```
GET /admin/audit-logs
    ?page=1&pageSize=20(최대 100)&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
    &adminId=&target=&search=&sortOrder=asc|desc(기본 desc)

res 200 {
  logs: [{
    auditLogId, adminId, adminName, adminEmail,
    actions: "POST /admin/posts",     // "METHOD 경로"
    targets: "posts",                 // 도메인 (admin|auth|posts|suggestions|emoticons|metrics|scenes)
    details: { status: number, body: object },   // password 계열은 서버가 [REDACTED]
    ipAddress, createdAt
  }],
  total, page, pageSize
}
```

- **쓰기 요청(GET 이 아닌 것)만 기록한다.** 조회까지 남기면 로그가 조회로 뒤덮여 쓸모가 없다.
  로그인 성공/실패는 예외적으로 기록한다(`actions: "어드민 로그인" / "어드민 로그인 실패"`).
- 이 조회 API 자신은 기록하지 않는다.
- 🔴 **필터에 복합 색인이 필요하다** — `audit_logs(adminId ASC, createdAt DESC)` 와
  `audit_logs(targets ASC, createdAt DESC)`. 에뮬레이터는 자동으로 만들어 주지만 운영은 아니다.
  **색인 소유자는 birdieup-terraform** 이므로 거기에 추가하지 않으면 그 필터만 500 이 난다.
- `dateFrom`/`dateTo` 는 KST 날짜이고 `dateTo` 는 그날을 포함한다.
- `search` 는 actions / 관리자명 / 이메일 / IP 부분검색.

---

## 6. 부트스트랩

첫 어드민 계정은 화면으로 만들 수 없다(로그인해야 만들 수 있으므로).
`go run ./cmd/create-admin -email … -name … -password …` 로 넣는다.
이 도구는 `isAdmin: true`, `mustChangePassword: true` 로 만든다.

`cmd/seed-emoticons` 는 이 어드민이 붙는 순간 **은퇴 대상**이다(도구 자신의 주석이 그렇게 적고 있다).
당장 지우지는 않되, 이모티콘 화면이 동작하는 것을 확인한 뒤 README 에 「사용 중지」를 적는다.

---

## 7. birdieup-was 현황 — 있는 것과 없는 것

이 계약을 붙이기 전 birdieup-was 를 직접 훑어 확인한 결과다(2026-09-03 기준).
**어드민 쪽은 읽기 API 만 있고 쓰기·인증은 통째로 없다.** 새로 만들어야 하는 것을 여기 적어 둔다.

### 7.1 이미 있는 것 (그대로 쓴다. 다시 만들지 마라)

| 있는 것 | 위치 | 비고 |
|---|---|---|
| `GET /posts`, `GET /posts/{postId}` | `internal/posts/posts.go` | 공개·미인증. `publishedAt <= now` 만 보인다 |
| `GET /users/me/suggestions` 3종 | `internal/suggestions/suggestions.go` | 본인 것만. 남의 id 는 404 |
| 제안 저장소 메서드 | `internal/suggestions/store.go` | `Recent` / `SaveAnswer` / `MarkNotified` / `PhoneNo` |
| 답변 + SMS 오케스트레이션 | `internal/suggestions/answer.go` | `Answer(...)`, `Notify(...)`, `AnswerSMS(appHost)` |
| `GET /emoticons` | `internal/emoticons/emoticons.go` | `Catalog` 가 5분 캐시. `active:false` 는 걸러서 준다 |
| 서명 URL 발급 | `internal/medialinks/medialinks.go` | V4 서명 PUT, 10분. 조회 URL = `MEDIA_PUBLIC_BASE_URL + "/" + storagePath` |
| 에러·JSON 헬퍼 | `internal/httpx/httpx.go` | 모든 응답이 이걸 거친다 |
| CLI 도구 | `cmd/post`, `cmd/answer-suggestion`, `cmd/seed-emoticons` | 어드민이 대체할 대상 |

**제안 답변은 HTTP 표면만 없을 뿐 로직이 이미 다 있다.** `/admin/suggestions/{id}/answer` 는
`answer.go` 의 `Answer(...)` 를 그대로 부르는 얇은 핸들러여야 한다 — SMS 문안·실패 처리·
`notifiedAt` 규칙을 다시 구현하지 마라.

### 7.2 없어서 새로 만들어야 하는 것

| 없는 것 | 이 문서의 절 |
|---|---|
| 어드민 인증 일체 — `admins` 컬렉션, bcrypt, `ADMIN_JWT_SECRET`, 차단형 미들웨어, 권한 판정 | §1 |
| 활동 로그 — `audit_logs` 컬렉션과 쓰기 요청 기록 | §5 |
| 첫 계정 부트스트랩 CLI | §6 |
| `/admin/posts` CRUD + `status`·`search` 필터 (공개 목록과 달리 **예약분까지** 보여야 한다) | §2 |
| `/admin/posts/images/upload-url` — 기존 발급기 둘은 `users/{uid}/avatar/`·라운드 미디어 경로가 박혀 있어 `admin/posts/images/` 를 못 만든다 | §2.2 |
| `/admin/suggestions` 목록·상세·답변·재발송 (로직은 있고 라우트가 없다) | §3 |
| `/admin/emoticons` 쓰기 전체 + `upload-url` + **쓰기 후 `Catalog` 캐시 무효화** | §4 |
| `/admin/metrics/summary`·`/admin/metrics/daily` + 매일 04:00(KST) 롤업 배치와 `daily_actives` 방문 계측 | §8 |

그 밖에 짚어 둘 것:

- **`internal/posts` 의 `body` 주석이 낡는다.** 평문이라고 적혀 있지만 §2.1 로 마크다운이 됐다.
  저장 코드는 그대로여도 되지만 주석과 `docs/` 는 고쳐야 한다.
- **Firestore 복합 색인의 소유자는 birdieup-terraform 이다**(이 저장소가 아니다).
  어드민 목록은 공개 목록과 다른 조합을 쓴다 — `posts(kind ASC, publishedAt DESC)` 는 이미
  필요했고, `suggestions` 의 운영자 목록은 `createdAt DESC` 에 `answer`·`notifiedAt` 필터가
  붙으므로 색인이 하나 더 필요할 수 있다. 배포 전에 확인할 것.
- **`cmd/seed-emoticons` 는 은퇴 대상**이다(도구 자신의 주석이 그렇게 적고 있다).
  이모티콘 화면이 동작하는 것을 확인한 뒤 그 README 에 「사용 중지」를 적는다.

---

## 8. 지표 (metrics)

권한 키 **`metrics`**. `isAdmin` 이거나 `permissions.metrics` 가 true 인 계정만 부를 수 있고,
아니면 403 `FORBIDDEN` 이다.

어드민 콘솔의 **홈(`/`)이 곧 이 지표 대시보드**다 — `/metrics` 같은 별도 경로는 없다.
다만 **메뉴(홈)에는 권한을 달지 않는다.** 라우트 가드가 권한 없는 계정을 홈으로 되돌리는데
그 홈까지 막혀 있으면 무한 루프가 되기 때문이다. 로그인 후 착지점은 누구나 열려 있고,
막는 것은 이 API 뿐이다. 권한이 없는 계정에게는 화면이 403 을 받아 안내 문구로 대체한다.

### 8.1 실시간과 야간 롤업이 갈리는 지점

**이 화면을 읽는 사람이 가장 먼저 오해하는 지점이므로 먼저 적는다.**

| 필드 | 무엇인가 | 기준 시각 |
|---|---|---|
| `live.*` | 요청을 받은 그 순간 컬렉션을 세어 만든 값 | 지금 (`live.asOf`) |
| `rollup.*` | 야간 배치가 접어 둔 값 | `rollup.date` (보통 어제) |
| `daily.days[]` | 같은 배치가 하루 단위로 접어 둔 값 | 각 항목의 `date` |

- 배치는 **매일 04:00(KST)** 에 돌고 **전날치까지** 접는다. 그래서 `rollup.date` 는 보통 어제다.
- **오늘은 아직 집계 전이다.** `daily` 의 기간에 오늘이 들어 있어도 오늘 문서는 없어서
  `missing: true` 로 내려간다. 화면은 그 칸을 **0 으로 그리면 안 된다** — 0 으로 그리면
  "오늘 갑자기 뚝 떨어졌다"로 읽힌다. "집계 중"으로 표시한다.
- 그래서 `live.users.active` 와 §8.3 마지막 날의 `cumulative.users` 가 어긋나는 것은
  **정상**이다. 서로 다른 시각의 값이고, 같아야 하는 값이 아니다.
- 날짜는 전부 KST 이고 `dateTo` 는 그날을 **포함**한다(§5 활동 로그와 같은 규칙).
- 🔴 **사진/동영상 누계(§8.3 의 `cumulative.photos` / `cumulative.videos`)는 누적 업로드 수이며 삭제분을 빼지 않는다.**
  피드를 지우면 `medias` 문서가 함께 지워져 "몇 장이 지워졌는지"를 나중에 복원할 수 없기 때문이다.
  지금 살아 있는 미디어 수가 필요하면 `live.media.alive` 를 본다(이쪽은 실시간 집계다).

### 8.2 요약

```
GET /admin/metrics/summary

res 200 {
  live: {                                    // 요청 시점 실시간 집계
    users:     { active, withdrawn, suspended },
    rounds:    { total, live, ended, aborted },
    feeds:     { total, deleted, alive },
    friends:   { total, linked, unlinked },
    reactions: { total },
    media:     { alive },
    asOf: "2026-09-06T11:20:00Z"             // RFC3339 UTC
  },
  rollup: {                                  // 야간 배치가 접어 둔 값. 없으면 null
    date: "2026-09-05",                      // 마지막으로 집계가 끝난 날 (KST)
    activeUsers: { dau, wau, mau, contributors, viewersMissing?: true }
  }
}
```

- **`rollup` 은 롤업 문서가 하나도 없으면 `null` 이다.** 배치가 아직 한 번도 안 돌았거나
  방금 붙인 환경이 그렇다. 이때 화면은 **0 을 그리지 않고** "집계 대기 중"을 보여준다 —
  0 을 그리면 "지표가 0" 인지 "아직 안 붙었는지"를 구분할 수 없다.
- `live` 는 롤업과 무관하게 언제나 온다. `rollup` 이 null 이어도 누적 카드는 그릴 수 있다.
- `activeUsers.dau|wau|mau` 는 `rollup.date` 기준의 **이동 구간** 값이다. 누적값이 아니므로
  "기간 증감"을 계산하지 마라 — 구간이 겹쳐서 뺄셈이 성립하지 않는다.
- ⚠ **`activeUsers.viewersMissing: true` 는 `rollup.date` 가 방문 계측(`daily_actives`)
  시작 이전이라는 표식이다.** 백필로 채운 날이 그렇다(§8.3 의 같은 표식과 뜻이 같다).
  이때도 **`dau` / `wau` / `mau` 는 언제나 온다 — 값은 0 이다.** 필드가 빠지지 않는다.
  화면은 **그 0 을 값으로 쓰면 안 된다** — `—` 로 그린다.
  같은 날의 `contributors` 는 유효하다(쓰기 기록은 뒤늦게도 셀 수 있다). 함께 지우지 마라.
  서버가 `omitempty` 로 셋을 지우는 안은 채택하지 않았다. 그러면 계측 이후에 **진짜로**
  아무도 안 온 날의 `0` 까지 사라져서, 0 과 없음을 구분한다는 이 API 의 전제가 깨진다.
- **`yesterday` / `last7d` / `cumulative` 는 없다.** 셋 다 화면이 §8.3 `daily` 응답으로
  직접 만든다. **빠뜨린 것이 아니라 일부러 뺀 것이니 다시 넣지 마라.**
  - 기간 증감: 서버가 접어 주던 7일 합계는 빠진 날을 조용히 건너뛰어 **가만히 작은 수**를
    내놓았다 — 값이 없는 날을 0 처럼 취급하는 셈이라 이 API 의 전제를 어긴다. `daily` 에는
    `missing: true` 한 칸이 있어 화면이 몇 날을 놓쳤는지 안다.
  - 누계: 누적 꺾은선은 §8.3 의 **날짜별** `cumulative` 로 그린다(그래야 날마다 점이 찍힌다).
    요약의 누계는 그 시계열의 마지막 점과 같은 값이라, 두 자리에 같은 수를 두면 언젠가 한쪽만
    고쳐져 서로 다른 말을 한다.

### 8.3 일자별

```
GET /admin/metrics/daily?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD

res 200 { days: [
  { date: "2026-09-01", missing: false,
    users:     { new, withdrawn, restored },
    active:    { viewersDau, viewersWau, viewersMau, contributors, viewersMissing?: true },
    friends:   { new, newLinked },
    rounds:    { started, ended, aborted, watchers,
                 byBetType: { stroke, holecost, friendly, skins } },
    feeds:     { created, messages, emoticons, system, youtube, photos, videos, deleted },
    reactions: { created },
    cumulative:{ users, usersActive, friends, rounds, feeds, messages, photos, videos, reactions },
    cumulativeGap?: true },
  { date: "2026-09-02", missing: true }
] }
```

- `dateFrom` / `dateTo` **둘 다 필수**다(하나만 주면 400). KST 날짜, `dateTo` 포함.
- 응답의 `days` 는 요청 구간의 **모든 날짜를 빠짐없이** 오름차순으로 담는다.
  구멍은 빼는 것이 아니라 `missing: true` 로 표시된다.
- ⚠ **`missing: true` 인 날은 그날 롤업 문서가 없다는 뜻이고, `missing` 과 `date` 외의
  필드는 오지 않는다.** 0 으로 채워 그리지 마라 — 표에는 `—`, 추이 선은 끊는다.
  아직 집계 전인 오늘, 배치가 실패한 날, 서비스 이전의 날이 전부 여기 걸린다.
  **서버는 이 셋을 구분해 주지 않는다.** 화면이 시계로 갈라야 한다 — 날짜 D 의 집계 시각은
  `D+1일 04:00 (KST)` 이므로, 그 시각 전이면 "집계 중"이고 지났는데도 비어 있으면
  "데이터 없음"이다. 밀린 날을 전부 "집계 중"으로 그리면 **배치가 죽어도 화면이 조용하다.**
- ⚠ **`active.viewersMissing: true` 는 그날 방문 계측(`daily_actives`)이 없다는 표식이다.**
  과거를 백필로 채운 날이 그렇다 — 피드·라운드 같은 쓰기 기록은 뒤늦게도 셀 수 있지만
  "그날 누가 앱을 열었는가"는 그때 찍어 두지 않으면 복원할 수 없다.
  이때도 **`viewersDau` / `viewersWau` / `viewersMau` 는 언제나 온다 — 값은 0 이다.**
  필드가 빠지지 않으니 존재 여부로 판정하지 마라. 이 표식이 서면 **그 0 을 값으로 쓰지 말고**
  세 지표만 `—` 로 그린다. 같은 날의 `contributors` 와 나머지 지표는 유효하다.
  (`omitempty` 로 지우지 않는 이유는 §8.2 에 적어 두었다.)
- ⚠ **`cumulativeGap: true` 는 그날 누계를 전날에서 이어받지 못했다는 표식이다.** 배치가
  하루 멈추면 다음 날이 이렇게 된다. 그날 `cumulative.*` 는 실제보다 훨씬 작으므로
  **숫자로 믿으면 안 된다** — 누적 선을 그 날에서 끊고 표에는 표식을 단다.
  ⚠ **그날의 증분(`users.new` / `rounds.started` / `feeds.created` …)은 유효하다.**
  못 믿는 것은 `cumulative` 뿐이니 증분까지 지우지 마라.
- `feeds.created` 는 그날 만들어진 피드 전체이고 `messages`/`emoticons`/`system`/`youtube` 는
  그 내역이다. `photos`/`videos` 는 그 피드에 붙은 **미디어 개수**라서 피드 수와 합이 맞지 않는다.
- `rounds.byBetType` 의 키는 앱의 내기 방식과 같다(`stroke` 스트로크 / `holecost` 홀당 / `friendly` 친선 / `skins` 스킨스).
  새 방식이 생기면 키가 늘어난다 — 화면은 **모르는 키를 만나도 깨지지 않아야** 한다.
- 구간이 넓으면 응답이 그만큼 길어진다. 화면 기본값은 7 / 30 / 90 일이다.

---

## 9. 장면 좌표 보정 (scenes)

**`isAdmin` 전용이다.** 권한 키가 없다 — 남의 사진과 **좌표**를 통째로 훑어 보여 주는
자리이고, 뒤에 적은 대로 오래 살아남을 화면이 아니라서 `navigation.js` 에 키를 새로 파지
않았다. 사이드바에 넣는다면 `isAdmin` 일 때만 그린다.

> ⚠ **이건 임시 도구다.** 좌표·촬영시각은 올릴 때 브라우저가 EXIF 에서 뽑아 보내는데,
> 그 길이 생기기 전에 올라간 사진에는 값이 없고 **원본 파일에서도 이미 떨어져 나갔다**
> (picker 가 EXIF 를 떼고 넘긴다). 서버가 되찾을 방법이 없어, 남은 길은 올린 사람이
> 기억하는 자리를 손으로 찍어 넣는 것뿐이다. 옛 사진 보정이 끝나면 쓸 일이 거의 없어진다.
> 그래서 서버도 화면도 **얇게 만든다** — 동시 편집 잠금, 기능 플래그, 상태 기계는 넣지 않는다.
> 쓰는 사람은 한 명이다.

| Method | Path |
|---|---|
| GET | `/admin/scenes/pending` |
| POST | `/admin/scenes/locate` |

### 9.1 보정 대상 목록

```
GET /admin/scenes/pending?limit=20&cursor=<opaque>&missing=location|time|any|fixed&q=<검색어>

res 200 {
  items: [{
    sourceType: "ROUND"|"LIFE",
    sourceId:   string,        // roundId | boardId
    sourceName: string,        // 골프장명 | 생활피드 제목 — 빈 문자열일 수 있다
    feedId:     string,
    storagePath:string,        // 첨부를 특정하는 키
    mediaKind:  "photo"|"video",
    thumbUrl:   string,        // 썸네일이 없으면 원본 URL 이 들어온다
    url:        string,        // 원본
    authorName: string,
    uploadedAt: string,        // RFC3339 — 글이 올라온 때(찍힌 때가 아니다)
    hasLocation:boolean,
    hasTakenAt: boolean,
    latitude?:  number,        // 지금 들어 있는 값 — 없으면 키가 빠진다
    longitude?: number,        // 〃
    takenLocal?:string         // "2026-09-05 14:32:10" — 〃
  }],
  nextCursor?: string
}
```

- `missing` 기본값은 `any`(좌표 **또는** 촬영일이 없는 것). `location` 은 좌표 없는 것만,
  `time` 은 촬영일 없는 것만. 그 넷이 아니면 400.
- 🔴 **`fixed` 는 「보정 완료」다** — 빠진 것이 아니라 **이미 채운 것**을 찾는다. 정확히는
  `locationSource == "manual"`, 곧 **사람이 이 화면에서 넣은 좌표**다. 자동으로 잡힌 좌표
  (`exif` / `container`)는 여기 오지 않는다 — 되돌릴 대상이 아니고, 섞이면 목록이 원래
  멀쩡하던 사진으로 뒤덮여 고칠 것을 찾을 수 없다.
  **이 갈래가 없으면 §9.2 의 `clearLocation` 을 쓸 수가 없다.** 좌표를 넣는 순간 그 첨부가
  나머지 세 갈래에서 전부 빠져 다시 닿을 길이 사라지기 때문이다. 잘못 찍은 자리를 되돌리는
  유일한 입구이므로 **화면의 필터에 반드시 넣어라.**
  응답 항목의 모양은 그대로다. `hasLocation` / `hasTakenAt` 이 true 로 나갈 뿐이다.
- 🔴 **`latitude` / `longitude` / `takenLocal` 은 지금 들어 있는 값이다** — `fixed` 갈래가
  쓸모 있으려면 이것이 있어야 한다. 되돌리려고 만든 목록인데 「지금 뭐라고 적혀 있는지」를
  모르면 고쳐 쓸 수가 없다. 다이얼로그의 폼은 이 값으로 채워라.
  **없으면 키가 빠진다.** 0 으로 채우지 않는 이유는 (0,0)이 기니만 앞바다의 **실재하는
  좌표**여서다 — 「없음」과 구별되지 않으면 그 바다에서 찍은 사진을 영영 못 고친다.
  ⚠ `takenAt`(시간대가 확정된 순간)은 **싣지 않는다.** 어드민이 고치는 것은 벽시계 하나이고,
  두 시각을 한 화면에 세우면 어느 쪽을 고치는지 헷갈린다. 그래서 EXIF 에서 순간만 뽑힌
  첨부는 **`hasTakenAt: true` 인데 `takenLocal` 이 없다** — 그때 폼은 빈 칸으로 두고,
  운영자가 새로 적으면 그 값이 순간을 이긴다(§9.2).
- `q` 는 **`sourceName` 부분 일치**로 목록을 좁힌다(골프장 이름 또는 생활피드 제목).
  대소문자를 가리지 않는다 — 이름에 「하늘나라 CC」처럼 라틴 문자가 섞여 있어, 구분하면
  소문자로 친 운영자가 그 라운드를 못 찾는다. 앞뒤 공백은 떼고, 떼고 나서 비면 **보내지 않은
  것과 같다**(거르지 않는다). 100자를 넘으면 잘린다(400 이 아니다).
  🔴 **화면에서 거르지 마라.** 받아 둔 한 장(20건) 안에서만 찾게 되어, 뒤쪽 장에 있는 것을
  「없다」고 말하게 된다. 서버는 훑으면서 이미 원본 문서를 읽어 이름을 꺼내고 있어 공짜다.
  🔴 **`q` 는 훑기 예산을 바꾸지 않는다.** 검색어가 있으면 한 구간이 통째로 0건일 수 있는데
  그것이 정상이다 — `nextCursor` 가 있으면 아직 끝이 아니므로 화면은 「더 보기」로 이어 가야
  한다(아래 훑기 주석). 커서는 `missing` 과 그렇듯 `q` 와도 한 쌍이다. **검색어가 바뀌면
  커서를 버리고 첫 장부터 다시 받아라.**
- `limit` 기본 20, 최대 100. 🔴 **상한이 아니라 목표다** — 한 글의 첨부는 쪼개지 않으므로
  마지막 글의 첨부 수만큼 넘칠 수 있다(커서가 글 단위라 중간에서 자르면 남은 첨부를 다음
  페이지가 건너뛴다). 화면은 이 값을 "정확히 이만큼"으로 읽으면 안 된다.
- `url` 을 목록에 함께 싣는 것이 이 화면의 요점이다. **운영자가 사진을 크게 봐야 어디였는지
  떠올린다** — 썸네일만으로는 좌표를 찍을 수 없다.
- `sourceName` 은 **빈 문자열일 수 있다**(골프장을 안 적고 연 라운드가 있다). 서버가
  「이름 없는 라운딩」 같은 문구를 지어내지 않으니 그 자리에 무엇을 세울지는 화면이 정한다.
- 파일 첨부(PDF 등)와 지워진 글은 애초에 오지 않는다 — 찍힌 자리라는 개념이 없다.

**`nextCursor` 는 더 훑을 것이 남았을 때만 온다.** 없으면 끝이다(`null` 이 아니라 키 자체가
빠진다 — `if (res.nextCursor)` 로 판정하면 둘 다 안전하다).

> 🔴 **이 조회는 훑는다.** Firestore 로는 "medias 배열 안에 latitude 가 없는 것"을 물을 수
> 없어(배열 원소에는 색인이 서지 않는다) 라운드·생활피드를 순서대로 지나며 읽는다. 그래서
> **한 요청에 읽을 문서 수를 500 으로 제한**하고, 소진하면 거기까지 주고 `nextCursor` 를 낸다.
> 즉 **빈 페이지가 와도 끝이 아닐 수 있다** — `nextCursor` 가 있으면 계속 눌러야 한다.
> 보정이 끝나갈수록(채울 것이 없을수록) 빈 페이지가 늘어난다. 복합 색인은 필요 없다.

### 9.2 좌표·촬영일시 찍어 넣기

```
POST /admin/scenes/locate
req {
  sourceType, sourceId, feedId, storagePath,   // 무엇을 고칠지 (전부 필수)
  latitude?: number, longitude?: number,        // 둘 다 있거나 둘 다 없다
  takenLocal?: "2026-09-05 14:32:10",           // 시간대 없는 현지 시각
  utcOffsetMinutes?: number,                    // 알면 함께 (KST = 540)
  clearLocation?: boolean,                      // true 면 좌표를 지운다
  clearTaken?: boolean                          // true 면 촬영일시를 지운다
}
res 200 { ok: true }
```

- 대상은 `storagePath` 로 고른다. 첨부에는 불변 ID 가 없고 배열 순번은 첨부가 하나 빠지는
  순간 다른 사진을 가리키므로, 순번을 키로 쓰지 않는다.
- 좌표를 넣으면 `locationSource` 가 **`manual`** 로 기록된다. 나중에 자동으로 잡힌 좌표와
  사람이 찍은 좌표를 갈라 세는 유일한 단서다. `geohash` 는 서버가 만든다(보내지 마라).
- `takenLocal` 은 **시간대가 없는 벽시계**다. 사람이 기억해 적는 값이라 시간대가 붙을 자리가
  없고, 한국 시간대를 가정해 보내면 해외에서 찍은 사진이 아홉 시간 밀린다.
  사람이 적은 값은 EXIF 값을 **이긴다**(기존 `takenAt` 은 지워진다).
- 🔴 **`utcOffsetMinutes` 는 기본적으로 보내지 마라.** 여기 오는 촬영시각은 사람이 기억해
  적는 값이고, 옛 사진일수록 **어디서 찍었는지가 흐릿하다.** KST(540)를 실어 보내면 해외에서
  찍은 사진에 거짓 시간대가 박히고, 그 뒤로는 시각과 시간대 중 어느 쪽이 맞는지 알 수 없다.
  값이 없으면 서버는 「시간대 미상」으로 둔다 — **KST 를 가정하지 않는다.**
  비워 두어도 잃는 것이 없다: 지도의 정렬은 시간대 없는 벽시계로 하고, 그때 `takenLocal` 을
  **그대로** 읽는다. 운영자가 촬영지의 시간대를 확실히 아는 경우에만 함께 보낸다.
  `takenLocal` 을 새로 적으면 `utcOffsetMinutes` 도 **함께 갈아 끼워진다**(안 보내면 지워진다) —
  새 시각에 옛 시간대를 붙여 두면 둘이 서로 다른 사진의 것이 된다.
- `clearLocation` / `clearTaken` 은 되돌리기다. **화면에 반드시 두어라** — 잘못 찍은 좌표를
  지울 길이 없으면 지도에 엉뚱한 자리의 사진이 영영 남는다.
- 좌표를 넣거나 지우면 지도 파생 문서(`scene_media`)가 **같은 트랜잭션에서** 함께 서거나
  내려간다. 화면은 이 응답 하나만 보면 된다.

에러:

| 상황 | status / code |
|---|---|
| 위도·경도 중 하나만 보냄, 넣기와 지우기를 함께 보냄, 바꿀 값이 없음 | 400 `VALIDATION_FAILED` |
| 좌표가 지구 밖, `takenLocal` 이 `YYYY-MM-DD HH:MM:SS` 모양이 아님 | 400 `VALIDATION_FAILED` |
| 사진·동영상이 아닌 첨부 | 400 `VALIDATION_FAILED` |
| 원본·글·첨부가 없거나 지워짐 | 404 `NOT_FOUND` |

> 🔴 **값이 이상하면 조용히 버리지 않고 거절한다.** 업로드 경로는 좌표 하나 때문에 사진이
> 안 올라가는 편이 더 나빠 잘못된 값을 말없이 버리지만, 여기서는 반대다 — 운영자가 방금
> 찍어 넣은 값이 소리 없이 사라지면 저장된 줄 알고 다음 사진으로 넘어간다.
