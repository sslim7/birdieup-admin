import apiClient from './apiClient';

/**
 * 제안받아요(suggestions) 어드민 API.
 *
 * 계약의 정본은 docs/admin-api.md §3 이다. 이 주석과 문서가 어긋나면 문서가 맞다.
 * apiClient 의 baseURL 에는 경로 접두사가 없다 — kiik 의 `/api/v1` 관습을 들고 오지 마라.
 * 응답 키는 camelCase 이고, 모든 timestamp 는 RFC3339 UTC 문자열이다.
 *
 * 1) 목록  GET /admin/suggestions?answered=true|false&notified=true|false&limit&cursor
 *    200 {
 *      items: [{
 *        suggestionId, userId, userName,
 *        excerpt,                  // 서버가 body 앞 100자를 자르고 줄바꿈은 공백으로 편다
 *        createdAt,
 *        answered: boolean,
 *        answeredAt: string|null,
 *        notifiedAt: string|null   // 답변 SMS 를 실제로 보낸 시각
 *      }],
 *      nextCursor: string|null
 *    }
 *    - answered / notified 를 생략하면 전체. 정렬은 createdAt 내림차순.
 *    - **total 이 없다.** 페이지 번호 UI 를 만들 수 없고 커서로만 이어 받는다.
 *    - `answered=true&notified=false` 가 「문자 미발송」이다. 이 조합을 서버가 걸러 주는 것이
 *      중요하다 — total 이 없는 커서 목록에서 클라이언트가 거르면 현재 페이지만 걸러져
 *      "미발송 N건"이 전체인 양 보이고, 뒤쪽에 묻힌 제안을 놓친다.
 *    - phoneNo 는 목록에 싣지 않는다(개인정보를 목록에 뿌리지 않는다). 상세에만 온다.
 *
 * 2) 상세  GET /admin/suggestions/{suggestionId}
 *    200 { suggestionId, userId, userName, phoneNo, body, createdAt,
 *          answer, answeredAt, notifiedAt }
 *    - 없는 id 는 404. 화면은 목록으로 돌아갈 길을 줘야 한다.
 *
 * 3) 답변  POST /admin/suggestions/{suggestionId}/answer
 *    req { answer }   // 1..2000자
 *    200 { suggestionId, answer, answeredAt, notified: boolean, notifiedAt, reason?: string }
 *    - 저장하면 제안자에게 SMS 가 나간다. 문안은 서버가 정하며 답변 전문을 싣지 않는다
 *      (길어지면 LMS 로 넘어가 요금이 뛴다).
 *    - 이미 답변한 제안에 다시 부르면 **덮어쓰고 SMS 도 다시 나간다.** 수정 UI 는 저장 전에
 *      그 사실을 반드시 알려야 한다.
 *    - **발송 실패가 답변 저장을 되돌리지 않는다.** 그때 notified:false 와 reason 이 오고
 *      notifiedAt 은 비어 있다. 화면은 폼을 되돌리지 말고 재발송 버튼을 남긴다.
 *
 * 4) 재발송  POST /admin/suggestions/{suggestionId}/notify
 *    200 { suggestionId, notified: boolean, notifiedAt, reason?: string }
 *    400 ANSWER_REQUIRED — 답변이 저장되지 않은 제안에 부른 경우
 *    - 답변은 저장됐는데 문자가 안 나간 건을 다시 쏜다. 이 화면이 없으면 그런 제안은
 *      영원히 묻힌다 — 목록의 「문자 미발송」 필터·배지와 한 쌍이다.
 *
 * **두 응답 모두 notifiedAt 을 반드시 싣는다**(발송 실패면 null). 화면은 이 값을 그대로 쓰고
 * 발송 시각을 스스로 추정하지 않는다 — 서버가 준 적 없는 시각이 사실처럼 보이는 것은
 * 감사 관점에서 그 자체가 결함이다.
 *
 * 에러는 전부 `{ code, message }` 이고 message 는 화면에 그대로 띄워도 되는 한국어다.
 * 에뮬레이터 모드(로컬)에서는 SMS 가 실제로 나가지 않고 로그만 남는다 —
 * 로컬에서 notified:true 를 봤다고 문자가 갔다는 뜻이 아니다.
 */

/** 목록 한 번에 받는 건수. 서버 상한은 50, 기본은 20 이다. */
export const SUGGESTIONS_PAGE_SIZE = 20;

/** 답변 길이 상한. 서버 검증(1..2000자)과 같은 값을 유지해야 400 을 미리 막을 수 있다. */
export const ANSWER_MAX_LENGTH = 2000;

/**
 * 서버 에러에서 화면에 띄울 문장을 뽑는다.
 *
 * WAS 의 `{ code, message }` 에서 message 는 한국어 완성 문장이라 그대로 쓴다.
 * 응답 자체가 없는 경우(네트워크 단절·타임아웃)의 axios `error.message` 는 영어라
 * 사용자에게 보여 주지 않고 호출부가 준 한국어 fallback 으로 대체한다.
 */
export function readErrorMessage(error, fallback) {
  const message = error?.response?.data?.message;
  if (typeof message === 'string' && message.trim() !== '') return message;
  return fallback;
}

/** 응답이 404 인지. 상세 화면이 「존재하지 않는 제안입니다」로 갈지 판단하는 데 쓴다. */
export function isNotFound(error) {
  return error?.response?.status === 404;
}

/**
 * 서버 에러 코드(`{ code, message }` 의 code).
 *
 * message 는 그대로 띄우면 되지만 code 로 분기해야 하는 것이 하나 있다 —
 * `/notify` 의 ANSWER_REQUIRED 는 화면 상태가 서버와 어긋났다는 신호라
 * 문구만 바꾸는 것으로 끝나지 않고 상세를 다시 읽어야 한다.
 */
export function errorCode(error) {
  const code = error?.response?.data?.code;
  return typeof code === 'string' ? code : '';
}

/** 답변이 없는 제안에 재발송을 시도했을 때 서버가 주는 400. */
export const ANSWER_REQUIRED = 'ANSWER_REQUIRED';

/*
 * 날짜 포맷터는 여기서 export 한다.
 * src/lib/ 는 다른 화면들과 공유하는 자리라 이 기능 하나 때문에 건드리지 않는다.
 *
 * 서버 값은 UTC 인데 운영자는 한국 시간으로 읽으므로 timeZone 을 Asia/Seoul 로 고정한다.
 * 브라우저 로컬 타임존에 맡기면 해외에서 열었을 때 발송 시각이 어긋나 보인다.
 * hourCycle 을 h23 으로 두는 이유 — hour12:false 만 주면 자정이 "24시"로 나온다.
 */
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** RFC3339 → '2026. 09. 03.' (KST). 값이 없거나 파싱 실패면 '-' */
export function formatDate(value) {
  const date = toDate(value);
  return date ? DATE_FORMATTER.format(date) : '-';
}

/** RFC3339 → '2026. 09. 03. 14:20' (KST). 값이 없거나 파싱 실패면 '-' */
export function formatDateTime(value) {
  const date = toDate(value);
  return date ? DATE_TIME_FORMATTER.format(date) : '-';
}

/**
 * 제안 목록.
 *
 * @param {object}  options
 * @param {boolean|undefined} options.answered  true=답변 완료 / false=답변 대기 / 생략=전체
 * @param {boolean|undefined} options.notified  true=문자 발송됨 / false=미발송 / 생략=전체
 * @param {number}  options.limit
 * @param {string}  options.cursor  이전 응답의 nextCursor
 * @returns {Promise<{items: object[], nextCursor: string|null}>}
 */
export async function fetchSuggestions({
  answered,
  notified,
  limit = SUGGESTIONS_PAGE_SIZE,
  cursor,
} = {}) {
  const params = { limit };

  // answered / notified 는 둘 다 3-상태(undefined | false | true)다.
  // falsy 검사로 거르면 false(답변 대기 · 문자 미발송)가 조용히 사라져 '전체' 조회가 된다.
  if (answered === true || answered === false) params.answered = answered;
  if (notified === true || notified === false) params.notified = notified;
  if (cursor) params.cursor = cursor;

  const response = await apiClient.get('/admin/suggestions', { params });
  const body = response.data ?? {};

  // 응답이 비어도 화면이 깨지지 않도록 항상 같은 shape 을 돌려준다.
  return {
    items: Array.isArray(body.items) ? body.items : [],
    nextCursor: body.nextCursor ?? null,
  };
}

/** 제안 상세. phoneNo 와 본문 전체는 여기에만 있다. */
export async function fetchSuggestion(suggestionId) {
  const response = await apiClient.get(
    `/admin/suggestions/${encodeURIComponent(suggestionId)}`
  );
  return response.data ?? null;
}

/**
 * 답변 저장(+ SMS 발송).
 *
 * notified:false 로 돌아와도 **답변 저장은 성공한 것이다.** 호출부는 이 반환을 실패로
 * 취급해 폼을 되돌리면 안 된다 — 운영자가 답변을 두 번 쓰게 된다.
 */
export async function answerSuggestion(suggestionId, answer) {
  const response = await apiClient.post(
    `/admin/suggestions/${encodeURIComponent(suggestionId)}/answer`,
    { answer }
  );
  const body = response.data ?? {};
  return {
    suggestionId: body.suggestionId ?? suggestionId,
    answer: body.answer ?? answer,
    answeredAt: body.answeredAt ?? null,
    notified: Boolean(body.notified),
    // 발송 실패면 null 로 온다. 호출부는 이 값을 그대로 저장한다(추정 금지).
    notifiedAt: body.notifiedAt ?? null,
    reason: body.reason ?? '',
  };
}

/**
 * 답변 SMS 재발송.
 * 답변이 저장되지 않은 제안에 부르면 400 ANSWER_REQUIRED 다(= 화면 상태가 낡았다는 신호).
 */
export async function notifySuggestion(suggestionId) {
  const response = await apiClient.post(
    `/admin/suggestions/${encodeURIComponent(suggestionId)}/notify`,
    // 계약상 본문은 없지만 빈 객체를 보낸다 — 본문을 생략하면 axios 가 Content-Type 을
    // 붙이지 않아 서버가 요청을 다르게 읽을 여지가 생긴다.
    {}
  );
  const body = response.data ?? {};
  return {
    suggestionId: body.suggestionId ?? suggestionId,
    notified: Boolean(body.notified),
    notifiedAt: body.notifiedAt ?? null,
    reason: body.reason ?? '',
  };
}

const suggestionService = {
  fetchSuggestions,
  fetchSuggestion,
  answerSuggestion,
  notifySuggestion,
};

export default suggestionService;
