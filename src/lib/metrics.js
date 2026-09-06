/**
 * 지표 대시보드(홈)가 쓰는 순수 계산 헬퍼.
 *
 * 화면 코드에서 떼어 둔 이유는 하나다 — **"0" 과 "값이 없음" 을 구분하는 규칙**이
 * 표·차트·CSV 세 군데에 흩어지면 반드시 한 군데가 어긋나기 때문이다.
 * 그 규칙을 여기 한곳에 모아 두고, 세 곳이 전부 이 함수들만 거치게 한다.
 *
 * 값이 없다는 것은 이 화면에서 두 가지 서로 다른 사건이다(docs/admin-api.md §8):
 *   - **집계 중(pending)**: 아직 롤업이 돌지 않은 날. 대개 오늘.
 *   - **데이터 없음(missing)**: 롤업 문서가 없는 날. 배치 실패나 서비스 이전의 날.
 * 둘 다 숫자가 아니라 `null` 로 만들어 화면이 `—` 를 찍고 추이 선을 끊게 한다.
 */

/** 지표의 하루는 KST 기준이다. 서버(§8)도, 활동 로그(§5)도 같은 기준을 쓴다. */
const KST_TIME_ZONE = 'Asia/Seoul';

/**
 * 'YYYY-MM-DD' 포맷터.
 * 로케일 'sv-SE' 는 ISO 와 같은 표기를 내놓는다(AuditLogs.jsx 가 쓰는 것과 같은 수법).
 */
const KST_DATE_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 오늘(KST) 날짜를 'YYYY-MM-DD' 로 돌려준다. */
export function todayKst() {
  return KST_DATE_FORMAT.format(new Date());
}

/**
 * 'YYYY-MM-DD' 에 일수를 더한다(음수면 뺀다).
 *
 * 문자열을 UTC 자정으로 파싱해서 계산한다. 로컬 타임존으로 파싱하면 브라우저가
 * 어디에 있느냐에 따라 하루가 밀린다 — 날짜만 다루는 값이라 타임존을 태우면 안 된다.
 */
export function shiftDate(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * "최근 N일" 구간을 만든다. 오늘을 포함하므로 dateFrom 은 N-1 일 전이다.
 *
 * 오늘을 일부러 포함시킨다. 오늘 칸이 "집계 중"으로 비어 있는 것을 보여 주는 편이,
 * 구간에서 빼 버려 운영자가 "왜 어제까지밖에 없지" 하고 헤매는 것보다 낫다.
 */
export function presetRange(days) {
  const dateTo = todayKst();
  return { dateFrom: shiftDate(dateTo, -(days - 1)), dateTo };
}

/**
 * RFC3339 timestamp 를 KST 'YYYY-MM-DD HH:mm' 으로 표기한다.
 *
 * 계약상 모든 timestamp 는 UTC 문자열이라 브라우저 타임존을 따라가면 어긋난다.
 * 오프셋이 없는 값이 섞여 들어오면 로컬 시각으로 해석되어 조용히 틀리므로 'Z' 를 붙인다.
 * (AuditLogs.jsx 에 초 단위까지 찍는 같은 로직이 있다. 이쪽은 분까지만 쓴다.)
 */
export function formatKstDateTime(value) {
  if (!value) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasOffset ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace('T', ' ');
}

/** 'YYYY-MM-DD' 를 'M/D' 로 줄인다(축 라벨용). */
export function shortDateLabel(date) {
  const [, month, day] = String(date).split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : String(date);
}

/**
 * 숫자를 천 단위로 끊어 표기한다. 값이 없으면(null/undefined) EM DASH.
 * **0 은 그대로 '0' 이다.** 0 과 '없음' 을 같은 글자로 찍으면 이 화면의 존재 이유가 사라진다.
 */
export const NO_VALUE = '—';

export function formatCount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_VALUE;
  return Number(value).toLocaleString('ko-KR');
}

/** 증감 표기('+37' / '-4' / '—'). 0 은 '0'. */
export function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return NO_VALUE;
  const sign = value > 0 ? '+' : '';
  return `${sign}${Number(value).toLocaleString('ko-KR')}`;
}

/**
 * 응답의 days 에 "이 날을 어떻게 그려야 하는가"를 붙인다.
 *
 * pending 판정은 **rollup.date 를 기준으로 한다** — 서버가 어디까지 접었는지는 서버만 안다.
 * 그날 이후는 아직 집계 전이므로, 값이 딸려 오더라도 반쪽짜리라서 쓰지 않는다.
 * rollup 자체가 없으면(첫 배치 전) 오늘 이후를 집계 전으로 본다.
 */
export function decorateDays(days, { rollupDate }) {
  const today = todayKst();

  return (days ?? []).map((day) => {
    const date = String(day?.date ?? '');
    const pending = rollupDate ? date > rollupDate : date >= today;

    return {
      ...day,
      date,
      // 서버가 명시적으로 missing 을 준 날 + 우리가 아직 집계 전으로 판정한 날
      missing: Boolean(day?.missing),
      pending,
      // 숫자를 꺼내도 되는 날인가. 이 플래그 하나로 표·차트·CSV 가 같은 판단을 한다.
      usable: !day?.missing && !pending,
    };
  });
}

/**
 * 하루에서 지표 하나를 꺼낸다. 꺼낼 수 없으면 null.
 *
 * 백필로 채운 날은 방문 계측(daily_actives)이 없어 `active.viewersMissing: true` 가 오고,
 * 그때는 viewers* 세 개만 값이 없다(같은 날의 contributors 는 유효하다).
 */
export function metricValue(day, group, key) {
  if (!day?.usable) return null;
  if (group === 'active' && key.startsWith('viewers') && day.active?.viewersMissing) return null;

  const raw = day[group]?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * 기간 합계. 값이 있는 날이 하나도 없으면 **0 이 아니라 null** 을 돌려준다.
 * "합이 0" 과 "더할 것이 없었다" 는 다른 말이다.
 */
export function sumMetric(days, group, key) {
  let total = 0;
  let seen = false;
  days.forEach((day) => {
    const value = metricValue(day, group, key);
    if (value === null) return;
    total += value;
    seen = true;
  });
  return seen ? total : null;
}

/**
 * 라운드 내기 방식 합계. byBetType 은 키가 늘어날 수 있으므로(§8) 알려진 4종을 먼저 놓고
 * 모르는 키는 뒤에 이름 그대로 붙인다 — 새 방식이 생겨도 화면이 조용히 누락시키지 않는다.
 */
const BET_TYPE_LABELS = {
  stroke: '스트로크',
  holecost: '홀당',
  friendly: '친선',
  skins: '스킨스',
};

export function sumBetTypes(days) {
  const totals = new Map(Object.keys(BET_TYPE_LABELS).map((key) => [key, 0]));
  let seen = false;

  days.forEach((day) => {
    if (!day?.usable) return;
    const byBetType = day.rounds?.byBetType;
    if (!byBetType || typeof byBetType !== 'object') return;
    Object.entries(byBetType).forEach(([key, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      totals.set(key, (totals.get(key) ?? 0) + value);
      seen = true;
    });
  });

  if (!seen) return null;
  return Array.from(totals, ([key, value]) => ({
    key,
    label: BET_TYPE_LABELS[key] ?? key,
    value,
  }));
}

/**
 * CSV 문자열을 만든다.
 *
 * 값이 없는 칸은 **빈 칸**이다. 표에서는 `—` 로 보여 주지만 CSV 에 그 글자를 넣으면
 * 스프레드시트에서 숫자 열이 텍스트로 굳는다. 대신 '상태' 열에 왜 비었는지를 적는다.
 */
export function buildCsv({ columns, days }) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = ['날짜', '상태', ...columns.map((column) => column.label)];
  const rows = days.map((day) => [
    day.date,
    day.pending ? '집계 중' : day.missing ? '데이터 없음' : '',
    ...columns.map((column) => {
      const value = metricValue(day, column.group, column.key);
      return value === null ? '' : value;
    }),
  ]);

  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}

/**
 * CSV 를 파일로 내려받는다.
 *
 * 앞에 BOM 을 붙인다 — 안 붙이면 엑셀이 UTF-8 로 못 읽어 한글 헤더가 깨진다.
 */
export function downloadCsv(filename, csv) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
