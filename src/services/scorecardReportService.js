import apiClient from './apiClient';
// 🔴 **두 기능을 섞는 import 가 아니다.** 아래 셋은 의견보내기 로직이 아니라
// axios 응답을 읽는 범용 헬퍼이고, 저장소에 이미 같은 자세의 선례가 있다
// (SuggestionDetail.jsx 가 emoticonService 의 formatBytes 를 쓴다).
// 두 벌로 베껴 두면 한쪽만 고쳐져 「네트워크 끊김인데 영어 문장이 뜬다」류로 어긋난다.
import {
  formatDateTime as formatSuggestionDateTime,
  isNotFound as isNotFoundError,
  readErrorMessage as readSuggestionErrorMessage,
} from './suggestionService';

/**
 * 스코어카드 OCR 자동 전송(scorecard reports) 어드민 API.
 *
 * 계약의 정본은 docs/admin-api.md §10 이다. 이 주석과 문서가 어긋나면 문서가 맞다.
 * apiClient 의 baseURL 에는 경로 접두사가 없다 — kiik 의 `/api/v1` 관습을 들고 오지 마라.
 * 응답 키는 camelCase 이고, 모든 timestamp 는 RFC3339 UTC 문자열이다.
 *
 * 🔴 **의견보내기(§3)와 같은 컬렉션이 아니다.** 앱은 스코어카드를 가져올 때마다 사진과
 * 판독 결과를 **자동으로**(기본 켜짐) 올린다. 사람이 쓴 의견과 한 목록에 섞으면 자동
 * 전송이 목록을 덮어 운영자가 실제로 온 의견을 못 본다 — 그래서 서버가 별도 컬렉션·별도
 * 라우트로 받고, 화면도 여기 따로 선다. 이 둘을 한 화면으로 합치려는 시도가 곧 그 사고다.
 *
 * 1) 목록  GET /admin/scorecard-reports?limit&cursor
 *    200 {
 *      items: [{
 *        reportId, userId,
 *        note,                 // 비어 있을 수 있다(자동 전송은 사람이 쓴 글이 없다)
 *        createdAt,
 *        hasPhoto: boolean,
 *        hasData: boolean,
 *        device: { platform, osVersion, appVersion, model } | null
 *      }],
 *      nextCursor: string|null
 *    }
 *    - 정렬은 createdAt 내림차순. limit 기본 20 · 상한 50.
 *    - **total 이 없다.** 페이지 번호 UI 를 만들 수 없고 커서로만 이어 받는다.
 *    - 🔴 **거르기 쿼리가 하나도 없다.** 그러니 화면에 필터바를 세우지 마라 — total 이 없는
 *      커서 목록에서 받아 온 페이지만 걸러 내면 그 부분 집계가 전체인 양 보이고, 뒤쪽 장에
 *      묻힌 건을 「없다」고 말하게 된다(같은 한계를 Suggestions.jsx 의 「첨부 있음」이
 *      안고 있고, 거기서는 그 사실을 화면이 적어 둔다).
 *    - 🔴 **userName·phoneNo 를 일부러 싣지 않는다.** 자동 전송에는 답할 일이 없어 번호를
 *      꺼낼 까닭이 없고, 판독을 고치는 데 필요한 것은 기기 정보와 파일이다. 화면이 사람을
 *      가리려면 userId 만 쓴다.
 *    - device 는 null 일 수 있다(옛 앱이 올린 건). 기기별로 OCR 출력이 갈리므로 이 값이
 *      목록의 첫 열이다 — 같은 사진이 아이폰 Vision 에서는 177블록, 안드로이드 ML Kit
 *      에서는 74블록이라, 기기를 모르면 어디가 새는지 재현할 수가 없다.
 *
 * 2) 상세  GET /admin/scorecard-reports/{reportId}
 *    200 { reportId, userId, note, createdAt,
 *          attachment: {
 *            kind: "scorecard",
 *            photo: { storagePath, url, bytes, contentType } | null,
 *            data:  { storagePath, url, bytes, contentType } | null,
 *            device: { platform, osVersion, appVersion, model } | null
 *          } }
 *    404 NOT_FOUND — 화면은 목록으로 돌아갈 길을 줘야 한다(흰 화면이 남으면 안 된다).
 *    - 🔴 **url 은 짧게 사는 서명 주소다**(§3 첨부와 같은 internal/medialinks 의 ReadTTL).
 *      운영자 응답에만 실린다. 화면이 그 주소를 state 밖에 저장해 두거나, 새 창 주소로
 *      오래 들고 있으면 만료된다 — **열 때마다 상세를 다시 읽는** 구조로 둬라. 목록이
 *      url 을 미리 받아 두지 않는 것도 같은 이유다.
 *
 * 3) 삭제  DELETE /admin/scorecard-reports/{reportId}
 *    204 / 404
 *    - 운영자가 **거르는 손**이다. 회귀 자료(birdieup-app 의 tests/fixtures/real/)로 옮겨
 *      적었거나 쓸 것이 없는 건을 지운다. 자동 전송이라 지우지 않으면 끝없이 쌓인다.
 *    - 🔴 **되돌릴 수 없다.** 사진과 판독 결과가 함께 사라지므로 화면은 확인 단계를 둔다.
 *
 * 에러는 전부 `{ code, message }` 이고 message 는 화면에 그대로 띄워도 되는 한국어다.
 */

/** 목록 한 번에 받는 건수. 서버 상한은 50, 기본은 20 이다. */
export const SCORECARD_REPORTS_PAGE_SIZE = 20;

/**
 * 서버 에러에서 화면에 띄울 문장을 뽑는다.
 *
 * WAS 의 `{ code, message }` 에서 message 는 한국어 완성 문장이라 그대로 쓴다.
 * 응답 자체가 없는 경우(네트워크 단절·타임아웃)의 axios `error.message` 는 영어라
 * 사용자에게 보여 주지 않고 호출부가 준 한국어 fallback 으로 대체한다.
 *
 * 구현은 의견보내기 쪽과 **같은 함수 하나**를 쓴다(머리말의 import 주석 참고).
 * 화면은 이 모듈에서만 가져다 쓰면 되도록 여기서 다시 내보낸다.
 */
export const readErrorMessage = readSuggestionErrorMessage;

/** 응답이 404 인지. 상세 화면이 「존재하지 않는 전송입니다」로 갈지 판단하는 데 쓴다. */
export const isNotFound = isNotFoundError;

/*
 * 날짜 포맷터도 같은 구현을 쓴다(timeZone 은 Asia/Seoul 고정).
 * 🔴 **여기서 Intl 인스턴스를 새로 만들지 마라** — 브라우저 로컬 타임존에 맡기거나 옵션이
 * 한 글자라도 갈리면, 같은 전송이 이 화면과 의견 화면에서 다른 시각으로 보인다.
 */

/** RFC3339 → '2026. 09. 03. 14:20' (KST). 값이 없거나 파싱 실패면 '-' */
export const formatDateTime = formatSuggestionDateTime;

/**
 * 기기 정보를 「아이폰 · iOS 18.2 · 앱 1.34.5」 꼴 조각들로 펼친다.
 *
 * 서버가 device 를 null 로 주거나 키를 빠뜨릴 수 있어(옛 앱) 빈 값은 떨어뜨린다.
 * 「알 수 없음」 같은 문구를 **여기서 지어내지 않는다** — 그 자리에 무엇을 세울지는
 * 화면이 정한다(§9 의 sourceName 과 같은 자세).
 *
 * @param {object|null} device
 * @returns {Array<{label: string, value: string}>}
 */
export function describeDevice(device) {
  if (!device) return [];
  return [
    { label: '플랫폼', value: device.platform },
    { label: 'OS', value: device.osVersion },
    { label: '앱', value: device.appVersion },
    { label: '기기', value: device.model },
  ].filter(
    (entry) => typeof entry.value === 'string' && entry.value.trim() !== ''
  );
}

/**
 * 자동 전송 목록.
 *
 * @param {object} options
 * @param {number} options.limit   서버 상한 50
 * @param {string} options.cursor  이전 응답의 nextCursor
 * @returns {Promise<{items: object[], nextCursor: string|null}>}
 */
export async function fetchScorecardReports({
  limit = SCORECARD_REPORTS_PAGE_SIZE,
  cursor,
} = {}) {
  const params = { limit };
  if (cursor) params.cursor = cursor;

  const response = await apiClient.get('/admin/scorecard-reports', { params });
  const body = response.data ?? {};

  // 응답이 비어도 화면이 깨지지 않도록 항상 같은 shape 을 돌려준다.
  return {
    items: Array.isArray(body.items) ? body.items : [],
    nextCursor: body.nextCursor ?? null,
  };
}

/**
 * 자동 전송 상세. **파일 주소(서명 URL)는 여기에만 있다.**
 * 주소가 짧게 살아 있으므로 호출부는 열기 직전에 다시 부른다(머리말 2번 🔴).
 */
export async function fetchScorecardReport(reportId) {
  const response = await apiClient.get(
    `/admin/scorecard-reports/${encodeURIComponent(reportId)}`
  );
  return response.data ?? null;
}

/**
 * 자동 전송 삭제. 204 라 돌려줄 본문이 없다.
 * 🔴 되돌릴 수 없다 — 호출부는 확인 단계를 거친 뒤에만 부른다.
 */
export async function deleteScorecardReport(reportId) {
  await apiClient.delete(
    `/admin/scorecard-reports/${encodeURIComponent(reportId)}`
  );
}

const scorecardReportService = {
  fetchScorecardReports,
  fetchScorecardReport,
  deleteScorecardReport,
};

export default scorecardReportService;
