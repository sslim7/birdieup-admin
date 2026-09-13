import apiClient from './apiClient';

/**
 * 장면(피드에 붙은 사진·영상) 위치·촬영일시 **손보정** API.
 *
 * 계약 정본은 `docs/admin-api.md` 의 장면 보정 절이다. 여기 주석과 문서가 어긋나면 문서가 맞다.
 *
 * # 왜 이런 API 가 있나 (읽는 사람이 "왜 이렇게 단순한가"를 알 수 있게)
 *
 * 예전 앱은 **사진**을 올릴 때 EXIF 를 떼고 저장했다. 그래서 옛 사진에는 좌표도 촬영일시도
 * 없고 되살릴 원본이 남아 있지 않다. 남은 방법은 사람이 사진을 보고 "여기였다"를 기억해
 * 찍어 넣는 것뿐이라, 이 API 와 이 API 를 쓰는 화면은 **한시적인 보정 도구다.**
 *
 * ⚠ **동영상은 예외다.** 재인코딩 없이 원본 그대로 올라가서 파일 안에 좌표가 그대로 남아 있다.
 *   그래서 `/admin/scenes/extract` 하나만큼은 "자동으로 찾기"가 가능하다(아래 참고). 그 밖에
 *   사진을 두고 좌표를 추론하는 장치는 얹지 마라 — 근거가 없는 값은 지도에 거짓을 심는다.
 *
 * # 엔드포인트
 *
 *   목록  GET  /admin/scenes/pending        [Bearer 필수 + isAdmin 전용. 비-admin 은 403]
 *
 *     쿼리(전부 선택):
 *       limit    기본 20, 최대 100
 *       cursor   서버가 준 불투명 문자열. 첫 장에서는 아예 보내지 않는다.
 *       missing  location | time | any | fixed   (기본 any)
 *                any=좌표 또는 촬영일이 없는 것 · location=좌표만 · time=촬영일만
 *                **fixed=사람이 어드민에서 찍어 넣은 좌표(locationSource="manual")만.**
 *                자동으로 잡힌 좌표는 여기 오지 않는다. 잘못 찍은 값을 되돌리는 통로다.
 *       q        **`sourceName`(골프장 이름 | 생활피드 제목) 부분 일치.** 대소문자를 가리지
 *                않는다 — 이름에 「하늘나라 CC」처럼 라틴 문자가 섞여 있어서다. 앞뒤 공백은
 *                서버가 떼고, 떼고 나서 비면 보내지 않은 것과 같다(100자를 넘으면 잘린다).
 *
 *     응답 200:
 *     {
 *       items: [
 *         {
 *           sourceType: "ROUND" | "LIFE",
 *           sourceId:   string,
 *           sourceName: string,     // 골프장 이름 등. **빈 문자열일 수 있다**(아래 참고)
 *           feedId:     string,
 *           storagePath:string,
 *           mediaKind:  "photo" | "video",
 *           thumbUrl:   string,
 *           url:        string,     // 원본. 화면에 크게 거는 것은 thumbUrl 이고, 이것은
 *                                   // 「원본 보기」로 새 탭에서만 연다(scene-fix-dialog 주석)
 *           authorName: string,
 *           uploadedAt: string,     // 올린 시각(RFC3339 UTC). 찍은 시각이 아니다
 *           hasLocation:boolean,
 *           hasTakenAt: boolean,
 *
 *           // ⚠ 아래는 **확정 전이다**(계약 §9.1 의 item 표에 아직 없다).
 *           //   missing=fixed 목록에서 "지금 들어 있는 값"을 보여 주고 폼에 채우려면
 *           //   값 자체가 내려와야 해서, 오면 쓰고 없으면 비워 두는 식으로만 읽는다.
 *           //   → readSceneCoords / readSceneTakenLocal. 필드 이름이 확정되면 그 둘만 고치면 된다.
 *           latitude?:  number,
 *           longitude?: number,
 *           takenLocal?:string          // 시간대 없는 벽시계. Date 로 파싱하지 마라
 *         }
 *       ],
 *       nextCursor?: string         // 더 훑을 것이 남았을 때만 온다(없으면 **키 자체가 빠진다**)
 *     }
 *
 *   저장  POST /admin/scenes/locate → 200 { ok: true }
 *
 *     body {
 *       sourceType, sourceId, feedId, storagePath,   // 네 개가 한 장면을 가리키는 열쇠다
 *       latitude?, longitude?,
 *       takenLocal?, utcOffsetMinutes?,           // ← 오프셋은 우리가 보내지 않는다(아래 주석)
 *       clearLocation?, clearTaken?
 *     }
 *
 *   추출  POST /admin/scenes/extract       [동영상 파일에서 좌표를 꺼내 채운다]
 *
 *     body {
 *       dryRun: boolean,      // 🔴 **생략하지 마라.** 서버는 생략을 true(안전)로 읽지만,
 *                             //    적용할 때는 false 를 명시해야 한다 — 아래 주의사항 참고
 *       limit?: number,       // **파일을 읽어 볼 동영상 수**다(기본 20, 최대 100)
 *       cursor?: string       // 목록(pending)과 **같은 커서**다. 첫 훑기에서는 보내지 않는다
 *     }
 *
 *     응답 200 {
 *       scanned:     number,  // 파일을 읽어 본 동영상 수(좌표를 찾았는지와 무관)
 *       found:       number,  // 좌표를 찾은 동영상 수 = items.length
 *       photosFilled:number,  // 좌표를 옮겨 적은(dryRun 이면 적었을) 사진 수
 *       applied:     boolean, // 🔴 **개수가 아니라 참/거짓이다.** dryRun 이면 false
 *       nextCursor?: string,
 *       items: [{ sourceType, sourceId, sourceName, feedId, storagePath,
 *                 latitude, longitude, takenLocal?, siblingPhotos: number }]
 *     }
 *
 *     ⚠ 이 절은 **`docs/admin-api.md` §9 에 아직 없다**(작성 시점의 §9 는 pending·locate 둘뿐).
 *       위 모양은 WAS 구현(`birdieup-was/internal/scenes/admin.go` 의 `adminExtractResponse`)을
 *       직접 읽어 맞춘 것이다. 문서에 절이 생기면 **문서가 정본이다.**
 *
 * # 주의할 점
 *
 * - **`sourceName` 은 빈 문자열일 수 있다.** 골프장을 적지 않고 연 라운드가 있다. 그때는
 *   이름 자리에 유형(「라운딩」/「생활피드」)만 세운다 — 빈 칸으로 두면 지워진 데이터로 보인다.
 * - 🔴 **`takenLocal` 은 시간대가 없는 현지 시각 문자열이다**(`"2026-09-05 14:32:10"`).
 *   `new Date()` 에 넣지 마라. 오프셋이 없는 문자열은 브라우저 시간대로 해석돼 값이 밀린다.
 *   문자열로만 다뤄야 한다 → `toTakenLocal`.
 * - 🔴 같은 이유로 `postService.toUtcFromKstInput` 을 여기에 끌어 쓰면 안 된다. 그쪽은
 *   KST 벽시계를 **UTC 순간**으로 옮기는 함수인데, 이 값은 옮길 대상이 아니라 사진에 적혀
 *   있었을 현지 시각 그 자체다. UTC 로 바꾸는 순간 뜻이 달라지고 되돌릴 수 없다.
 * - **장면에는 단일 id 가 없다.** 위 네 필드(sourceType·sourceId·feedId·storagePath)가
 *   한 벌로 한 장면을 가리킨다. 저장할 때 하나라도 빠뜨리면 엉뚱한 첨부가 고쳐진다.
 * - 🔴 **빈 페이지가 와도 끝이 아니다.** 이 조회는 색인을 타지 못해(배열 원소에는 색인이
 *   서지 않는다) 문서를 순서대로 훑고, 한 요청에 읽을 문서 수가 막혀 있다. 그래서 0건이
 *   돌아와도 `nextCursor` 가 있으면 뒤에 더 있다 — 화면은 그때 "없습니다" 로 끝맺으면 안 된다.
 *   보정이 끝나갈수록 빈 페이지가 늘어난다.
 * - `limit` 은 **상한이 아니라 목표다.** 한 글의 첨부를 쪼개지 않아서 마지막 글의 첨부 수만큼
 *   넘칠 수 있다. "정확히 이만큼 온다"고 읽지 마라.
 * - `thumbUrl` 은 썸네일이 없으면 원본 URL 이 들어온다. 빈 값일 때만 대체 아이콘을 세우면 된다.
 * - 🔴 **이름으로 거르는 일은 서버(`q`)가 한다. 받아 둔 목록을 화면에서 filter 하지 마라.**
 *   화면이 가진 것은 지금 받아 둔 한 장(20건)뿐이라, 뒤쪽 장에 있는 것을 「없다」고 말하게
 *   된다. 서버는 훑으면서 이미 원본 문서를 읽어 이름을 꺼내고 있어 그 자리에서 거르면 공짜다.
 *   ⚠ `q` 를 넣어도 **훑기 예산은 그대로다.** 검색어가 걸리는 것이 한 구간에 0건일 수 있고
 *   그것은 정상이다 — `nextCursor` 가 있으면 아직 끝이 아니다(바로 위 항목).
 * - **커서 페이지네이션이고 total 이 없다.** `nextCursor` 를 다음 요청에 그대로 실어 이어
 *   붙이는 방식만 가능하다(활동 로그만 page/total 이다 — 그쪽 코드를 베끼지 마라).
 *   커서는 `missing`·`q` 와 한 쌍이므로 **조건이 하나라도 바뀌면** 반드시 커서 없이 첫 장부터
 *   다시 받는다.
 * - 에러는 전부 `{ code, message }` 이고 `message` 는 화면에 그대로 띄워도 되는 한국어다
 *   → `readErrorMessage`.
 */

/** 목록 한 장의 크기. 서버 기본값과 같게 고정한다(페이지 크기 선택 UI 는 두지 않는다). */
export const PAGE_SIZE = 20;

/**
 * `missing` 필터가 받는 값.
 * 화면 세그먼트 라벨과 서버 쿼리 값을 한 곳에 묶어 둔다 — 라벨만 고치다가 서버에 없는
 * 값을 보내는 사고를 막는다.
 */
export const SCENE_MISSING = {
  ANY: 'any',
  LOCATION: 'location',
  TIME: 'time',
  /** 사람이 찍어 넣은 좌표만. 잘못 넣은 값을 다시 열어 고치거나 비우는 통로다. */
  FIXED: 'fixed',
};

/*
 * 🔴 **`utcOffsetMinutes` 를 보내지 않는다. 도로 채우지 마라.**
 *
 * 계약에 선택 필드로 있고(§9.2) KST 는 540 이라 "기본값으로 넣어 두면 편하지 않나" 싶지만,
 * 어드민이 손으로 적는 촬영시각은 **시간대를 모르는 값**이다. 해외에서 찍은 사진에 540 을
 * 붙이면 그 순간 아홉 시간 밀린 거짓이 되고, 서버는 보낸 오프셋을 그대로 갈아 끼우므로
 * 되돌릴 단서도 남지 않는다.
 *
 * 오프셋을 빼면 서버는 「시간대 미상」으로 두고 적힌 벽시계를 그대로 쓴다 — 그게 우리가 아는
 * 사실과 정확히 같다. 시간대를 **실제로 아는** 경로가 생기면(EXIF 를 읽는 업로드 경로 같은)
 * 그때 그쪽에서 보내면 된다. 여기서는 아니다.
 */

/** 좌표 허용 범위. 서버도 같은 범위로 막지만, 눌러 보고 400 을 받는 것보다 미리 잠그는 편이 낫다. */
export const LATITUDE_RANGE = [-90, 90];
export const LONGITUDE_RANGE = [-180, 180];

/**
 * 서버 에러에서 화면에 띄울 문장을 뽑는다.
 *
 * WAS 는 `{ code, message }` 로만 실패를 알리고 `message` 가 이미 한국어 완성 문장이라
 * 그대로 쓴다(문구를 두 군데서 관리하면 반드시 어긋난다). 네트워크가 끊겨 응답 자체가
 * 없을 때만 호출부가 준 fallback 으로 떨어진다.
 */
export function readErrorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

/** 값이 비어 있으면(undefined/null/'') 쿼리에서 제외한다 */
function compactParams(params) {
  const query = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    query[key] = typeof value === 'string' ? value.trim() : value;
  });
  return query;
}

/**
 * 한 장면을 가리키는 열쇠 문자열. 목록 행의 React key 로 쓴다.
 *
 * 서버가 장면 단위 id 를 주지 않으므로(같은 피드에 첨부가 여럿이다) 네 필드를 이어 붙인
 * 값이 유일한 식별자다. 인덱스를 key 로 쓰면 「더 보기」로 이어 붙일 때 행이 뒤섞인다.
 */
export function sceneKey(scene) {
  if (!scene) return '';
  return [scene.sourceType, scene.sourceId, scene.feedId, scene.storagePath].join('|');
}

/**
 * sourceType 표기. 계약이 정한 값이 둘뿐이라 표로 둔다.
 * 모르는 값이 오면 그대로 노출하지 않고 아래 sceneTitle 이 대체 문구를 세운다.
 */
export const SOURCE_TYPE_LABEL = {
  ROUND: '라운딩',
  LIFE: '생활피드',
};

/**
 * 장면을 부르는 이름.
 *
 * `sourceName` 은 **빈 문자열일 수 있다**(골프장을 적지 않고 연 라운드). 그때 빈 칸을 그대로
 * 두면 데이터가 지워진 것처럼 보이므로 유형만이라도 세운다. 이 규칙을 화면 여러 곳에
 * 흩뜨리지 않으려고 계약 주석 옆에 둔다.
 */
export function sceneTitle(scene) {
  const name = String(scene?.sourceName ?? '').trim();
  if (name) return name;
  return SOURCE_TYPE_LABEL[scene?.sourceType] ?? '알 수 없는 원본';
}

/**
 * `<input type="datetime-local">` 값 → 서버가 받는 `takenLocal`("YYYY-MM-DD HH:mm:ss").
 *
 * 🔴 **Date 를 거치지 않는다.** 입력값("2026-09-05T14:32")에는 오프셋이 없어서
 *    `new Date(...)` 에 넣는 순간 브라우저 시간대로 해석되고, 그 결과를 다시 문자열로
 *    만들면 값이 몇 시간씩 밀린다. 우리가 보내야 하는 것은 "사진에 적혀 있었을 벽시계"
 *    그대로이므로, 여기서는 글자만 옮기고 초만 채운다.
 *
 * 형식이 어긋나거나 비어 있으면 null 을 돌려준다. 호출부는 그 상태로 저장을 잠가야 한다.
 */
export function toTakenLocal(inputValue) {
  if (!inputValue) return null;
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(String(inputValue).trim());
  if (!matched) return null;
  const [, date, hourMinute, second] = matched;
  // datetime-local 은 브라우저·설정에 따라 초를 붙이기도, 빼기도 한다. 서버 형식에 맞춰 채운다.
  return `${date} ${hourMinute}:${second ?? '00'}`;
}

/**
 * 서버가 준 `takenLocal`("YYYY-MM-DD HH:mm:ss") → `<input type="datetime-local">` 값.
 *
 * `toTakenLocal` 의 반대 방향이고, 역시 **Date 를 거치지 않는다.** 이 값에는 시간대가 없어서
 * Date 로 만드는 순간 브라우저 시간대의 어떤 순간으로 굳어 버리고, 다시 문자열로 펴면 값이
 * 밀린다. 공백을 'T' 로 바꾸는 것이 전부다.
 *
 * 🔴 같은 이유로 이 값에 `formatKstDateTime` 을 쓰면 안 된다. 그쪽은 UTC 순간을 KST 로
 *    옮기는 함수이고, 이 값은 옮길 대상이 아니라 이미 적혀 있는 벽시계다.
 */
export function toTakenInputValue(takenLocal) {
  if (!takenLocal) return '';
  const matched = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(String(takenLocal).trim());
  if (!matched) return '';
  return `${matched[1]}T${matched[2]}`;
}

/**
 * 목록 item 에 실려 온 **지금 좌표**. 없으면 null.
 *
 * ⚠ 이 필드들은 계약 §9.1 의 item 표에 아직 없다(파일 머리 주석 참고). `missing=fixed`
 *   목록에서 "지금 값"을 보여 주려면 필요한 값이라, **오면 쓰고 없으면 조용히 비워 둔다.**
 *   없다고 화면이 망가지면 안 된다 — 값을 못 읽어도 비우기·다시 찍기는 그대로 되어야 한다.
 *   필드 이름이 계약에서 확정되면 고칠 자리는 이 함수 하나다.
 */
export function readSceneCoords(scene) {
  const latitude = Number(scene?.latitude);
  const longitude = Number(scene?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

/** 목록 item 에 실려 온 **지금 촬영일시**(시간대 없는 벽시계). 없으면 null. 위 주의사항이 그대로 적용된다. */
export function readSceneTakenLocal(scene) {
  const value = String(scene?.takenLocal ?? '').trim();
  return value === '' ? null : value;
}

/**
 * `uploadedAt`(RFC3339 UTC) → 표에 찍을 KST 문구.
 *
 * 브라우저 시간대를 따라가면 운영자가 보는 시각과 어긋나므로 Asia/Seoul 로 고정한다.
 * 오프셋이 없는 값이 섞여 오면 로컬 시각으로 조용히 잘못 파싱되므로, 계약대로 UTC 로 보고
 * 'Z' 를 붙여 읽는다.
 */
export function formatKstDateTime(value) {
  if (!value) return '-';
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasOffset ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace('T', ' ');
}

/**
 * 보정이 필요한 장면 한 장. `cursor` 가 없으면 첫 장이다.
 *
 * `cursor` 를 빈 문자열로 실어 보내면 서버가 커서 파싱을 시도하다 400 을 줄 수 있어
 * 아예 뺀다(compactParams 가 그 일을 한다). `q` 도 같은 이유로 빈 값이면 빠진다 — 검색칸을
 * 지웠을 때 `q=` 가 실려 가면 뜻이 "검색어 없음"이 아닌 것으로 읽힐 여지를 아예 없앤다
 * (서버는 공백을 떼고 비면 거르지 않지만, 계약의 관대함에 기대지 않는다).
 *
 * `q` 는 **골프장 이름 · 생활피드 제목 부분 일치**다. 🔴 `missing` 과 마찬가지로 커서와 한
 * 쌍이므로, 검색어가 바뀌면 커서 없이 첫 장부터 다시 받아야 한다.
 *
 * 응답이 어떤 이유로든 비정상이어도 화면이 깨지지 않도록 항상 `{ items, nextCursor }` 를
 * 돌려준다. `nextCursor` 는 서버가 만든 불투명 문자열이니 파싱하거나 만들어내지 마라.
 */
export async function fetchPendingScenes({ limit = PAGE_SIZE, cursor, missing, q } = {}) {
  const params = compactParams({ limit, cursor, missing, q });
  const { data } = await apiClient.get('/admin/scenes/pending', { params });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    nextCursor: data?.nextCursor ?? null,
  };
}

/**
 * 좌표·촬영일시를 넣거나 지운다.
 *
 * 한 번의 호출이 넣기와 지우기를 겸한다. 보낼 것만 골라 싣는 이유:
 * - **좌표는 위·경도가 한 벌이다.** 한쪽만 보내면 반쪽짜리 좌표가 저장되거나 400 이 난다.
 *   그래서 둘 다 숫자일 때만 싣는다.
 * - `takenLocal` 만 싣고 **오프셋은 싣지 않는다**(위 utcOffsetMinutes 주석).
 * - **넣기와 지우기를 한 요청에 함께 보내면 400 이다.** 그래서 지우기는 별도 호출로 간다.
 * - `clearLocation` / `clearTaken` 은 **각각 따로** 지운다. 잘못 찍어 넣은 값을 되돌릴 길이
 *   없으면 손으로 채우는 도구 자체가 위험해진다.
 */
export async function saveSceneLocation({
  sourceType,
  sourceId,
  feedId,
  storagePath,
  latitude,
  longitude,
  takenLocal,
  clearLocation,
  clearTaken,
}) {
  const body = { sourceType, sourceId, feedId, storagePath };

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    body.latitude = latitude;
    body.longitude = longitude;
  }
  // 🔴 `utcOffsetMinutes` 는 일부러 싣지 않는다(위 주석). 시간대를 모르는 값에 오프셋을
  //    붙이면 해외에서 찍은 사진이 조용히 밀린다.
  if (takenLocal) body.takenLocal = takenLocal;
  if (clearLocation) body.clearLocation = true;
  if (clearTaken) body.clearTaken = true;

  const { data } = await apiClient.post('/admin/scenes/locate', body);
  return data ?? {};
}

/**
 * 동영상 파일에서 좌표를 꺼내 채운다.
 *
 * # 왜 이것만은 자동으로 되는가 (이 함수가 값진 이유)
 *
 * 옛 **사진**은 업로드할 때 재인코딩되며 EXIF 가 통째로 떨어져 나갔다 — 원본에도 남아 있지
 * 않아 되살릴 방법이 없다. 그런데 **동영상은 손대지 않고 원본 그대로 올라간다.** 파일 안
 * 컨테이너 메타데이터에 촬영 좌표가 그대로 살아 있고, 서버가 그것을 읽어 낼 수 있다.
 *
 * 게다가 **같은 글에 올린 첨부는 같은 순간·같은 자리의 것이다.** 동영상에서 꺼낸 좌표를 옆
 * 사진에 옮겨 적는 것은 몇 해 지난 뒤의 사람 기억보다 정확하고, 손으로 찍어야 할 장면 수를
 * 한 건이 아니라 **글 단위로** 줄인다(`items[].siblingPhotos` 가 그 수다).
 *
 * # dryRun
 *
 * 🔴 **`dryRun` 은 언제나 명시해서 보낸다.** 서버가 생략을 true(안전)로 읽더라도, 적용하는
 *    쪽에서 "안 보내면 안전하겠지"에 기대면 실수 한 번이 되돌리기 어려운 쓰기가 된다.
 *    화면은 반드시 true 로 먼저 훑어 보여 주고, 사람이 승인한 뒤에만 false 로 부른다.
 *
 * 🔴 **`cursor` 는 훑은 구간을 가리킨다.** 미리보기에서 본 것을 그대로 적용하려면 적용 호출도
 *    **같은 커서**로 불러 같은 구간을 다시 지나야 한다. 커서를 빼고 적용하면 처음부터 다시
 *    훑어서, 미리 보여 준 것과 실제로 채운 것이 어긋난다.
 *
 * 응답이 비정상이어도 화면이 깨지지 않도록 숫자는 0, items 는 빈 배열로 메워 돌려준다.
 */
export async function extractSceneLocations({ dryRun, limit, cursor } = {}) {
  // limit 은 보통 비워 둔다 — 서버 기본값(20)에 양쪽 다 맡겨야 미리보기와 적용이 **같은 크기의
  // 구간**을 본다. 한쪽만 값을 실으면 보여 준 것과 채운 것이 어긋난다.
  const body = { dryRun: dryRun === true };
  if (Number.isFinite(limit)) body.limit = limit;
  if (cursor) body.cursor = cursor;

  const { data } = await apiClient.post('/admin/scenes/extract', body);
  return {
    scanned: Number(data?.scanned) || 0,
    found: Number(data?.found) || 0,
    photosFilled: Number(data?.photosFilled) || 0,
    // 🔴 개수가 아니라 **참/거짓**이다(실제로 썼는지). 개수로 읽으면 화면이 "0건 채웠다"고 말한다.
    applied: data?.applied === true,
    nextCursor: data?.nextCursor ?? null,
    items: Array.isArray(data?.items) ? data.items : [],
  };
}

const sceneService = {
  PAGE_SIZE,
  SCENE_MISSING,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  readErrorMessage,
  sceneKey,
  SOURCE_TYPE_LABEL,
  sceneTitle,
  toTakenLocal,
  toTakenInputValue,
  readSceneCoords,
  readSceneTakenLocal,
  formatKstDateTime,
  fetchPendingScenes,
  saveSceneLocation,
  extractSceneLocations,
};

export default sceneService;
