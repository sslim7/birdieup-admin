import apiClient from './apiClient';

/**
 * 공지사항 · 업데이트(posts) 어드민 API.
 *
 * 계약 정본은 `docs/admin-api.md` §2 다. 여기 주석과 문서가 어긋나면 문서가 맞다.
 *
 * 공지사항과 업데이트는 **한 컬렉션**이고 `kind` 로만 갈린다(`notice` | `release`).
 * 권한 키도 kind 를 따라 갈린다(`posts-notices` / `posts-releases`) — 그래서 같은 화면
 * 컴포넌트를 쓰더라도 호출에 kind 를 빠뜨리면 남의 메뉴 데이터를 긁게 되므로 kind 는 항상 필수다.
 *
 *   목록   GET    /admin/posts?kind=notice|release&status=published|scheduled&search=
 *                       &limit=1..50(기본 20)&cursor=<opaque>
 *          → 200 { items: [목록item], nextCursor: string|null }
 *   상세   GET    /admin/posts/{postId}          → 200 상세
 *   생성   POST   /admin/posts                   → 201 상세
 *          req { kind, title, body, publishedAt }
 *   수정   PATCH  /admin/posts/{postId}          → 200 상세   (부분 수정)
 *          req { kind?, title?, body?, publishedAt? }
 *   삭제   DELETE /admin/posts/{postId}          → 204 (본문 없음)
 *   이미지 POST  /admin/posts/images/upload-url   → 201 { uploadUrl, storagePath, url, expiresInSec }
 *          req { contentType, bytes }
 *
 *   목록item = { postId, kind, title, publishedAt, excerpt, createdAt, updatedAt }
 *   상세     = { postId, kind, title, body,       publishedAt, createdAt, updatedAt }
 *
 * 주의할 점 몇 가지:
 *
 * - **목록에는 `body` 가 없다.** 대신 `excerpt` 가 온다. 수정 화면을 열 때는 반드시
 *   `fetchPost` 로 상세를 다시 받아야 하고, 목록 item 을 그대로 폼에 부어 저장하면
 *   본문이 통째로 날아간다.
 * - **커서 페이지네이션이고 total 이 없다.** `nextCursor` 를 그대로 다음 요청에 실어
 *   이어 붙이는 방식만 가능하다. 1·2·3 페이지 번호 UI 로 바꾸려 하지 마라 —
 *   서버가 오프셋을 지원하지 않으므로 "3페이지로 점프"를 만들 수 없다.
 *   (page/total 을 쓰는 것은 활동 로그뿐이다. §5)
 * - 어드민 목록은 **예약분(publishedAt 이 미래)까지 전부** 내려준다. 공개 API(`GET /posts`)와
 *   달라지는 지점이고, 화면이 「예약」 배지를 붙이는 근거가 이것이다.
 * - **정렬은 `publishedAt` 내림차순**이다(공개 API 와 같은 색인을 탄다). 예약 글은 미래 시각이라
 *   목록 맨 위에 온다 — 표에서 위쪽이 "아직 안 나간 글"인 것은 버그가 아니라 계약이다.
 * - `status` / `search` 는 **반드시 서버에 위임한다.** 커서 페이지네이션이라 클라이언트에서
 *   `items.filter()` 로 흉내 내면 "지금 받아 둔 페이지 안에서만" 걸러져, 뒷장에 있는 결과가
 *   없는 것처럼 보인다. 그건 빈 결과보다 나쁘다(운영자가 글이 지워진 줄 안다).
 *   `search` 는 제목 부분검색이고, 서버가 상한까지 읽어 메모리에서 거르므로 결과 뒤쪽이
 *   잘릴 수 있다 — 화면에서 "전부 찾았다"고 단정하는 문구를 쓰지 마라.
 * - `excerpt` 는 서버가 `body` 앞 100자를 잘라 줄바꿈을 공백으로 편 값이다. 길이·줄바꿈은
 *   서버가 정리해 주므로 화면에서 다시 자를 필요가 없다(단, 위에 적은 대로 렌더는 하지 않는다).
 * - `title` 1..100자, `body` 1..20000자. 넘거나 비면 400 VALIDATION_FAILED.
 * - `body` 는 **마크다운이다**(§2.1). 서버는 파싱도 렌더도 하지 않고 문자열 그대로 저장·반환하며,
 *   렌더와 새니타이즈는 읽는 쪽 책임이다 — 어드민 미리보기는 `@/lib/markdown` 의 renderMarkdown 을 쓴다.
 *   🔴 `internal/posts` 의 옛 결정(「평문, 줄바꿈만 산다」)은 §2.1 이 폐기했다. 그 서술이 남은
 *   주석·코드를 보면 그쪽이 낡은 것이다.
 *   허용 문법은 GFM 서브셋(제목 h1~h3 · 굵게/기울임 · 목록 · 링크 · 이미지 · 인용 · 코드 · 수평선)이고,
 *   표·각주·날 HTML 은 쓰지 않는다. 렌더러가 어드민과 앱 둘이라, 넓힐수록 두 화면이 갈라진다.
 * - 🔴 **`excerpt` 는 목록 셀에서 렌더하지 마라.** 서버가 `body` 앞 100자를 그대로 잘라 넣으므로
 *   `##`, `![](...)`, `**` 같은 마크다운 기호가 문장 중간에서 잘린 채 섞여 온다. 이걸 마크다운으로
 *   렌더하면 잘린 기호 때문에 깨진 서식이 나오고, HTML 로 꽂으면 새니타이즈를 우회하는 구멍이 된다.
 *   **한 줄 문자열 그대로** 놓는 것이 계약이 정한 사용법이다.
 * - 응답의 모든 timestamp 는 RFC3339 **UTC** 문자열이고, JSON 키는 camelCase 다.
 *   kiik-admin 의 snake_case 를 들고 오지 말 것.
 * - 에러는 항상 `{ code, message }` 이고 `message` 는 화면에 그대로 띄워도 되는 한국어 문장이다.
 *   → `readPostError` 참고.
 */

/** 서버 기본값과 같게 고정한다. 페이지 크기 선택 UI 는 두지 않는다(커서 방식이라 의미가 옅다). */
export const PAGE_SIZE = 20;

/** 계약이 허용하는 kind. 오타가 나면 서버가 400 을 주므로 호출 전에 여기서 막는다. */
const KINDS = ['notice', 'release'];

/**
 * 상태 필터 값. `''`(전체)는 쿼리에서 아예 빠진다.
 *
 * 화면의 세그먼트 버튼과 서버 쿼리 값을 한 곳에서 묶어 두어, 라벨만 바꾸다가 서버에
 * 없는 값을 보내는 사고를 막는다.
 */
export const POST_STATUS = {
  ALL: '',
  PUBLISHED: 'published',
  SCHEDULED: 'scheduled',
};

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new Error(`알 수 없는 게시물 종류입니다: ${kind}`);
  }
}

/**
 * 서버 에러에서 화면에 띄울 문장을 뽑는다.
 *
 * WAS 는 `{ code, message }` 로만 실패를 알리고 `message` 는 이미 한국어 완성 문장이라
 * 우리가 code 별로 문구를 다시 짜지 않는다(문구를 두 군데서 관리하면 반드시 어긋난다).
 * 네트워크가 끊겨 응답 자체가 없는 경우에만 호출부가 준 fallback 으로 떨어진다.
 */
export function readPostError(error, fallback) {
  return error?.response?.data?.message || fallback;
}

// ──────────────────────────────────────────────────────────────
// 시각 변환
//
// 서버는 UTC 로만 주고받고, 작업자는 한국 시간으로 읽고 쓴다. 그 경계를 이 두 함수로
// 좁혀 두고 화면 코드에서는 Date 산술을 하지 않는다.
//
// **브라우저 로컬 타임존이 아니라 Asia/Seoul 로 고정한다.** 표는 요구사항대로 ko-KR/KST 로
// 찍히는데 입력만 브라우저 로컬로 받으면, 해외에서 접속한 작업자가 "14:00" 을 입력하고
// 표에서 "15:00" 을 보게 된다. 그 어긋남이 예약 발행 사고로 직결되므로 양쪽 다 KST 로 맞춘다.
// (이 헬퍼를 src/lib/ 로 옮기지 마라 — 다른 화면과 공유할 성질이 아니고, 지금 그 디렉터리는
//  다른 작업자가 손대고 있다.)
// ──────────────────────────────────────────────────────────────

/** KST 고정 오프셋. 한국은 서머타임이 없어 상수로 두어도 안전하다. */
const KST_OFFSET = '+09:00';

/** Intl 로 KST 벽시계를 'YYYY-MM-DD HH:mm:ss' 로 뽑기 위한 포매터(sv-SE 가 이 형식을 준다) */
const KST_WALL_CLOCK = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** 화면 표기용 ko-KR 포매터. 초는 버린다 — 분 단위로만 예약하기 때문에 노이즈다. */
const KST_DISPLAY = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * 서버의 UTC 문자열 → `<input type="datetime-local">` 이 요구하는 'YYYY-MM-DDTHH:mm'(KST).
 *
 * datetime-local 은 오프셋을 담지 못하는 벽시계 문자열이라, 여기서 KST 로 눌러 넣고
 * `toUtcFromKstInput` 에서 다시 +09:00 을 붙여 되돌리는 것이 유일하게 무손실인 왕복이다.
 */
export function toKstInputValue(isoUtc) {
  if (!isoUtc) return '';
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '';
  // 'YYYY-MM-DD HH:mm:ss' → 'YYYY-MM-DDTHH:mm'
  return KST_WALL_CLOCK.format(date).replace(' ', 'T').slice(0, 16);
}

/**
 * `<input type="datetime-local">` 값(KST 벽시계) → 서버에 보낼 RFC3339 UTC 문자열.
 *
 * 입력값에 오프셋이 없으므로 `new Date(value)` 로 바로 파싱하면 브라우저 타임존으로 해석된다.
 * 그래서 초를 채우고 +09:00 을 명시적으로 붙인 뒤에 파싱한다. 값이 비었거나 깨졌으면 null 을
 * 돌려주고, 호출부는 그 상태로 저장 버튼을 막아야 한다(빈 문자열을 보내면 400 이다).
 */
export function toUtcFromKstInput(inputValue) {
  if (!inputValue) return null;
  const date = new Date(`${inputValue}:00${KST_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** 지금 시각을 datetime-local 초기값(KST)으로. 새 글의 기본 발행일시는 '즉시 발행'이다. */
export function nowKstInputValue() {
  return toKstInputValue(new Date().toISOString());
}

/** 서버의 UTC 문자열 → 표에 찍을 한국 시간 문구. 값이 없거나 깨졌으면 '-'. */
export function formatKstDateTime(isoUtc) {
  if (!isoUtc) return '-';
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '-';
  return KST_DISPLAY.format(date);
}

/**
 * 발행일시가 아직 오지 않았는가(= 예약 상태인가).
 *
 * 서버가 상태 플래그를 따로 주지 않고 `publishedAt` 하나로 판정하기로 한 계약이라,
 * 판정 기준을 화면 여러 곳에 흩지 않고 여기 한 곳에 둔다.
 */
export function isScheduled(isoUtc) {
  if (!isoUtc) return false;
  const time = new Date(isoUtc).getTime();
  if (Number.isNaN(time)) return false;
  return time > Date.now();
}

// ──────────────────────────────────────────────────────────────
// 엔드포인트
// ──────────────────────────────────────────────────────────────

/**
 * 목록 한 페이지. `cursor` 가 없으면 첫 페이지다.
 *
 * `search`(제목 부분검색) / `status`(published|scheduled) 는 선택이고, **빈 값은 쿼리에서
 * 통째로 뺀다.** `?search=` 나 `?status=` 처럼 빈 문자열을 실어 보내면 "빈 문자열로 필터"인지
 * "필터 없음"인지 서버가 구분할 근거가 없어 400 이나 0건으로 갈릴 수 있다.
 *
 * **커서는 검색어·상태와 한 쌍이다.** 조건이 바뀌면 서버가 만든 커서의 의미도 바뀌므로,
 * 조건을 바꿀 때는 반드시 `cursor` 없이 첫 페이지부터 다시 받아야 한다(호출부 책임).
 *
 * 응답이 어떤 이유로든 비정상이어도 화면이 깨지지 않도록 항상 `{ items, nextCursor }` 를
 * 돌려준다. `nextCursor` 는 서버가 주는 불투명 문자열이니 파싱하거나 만들어내지 마라.
 */
export async function fetchPosts({
  kind,
  cursor,
  search,
  status,
  limit = PAGE_SIZE,
} = {}) {
  assertKind(kind);

  const params = { kind, limit };
  // cursor 를 빈 문자열로 보내면 서버가 커서 파싱을 시도하다 400 을 줄 수 있어 아예 뺀다.
  if (cursor) params.cursor = cursor;
  // 앞뒤 공백만 친 검색어는 검색하지 않은 것과 같게 취급한다.
  const trimmedSearch = typeof search === 'string' ? search.trim() : '';
  if (trimmedSearch) params.search = trimmedSearch;
  if (status) params.status = status;

  const { data } = await apiClient.get('/admin/posts', { params });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor ?? null,
  };
}

/** 상세 한 건. 수정 화면이 `body` 를 얻는 유일한 경로다. */
export async function fetchPost(postId) {
  const { data } = await apiClient.get(`/admin/posts/${encodeURIComponent(postId)}`);
  return data;
}

/** 생성. `publishedAt` 은 RFC3339 UTC 여야 한다(`toUtcFromKstInput` 을 거칠 것). */
export async function createPost({ kind, title, body, publishedAt }) {
  assertKind(kind);
  const { data } = await apiClient.post('/admin/posts', {
    kind,
    title,
    body,
    publishedAt,
  });
  return data;
}

/**
 * 부분 수정.
 *
 * 계약상 모든 필드가 선택이지만 화면은 세 필드를 한 폼에서 통째로 받으므로 그대로 보낸다.
 * `kind` 는 보내지 않는다 — 공지사항을 업데이트로 바꾸는 조작을 화면이 제공하지 않는데
 * 굳이 실어 보내면 실수로 종류가 바뀔 여지만 남는다.
 */
export async function updatePost(postId, { title, body, publishedAt }) {
  const { data } = await apiClient.patch(`/admin/posts/${encodeURIComponent(postId)}`, {
    title,
    body,
    publishedAt,
  });
  return data;
}

/** 삭제. 204 라 본문이 없으므로 반환값도 없다. */
export async function deletePost(postId) {
  await apiClient.delete(`/admin/posts/${encodeURIComponent(postId)}`);
}

// ──────────────────────────────────────────────────────────────
// 본문 이미지 업로드 (계약 §2.2)
// ──────────────────────────────────────────────────────────────

/** 서버가 서명 URL 을 내주는 콘텐츠 타입. 이 밖은 400 이라 화면에서 먼저 거른다. */
export const POST_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/** 서버 상한과 같은 5MB. 넘겨 보내 봐야 upload-url 에서 400 이다. */
export const MAX_POST_IMAGE_BYTES = 5 * 1024 * 1024;

/** 바이트 수를 사람이 읽는 크기로. 업로드 거절 문구에 쓴다. */
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 고른 파일이 업로드 제약을 만족하는지 본다.
 * 통과하면 null, 아니면 화면에 그대로 보여 줄 한국어 사유를 돌려준다.
 *
 * 서버도 같은 검사를 하지만 화면에서 먼저 거른다 — 5MB 짜리 파일을 다 올린 뒤 400 을 받는
 * 것과, 고르는 즉시 거절당하는 것은 사용자 입장에서 전혀 다른 경험이다.
 */
export function validatePostImage(file) {
  if (!file) return '이미지를 선택해 주세요.';
  if (!POST_IMAGE_TYPES.includes(file.type)) {
    return 'PNG · JPG · WEBP · GIF 이미지만 올릴 수 있어요.';
  }
  if (file.size > MAX_POST_IMAGE_BYTES) {
    return `이미지는 ${formatBytes(MAX_POST_IMAGE_BYTES)} 이하만 올릴 수 있어요. (선택한 파일 ${formatBytes(file.size)})`;
  }
  return null;
}

/**
 * 서명된 업로드 URL 을 받는다.
 *
 * 이모티콘(§4)과 달리 **글에 매이지 않는다** — 저장 경로가 `admin/posts/images/{16hex}.{ext}` 라
 * postId 를 요구하지 않는다. 아직 저장하지 않은 새 글에도 이미지를 넣을 수 있어야 하기 때문이다.
 */
export async function createPostImageUploadUrl({ contentType, bytes }) {
  const { data } = await apiClient.post('/admin/posts/images/upload-url', {
    contentType,
    bytes,
  });
  return data ?? {};
}

/**
 * 2단계 업로드: 서명 URL 발급 → 스토리지로 직접 PUT → **본문에 박을 절대 URL** 반환.
 *
 * 🔴 두 번째 단계에 apiClient(axios 인스턴스)를 쓰면 안 된다. baseURL 이 붙어 절대 URL 이
 *    망가지고, 요청 인터셉터가 Authorization 헤더를 얹으면 GCS 가 서명과 헤더 조합을 다시
 *    계산해 403 SignatureDoesNotMatch 를 낸다. 그래서 전역 fetch 로 맨몸 PUT 을 보낸다.
 *    (같은 함정과 같은 해법이 emoticonService.uploadImage 에도 있다. 한쪽만 고치지 마라.)
 *
 * 🔴 Content-Type 은 upload-url 에 보낸 contentType 과 **글자 하나까지 같아야 한다.**
 *    서명이 그 값을 포함해 계산되므로 'image/jpeg' 로 발급받고 'image/jpg' 로 보내면 깨진다.
 *    그래서 file.type 하나를 두 곳에 함께 쓴다.
 *
 * ⚠ fetch 는 axios 와 달리 4xx/5xx 에서도 reject 하지 않는다. `res.ok` 를 직접 봐야 하며,
 *   안 보면 업로드가 실패했는데 성공한 것처럼 깨진 이미지 링크가 본문에 박힌다.
 *
 * ⚠ storagePath 가 아니라 **url 을 돌려준다.** 다른 자리는 path 만 저장하고 URL 을 응답마다
 *   다시 만들지만, 마크다운 본문은 서버가 뜻을 모르는 자유 문자열이라 그렇게 할 수 없다.
 *   그 결정의 근거와 대가(=`MEDIA_PUBLIC_BASE_URL` 이 바뀌는 날 기존 글의 이미지가 전부
 *   깨지고 일회성 치환 마이그레이션이 필요하다)는 계약 §2.2 에 적혀 있다. 여기서 path 로
 *   되돌리려 하기 전에 그 절을 먼저 읽어라.
 */
export async function uploadPostImage(file) {
  const reason = validatePostImage(file);
  if (reason) throw new Error(reason);

  const contentType = file.type;
  const { uploadUrl, url } = await createPostImageUploadUrl({
    contentType,
    bytes: file.size,
  });

  if (!uploadUrl || !url) {
    throw new Error('업로드 주소를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });

  if (!res.ok) {
    throw new Error(
      `이미지 업로드에 실패했습니다. (스토리지 응답 ${res.status}) 잠시 후 다시 시도해 주세요.`
    );
  }

  return url;
}

const postService = {
  PAGE_SIZE,
  POST_STATUS,
  fetchPosts,
  fetchPost,
  createPost,
  updatePost,
  deletePost,
  POST_IMAGE_TYPES,
  MAX_POST_IMAGE_BYTES,
  validatePostImage,
  createPostImageUploadUrl,
  uploadPostImage,
  readPostError,
  toKstInputValue,
  toUtcFromKstInput,
  nowKstInputValue,
  formatKstDateTime,
  isScheduled,
};

export default postService;
