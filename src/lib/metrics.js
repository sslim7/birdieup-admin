/**
 * 지표 대시보드(홈)가 쓰는 순수 계산 헬퍼.
 *
 * 화면 코드에서 떼어 둔 이유는 하나다 — **"0" 과 "값이 없음" 을 구분하는 규칙**이
 * 표·차트·CSV 세 군데에 흩어지면 반드시 한 군데가 어긋나기 때문이다.
 * 그 규칙을 여기 한곳에 모아 두고, 세 곳이 전부 이 함수들만 거치게 한다.
 *
 * 값이 없다는 것은 이 화면에서 서로 다른 세 가지 사건이다(docs/admin-api.md §8):
 *   - **집계 중(pending)**: 아직 집계될 시각이 오지 않은 날. 오늘, 그리고 04:00 전이면 어제까지.
 *   - **데이터 없음(missing)**: 집계 시각이 지났는데도 롤업 문서가 없는 날.
 *     배치 실패나 서비스 이전의 날이 여기 걸린다.
 *   - **누계 끊김(cumulativeGap)**: 그날 누계를 전날에서 이어받지 못한 날.
 *     그날의 증분은 유효하고 `cumulative` 만 못 믿는다.
 * 전부 숫자가 아니라 `null` 로 만들어 화면이 `—` 를 찍고 추이 선을 끊게 한다.
 *
 * 🔴 pending 과 missing 을 뭉개면 **배치가 죽어도 화면이 "집계 중"이라고 안심시킨다.**
 * 그래서 판정 기준을 서버가 어디까지 접었는지(rollup.date)가 아니라 **시계**로 잡는다.
 */

/** 지표의 하루는 KST 기준이다. 서버(§8)도, 활동 로그(§5)도 같은 기준을 쓴다. */
const KST_TIME_ZONE = 'Asia/Seoul';

/**
 * 롤업 배치가 도는 시각(KST). 그날 04:00 에 **전날치**를 접는다.
 *
 * 이 숫자는 인프라에 묶여 있다 — birdieup-terraform `production/scheduler.tf` 의
 * `google_cloud_scheduler_job.metrics_rollup` 이 `schedule = "0 4 * * *"` /
 * `time_zone = "Asia/Seoul"` 로 걸려 있다. **스케줄을 바꾸면 여기도 같이 바꿔야 한다.**
 * 안 바꾸면 화면이 "집계 중"과 "데이터 없음"을 반대로 말한다.
 */
const ROLLUP_HOUR_KST = 4;

/**
 * 배치가 끝나기를 기다려 주는 여유(분).
 *
 * 04:00 은 잡이 **시작**하는 시각이지 끝나는 시각이 아니다. 여유가 없으면 04:00 정각부터
 * 집계가 끝나기 전까지 어제가 「데이터 없음」으로 보인다 — 배치는 멀쩡히 도는 중인데
 * 화면만 실패라고 말하는 오탐이다.
 *
 * 30분은 실제 소요시간이 아니라 **상한**에서 왔다. Cloud Run 의 요청 타임아웃이 60초라
 * 잡 한 번은 아무리 늦어도 60초에 끊기고, 스케줄러가 세 번까지 재시도한다
 * (birdieup-terraform `production/scheduler.tf`). 디스패치 지터를 얹어도 몇 분이면 끝난다.
 * 넉넉히 잡는 쪽이 안전하다 — 이 여유가 늦추는 것은 「배치가 죽었다」는 신고뿐이고,
 * 그 신고가 30분 늦는 대가는 매일 아침 오탐 한 번보다 싸다.
 */
const ROLLUP_GRACE_MINUTES = 30;

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
 * 지금(KST)의 날짜와 시(0~23).
 *
 * 문자열을 잘라 쓰지 않고 formatToParts 로 꺼낸다 — 로케일이 끼워 넣는 구분자는
 * 엔진마다 달라서 자릿수로 자르면 언젠가 조용히 어긋난다.
 */
const KST_DATE_HOUR_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function nowKst(now = new Date()) {
  const parts = Object.fromEntries(
    KST_DATE_HOUR_FORMAT.formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
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
 * 날짜 D 의 집계가 끝났어야 하는 경계 날짜를 돌려준다.
 *
 * 배치는 매일 04:00(KST)에 **전날치**를 접으므로 날짜 D 의 집계 시각은 `D+1일 04:00 KST` 다.
 * 지금이 04:00 을 지났으면 어제까지, 아직이면 그저께까지가 "이미 나왔어야 하는" 날이다.
 *
 * 이 경계를 rollup.date 대신 쓴다. rollup.date 로 판정하면 배치가 사흘 멈췄을 때
 * 그 사흘이 전부 "집계 중"으로 보여서, **배치가 죽었다는 사실이 화면 어디에도 안 나타난다.**
 */
export function lastAggregatedDateKst(now = new Date()) {
  const { date, hour, minute } = nowKst(now);
  // 04:00 은 시작 시각이라 여유를 더해 "끝났을 시각" 으로 본다(ROLLUP_GRACE_MINUTES).
  const rolledUp = hour * 60 + minute >= ROLLUP_HOUR_KST * 60 + ROLLUP_GRACE_MINUTES;
  return shiftDate(date, rolledUp ? -1 : -2);
}

/**
 * 응답의 days 에 "이 날을 어떻게 그려야 하는가"를 붙인다.
 *
 * 서버가 값을 준 날(`missing !== true`)은 그대로 쓴다. 값이 없는 날만 둘로 가른다 —
 * 집계 시각이 아직 안 온 날은 `pending`, 지났는데도 비어 있으면 진짜 `missing` 이다.
 * (rollup.date 는 이 판정에 쓰지 않는다. 화면 머리말·카드의 기준 표기용으로만 남았다.)
 */
export function decorateDays(days) {
  const boundary = lastAggregatedDateKst();

  return (days ?? []).map((day) => {
    const date = String(day?.date ?? '');
    const empty = day?.missing === true;
    const pending = empty && date > boundary;

    return {
      ...day,
      date,
      // 집계 시각이 지났는데도 비어 있는 날. 배치 실패거나 서비스 이전의 날이다.
      missing: empty && !pending,
      pending,
      // 누계만 못 믿는 날. 증분은 유효하므로 usable 을 내리지 않는다.
      cumulativeGap: day?.cumulativeGap === true,
      // 숫자를 꺼내도 되는 날인가. 이 플래그 하나로 표·차트·CSV 가 같은 판단을 한다.
      usable: !empty,
    };
  });
}

/**
 * 하루에서 지표 하나를 꺼낸다. 꺼낼 수 없으면 null.
 *
 * 백필로 채운 날은 방문 계측(daily_actives)이 없어 `active.viewersMissing: true` 가 오고,
 * 그때는 viewers* 세 개만 값이 없다(같은 날의 contributors 는 유효하다).
 * 서버는 그 셋을 **항상 0 으로 실어 보내므로**(§8.3) 이 관문을 안 거치면 0 이 그대로 그려진다.
 *
 * `cumulativeGap: true` 인 날은 누계를 전날에서 이어받지 못해 실제보다 훨씬 작다.
 * 그 날의 `cumulative` 만 버린다 — 같은 날의 증분(신규 가입·라운드·피드…)은 유효하다.
 */
export function metricValue(day, group, key) {
  if (!day?.usable) return null;
  if (group === 'active' && key.startsWith('viewers') && day.active?.viewersMissing) return null;
  if (group === 'cumulative' && day.cumulativeGap) return null;

  const raw = day[group]?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * 요약(summary)의 활동회원 숫자를 믿어도 되는가.
 *
 * `rollup.date` 가 방문 계측 시작 이전이면 `activeUsers.viewersMissing: true` 가 오는데,
 * 그때도 `dau`/`wau`/`mau` 는 **0 으로 실려 온다**(서버가 omitempty 를 안 쓴다 — 계측 이후
 * 진짜로 아무도 안 온 날의 0 을 지우지 않기 위해서다). 그 0 을 그대로 그리면
 * 배포 다음 날 아침 카드가 "0 / DAU 0 · WAU 0" 으로 뜬다. 카드는 반드시 이 함수를 거친다.
 *
 * 같은 날의 `contributors` 는 유효하다(쓰기 기록은 뒤늦게도 셀 수 있다). 함께 지우지 마라.
 */
export function summaryViewersUsable(rollup) {
  return Boolean(rollup) && rollup.activeUsers?.viewersMissing !== true;
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
