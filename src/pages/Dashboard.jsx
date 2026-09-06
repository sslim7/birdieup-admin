import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, Lock, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { canAccessItem, canAccessMetrics, flattenEntries, navigation } from '@/config/navigation';
import {
  NO_VALUE,
  buildCsv,
  decorateDays,
  downloadCsv,
  formatCount,
  formatDelta,
  formatKstDateTime,
  metricValue,
  presetRange,
  shortDateLabel,
  sumBetTypes,
  sumMetric,
  summaryViewersUsable,
} from '@/lib/metrics';
import { fetchDailyMetrics, fetchMetricsSummary } from '@/services/metricsService';
import { getAdminClaims } from '@/utils/auth';

/**
 * 홈 = 지표 대시보드.
 *
 * 예전 홈은 업무 메뉴로 가는 바로가기 카드 격자였는데, 그건 사이드바가 이미 하는 일이라
 * 걷어냈다. 그 자리에 (그때는 집계 API 가 없어 못 넣었던) 지표를 넣는다.
 *
 * 🔴 이 화면이 목숨 걸고 지켜야 하는 것은 **"0" 과 "아직 없음" 을 구분하는 것**이다.
 * 전부 다른 사건이고 화면에서 다르게 보여야 한다:
 *   - 값이 0        → '0'
 *   - 집계 전       → '집계 중' 배지 + `—`, 추이 선은 끊는다
 *   - 데이터 없음   → '데이터 없음' 배지 + `—`, 추이 선은 끊는다 (배치가 죽은 신호다)
 *   - 누계 끊김     → '누계 끊김' 배지. 누적선만 끊고 그날 증분은 그대로 그린다
 * 오늘을 0 으로 그리는 순간 운영자는 "오늘 서비스가 죽었다"고 읽는다. 이 화면에서 가장
 * 흔한 사고다. **판정 규칙은 전부 src/lib/metrics.js 에 모여 있다 — 여기에 다시 쓰지 마라.**
 *
 * 권한: 메뉴에는 permission 이 없다(홈이 막히면 라우트 가드가 무한 루프가 된다).
 * 대신 지표 API 가 `metrics` 권한으로 막히고, 403 이면 안내 + 접근 가능한 메뉴 목록을 보여준다.
 * 계약은 docs/admin-api.md §8.
 */

/** 기간 프리셋. '직접 입력'은 커스텀 날짜 두 칸을 연다. */
const PRESETS = [
  { key: '7', label: '7일', days: 7 },
  { key: '30', label: '30일', days: 30 },
  { key: '90', label: '90일', days: 90 },
];

/**
 * 차트 계열 색.
 *
 * globals.css 의 --chart-1..5 를 쓰지 않는다. 그 토큰은 birdieup-app 의 브랜드 팔레트를
 * 그대로 이식한 것이라 차트용으로 만들어진 값이 아니다 — 종이색 카드(#FBF9F3) 위에서
 * 라임(#C8E85F)이 대비 1.3:1 로 사실상 안 보이고, 5개 중 3개가 채도가 낮아 회색으로 읽히며,
 * 진초록과 슬레이트그린은 색각 이상에서 구분되지 않는다(ΔE 3.2).
 * 그래서 이 화면에서만 쓰는 계열색을 따로 둔다. 이 순서 그대로 슬롯을 배정하고 돌려쓰지 않는다.
 * (인접쌍 기준 색각 ΔE ≥ 11.6 / 정상시야 ΔE ≥ 20.2 를 만족하는 조합이다.)
 */
const SERIES = ['#2E8B5E', '#C79A2E', '#3C7FB1', '#C24A38', '#8A5CBF'];

/**
 * 도넛 전용 색 순서.
 *
 * 도넛은 첫 조각과 마지막 조각이 맞닿는다. SERIES 순서 그대로 4조각을 쓰면 맞닿는
 * 빨강↔초록이 색각 이상에서 구분되지 않아(ΔE 5.9), 그 쌍이 이웃하지 않도록 파랑을 뒤로 뺐다.
 */
const DONUT_COLORS = [SERIES[0], SERIES[1], SERIES[3], SERIES[4], SERIES[2]];

/** 축·격자처럼 뒤로 물러나 있어야 하는 것들 */
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 };

/** ② 일별 추이 토글. bar 는 그날 신규, line 은 같은 지표의 누적이다. */
const TREND_METRICS = [
  { key: 'users', label: '회원', group: 'users', field: 'new', cumulative: 'users' },
  { key: 'rounds', label: '라운딩', group: 'rounds', field: 'started', cumulative: 'rounds' },
  { key: 'feeds', label: '피드', group: 'feeds', field: 'created', cumulative: 'feeds' },
  { key: 'friends', label: '프렌즈', group: 'friends', field: 'new', cumulative: 'friends' },
];

/** ③ 좌: 피드 유형 스택. 계약의 feeds 내역 중 화면에 쓰는 5종. */
const FEED_TYPES = [
  { key: 'photos', label: '사진' },
  { key: 'videos', label: '동영상' },
  { key: 'messages', label: '피드말' },
  { key: 'emoticons', label: '이모티콘' },
  { key: 'system', label: '시스템' },
];

/** ④ 일자별 표 = CSV 내보내기의 열 정의. 표와 CSV 가 어긋나지 않도록 한 곳에서 온다. */
const TABLE_COLUMNS = [
  { label: '신규 회원', group: 'users', key: 'new' },
  { label: '탈퇴', group: 'users', key: 'withdrawn' },
  { label: 'DAU', group: 'active', key: 'viewersDau' },
  { label: '기여자', group: 'active', key: 'contributors' },
  { label: '프렌즈 신규', group: 'friends', key: 'new' },
  { label: '라운드 시작', group: 'rounds', key: 'started' },
  { label: '라운드 종료', group: 'rounds', key: 'ended' },
  { label: '피드', group: 'feeds', key: 'created' },
  { label: '사진', group: 'feeds', key: 'photos' },
  { label: '동영상', group: 'feeds', key: 'videos' },
  { label: '리액션', group: 'reactions', key: 'created' },
];

/**
 * axios 에러에서 화면에 띄울 문구를 고른다.
 * 서버 에러는 { code, message, details? } 이고 message 가 그대로 쓸 수 있는 한국어다.
 */
function readErrorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

/** 권한 없음(403)인가. 401 은 apiClient 인터셉터가 로그인으로 보내므로 여기서 볼 일이 없다. */
function isForbidden(error) {
  return error?.response?.status === 403;
}

/* ------------------------------------------------------------------ 조각들 */

/** 차트 툴팁. '집계 중' / '데이터 없음' 을 숫자 자리에 그대로 말로 적는다. */
function ChartTooltip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};

  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold text-popover-foreground">{row.date ?? label}</p>
      {row.pending || row.missing ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {row.pending ? '아직 집계 전입니다' : '데이터가 없는 날입니다 (집계가 밀렸습니다)'}
        </p>
      ) : (
        <>
          <ul className="mt-1 space-y-0.5">
            {series.map((item) => (
              <li key={item.dataKey} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{item.label}</span>
                <span className="ml-auto font-medium text-popover-foreground">
                  {formatCount(row[item.dataKey])}
                </span>
              </li>
            ))}
          </ul>
          {/* 누계만 못 믿는 날. 증분은 위에 그대로 숫자로 나와 있으므로 누계 쪽만 짚어 준다. */}
          {row.cumulativeGap && (
            <p className="mt-1 text-xs text-muted-foreground">
              누계를 전날에서 이어받지 못한 날입니다 (증분만 유효)
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** 계열 이름표. 2개 이상 계열이 있으면 색만으로 구분하게 두지 않는다. */
function ChartLegend({ items }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** 차트 자리에 들어가는 안내(데이터 없음 / 불러오기 실패) */
function ChartPlaceholder({ children }) {
  return (
    <div className="flex h-72 items-center justify-center text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** KPI 카드 밑에 깔리는 스파크라인. 값이 없는 날은 선을 끊는다. */
function Sparkline({ data }) {
  const hasAny = data.some((point) => point.value !== null);
  if (!hasAny) return <div className="h-10" />;

  return (
    <div className="h-10">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES[0]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * ① KPI 카드.
 *
 * 큰 숫자는 **지금 이 순간의 누적(live)** 이고, 그 아래 증감은 **선택한 기간의 롤업 합계**다.
 * 둘의 기준 시각이 다르므로 카드마다 기준을 배지로 적는다 — 이걸 안 적으면
 * "누적이 왜 일별 합과 안 맞냐"는 질문이 반드시 나온다.
 */
function KpiCard({ title, value, basis, delta, deltaLabel, detail, spark, note }) {
  const trending = typeof delta === 'number' && delta !== 0;
  const TrendIcon = delta > 0 ? TrendingUp : TrendingDown;

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-5">
        <p className="text-2xl font-bold tracking-tight tabular-nums">{formatCount(value)}</p>
        {/* 기준 시각을 숫자 바로 밑에 붙인다. 카드마다 기준이 달라서(실시간 vs 롤업)
            이 한 줄이 없으면 "누적이 왜 일별 합과 안 맞냐"는 질문이 반드시 나온다. */}
        <p className="text-[11px] text-muted-foreground/70">{basis}</p>
        {note ? (
          <p className="text-xs text-muted-foreground">{note}</p>
        ) : (
          <p className="flex items-center gap-1 text-xs">
            {trending && (
              <TrendIcon
                className={`size-3.5 ${delta > 0 ? 'text-success' : 'text-destructive'}`}
              />
            )}
            <span
              className={`font-medium tabular-nums ${
                delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {formatDelta(delta)}
            </span>
            <span className="text-muted-foreground">{deltaLabel}</span>
          </p>
        )}
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        <Sparkline data={spark} />
      </CardContent>
    </Card>
  );
}

/** 로딩 중 KPI 자리 */
function KpiSkeleton() {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <Skeleton className="h-4 w-20" />
      </CardHeader>
      <CardContent className="space-y-2 px-5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * `metrics` 권한이 없는 계정이 보는 화면.
 *
 * 예전처럼 큰 카드 격자를 다시 깔지 않는다(사이드바와 중복이라 걷어낸 것이다).
 * 대신 갈 수 있는 곳을 한 줄짜리 링크 목록으로만 알려준다.
 */
function MetricsForbidden({ claims }) {
  const items = flattenEntries(navigation.main).filter(
    (item) => Boolean(item.permission) && canAccessItem(item, claims)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card px-5 py-4">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">지표 접근 권한이 없습니다.</p>
          <p className="text-sm text-muted-foreground">
            관리자에게 요청하세요. 권한은 다시 로그인해야 반영됩니다.
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">접근 가능한 메뉴</p>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  to={item.href}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {item.label}
                  <ArrowRight className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- 본체 */

export default function Dashboard() {
  const claims = useMemo(() => getAdminClaims(), []);
  // 403 이 뻔한 요청은 아예 보내지 않는다. 다만 클레임은 로그인 시점에 굳은 값이라
  // 권한이 방금 회수된 경우도 있어, 응답의 403 도 아래에서 따로 받는다.
  const allowed = canAccessMetrics(claims);

  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState(() => presetRange(30));
  const [customFrom, setCustomFrom] = useState(range.dateFrom);
  const [customTo, setCustomTo] = useState(range.dateTo);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(allowed);
  const [summaryFailed, setSummaryFailed] = useState(false);

  const [days, setDays] = useState([]);
  const [daysLoading, setDaysLoading] = useState(allowed);
  const [daysFailed, setDaysFailed] = useState(false);

  const [forbidden, setForbidden] = useState(!allowed);
  const [trendKey, setTrendKey] = useState('users');

  // 늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 한다(AuditLogs 와 같은 수법)
  const dailyRequestRef = useRef(0);

  const loadSummary = useCallback(async () => {
    if (!allowed) return;
    setSummaryLoading(true);
    setSummaryFailed(false);
    try {
      setSummary(await fetchMetricsSummary());
    } catch (error) {
      if (isForbidden(error)) {
        setForbidden(true);
        return;
      }
      setSummary(null);
      setSummaryFailed(true);
      toast.error(readErrorMessage(error, '지표를 불러오지 못했습니다.'));
    } finally {
      setSummaryLoading(false);
    }
  }, [allowed]);

  const loadDaily = useCallback(async () => {
    if (!allowed) return;
    const requestId = dailyRequestRef.current + 1;
    dailyRequestRef.current = requestId;

    setDaysLoading(true);
    setDaysFailed(false);
    try {
      const result = await fetchDailyMetrics(range);
      if (dailyRequestRef.current !== requestId) return;
      setDays(result.days);
    } catch (error) {
      if (dailyRequestRef.current !== requestId) return;
      if (isForbidden(error)) {
        setForbidden(true);
        return;
      }
      setDays([]);
      setDaysFailed(true);
      toast.error(readErrorMessage(error, '일자별 지표를 불러오지 못했습니다.'));
    } finally {
      if (dailyRequestRef.current === requestId) setDaysLoading(false);
    }
  }, [allowed, range]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadDaily();
  }, [loadDaily]);

  const applyPreset = (option) => {
    setPreset(option.key);
    const next = presetRange(option.days);
    setRange(next);
    setCustomFrom(next.dateFrom);
    setCustomTo(next.dateTo);
  };

  /** 직접 입력은 두 칸이 다 차고 앞뒤가 맞을 때만 적용한다(뒤집힌 구간은 서버가 400 이다) */
  const applyCustomRange = (from, to) => {
    if (!from || !to) return;
    if (from > to) {
      toast.error('시작일이 종료일보다 뒤입니다.');
      return;
    }
    setRange({ dateFrom: from, dateTo: to });
  };

  const rollup = summary?.rollup ?? null;
  const live = summary?.live ?? null;

  // 각 날의 상태(집계 중 / 데이터 없음 / 누계 끊김)는 metrics.js 가 시계 기준으로 정한다.
  // rollup.date 는 여기 안 들어간다 — 배치가 멈추면 그 날짜도 같이 멈춰서 판정이 거짓말을 한다.
  const decorated = useMemo(() => decorateDays(days), [days]);

  /** 표는 최신순으로 본다. 차트는 시간순이어야 하므로 뒤집지 않는다. */
  const tableDays = useMemo(() => [...decorated].reverse(), [decorated]);

  const trend = TREND_METRICS.find((item) => item.key === trendKey) ?? TREND_METRICS[0];

  const trendData = useMemo(
    () =>
      decorated.map((day) => ({
        date: day.date,
        label: shortDateLabel(day.date),
        pending: day.pending,
        missing: day.missing,
        // 누계 끊김은 이 차트에만 실린다(누적선을 가진 차트가 여기뿐이다). 툴팁이 이 값을 본다.
        cumulativeGap: day.cumulativeGap,
        daily: metricValue(day, trend.group, trend.field),
        // gap 인 날은 metricValue 가 null 을 준다 → 누적선이 그 날에서 끊긴다
        cumulative: metricValue(day, 'cumulative', trend.cumulative),
      })),
    [decorated, trend]
  );

  const feedTypeData = useMemo(
    () =>
      decorated.map((day) => {
        const row = {
          date: day.date,
          label: shortDateLabel(day.date),
          pending: day.pending,
          missing: day.missing,
        };
        FEED_TYPES.forEach((type) => {
          row[type.key] = metricValue(day, 'feeds', type.key);
        });
        return row;
      }),
    [decorated]
  );

  const betTypeData = useMemo(() => sumBetTypes(decorated), [decorated]);
  const betTypeTotal = betTypeData?.reduce((acc, item) => acc + item.value, 0) ?? 0;

  /** KPI 카드에 깔 스파크라인 데이터 */
  const sparkOf = useCallback(
    (group, key) =>
      decorated.map((day) => ({
        label: day.date,
        value: metricValue(day, group, key),
      })),
    [decorated]
  );

  const exportCsv = () => {
    const csv = buildCsv({ columns: TABLE_COLUMNS, days: tableDays });
    downloadCsv(`birdieup-metrics_${range.dateFrom}_${range.dateTo}.csv`, csv);
  };

  if (forbidden) return <MetricsForbidden claims={claims} />;

  const asOfLabel = formatKstDateTime(live?.asOf);
  const hasRollup = Boolean(rollup);
  // 요약의 DAU/WAU/MAU 를 숫자로 믿어도 되는가(방문 계측 이전이면 0 이 실려 온다)
  const viewersUsable = summaryViewersUsable(rollup);
  const chartsLoading = summaryLoading || daysLoading;

  return (
    <div className="space-y-6">
      {/* 머리 — 어느 숫자가 언제 기준인지를 여기서 못 박는다 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">지표</h1>
          <p className="text-xs text-muted-foreground">
            {summaryLoading
              ? '기준 시각을 불러오는 중…'
              : `누적값은 실시간${asOfLabel ? ` (${asOfLabel} 기준)` : ''} · 추이는 ${
                  hasRollup ? `${rollup.date}까지 집계` : '아직 집계 전'
                }`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((option) => (
            <Button
              key={option.key}
              type="button"
              size="sm"
              variant={preset === option.key ? 'default' : 'outline'}
              className="rounded-xl"
              onClick={() => applyPreset(option)}
            >
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={preset === 'custom' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => setPreset('custom')}
          >
            직접 입력
          </Button>

          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  applyCustomRange(e.target.value, customTo);
                }}
                className="h-8 w-36 rounded-xl text-sm"
                aria-label="시작일"
              />
              <span className="text-xs text-muted-foreground">~</span>
              <Input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  applyCustomRange(customFrom, e.target.value);
                }}
                className="h-8 w-36 rounded-xl text-sm"
                aria-label="종료일"
              />
            </div>
          )}
        </div>
      </div>

      {/* ① KPI 카드 */}
      {summaryLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <KpiSkeleton key={index} />
          ))}
        </div>
      ) : summaryFailed ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">지표를 불러오지 못했습니다.</p>
            <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={loadSummary}>
              <RotateCcw className="size-4" />
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            title="회원"
            basis="실시간 기준"
            value={live?.users?.active}
            delta={sumMetric(decorated, 'users', 'new')}
            deltaLabel="기간 신규"
            detail={`정지 ${formatCount(live?.users?.suspended)} · 탈퇴 ${formatCount(
              live?.users?.withdrawn
            )}`}
            spark={sparkOf('users', 'new')}
          />
          {/* 활동회원만 증감을 적지 않는다. DAU/WAU/MAU 는 이동 구간이라 날짜별로 더하거나
              빼면 같은 사람을 여러 번 세게 되고, "기간 증감"이라는 말 자체가 성립하지 않는다.

              viewersMissing 인 날은 서버가 셋을 **0 으로 실어 보낸다**. 그 0 을 그대로 그리면
              같은 화면의 일자별 표(metricValue 를 거쳐 `—`)와 카드가 서로 다른 말을 한다.
              판정은 summaryViewersUsable() 하나만 본다. 기여자는 그날에도 유효하므로 남긴다. */}
          <KpiCard
            title="활동회원 (MAU)"
            basis={
              !hasRollup
                ? '집계 전'
                : viewersUsable
                  ? `${rollup.date} 집계 기준`
                  : `${rollup.date} 집계 · 방문 계측 이전`
            }
            value={viewersUsable ? rollup.activeUsers?.mau : null}
            note={
              !hasRollup
                ? '아직 집계된 데이터가 없습니다'
                : viewersUsable
                  ? `DAU ${formatCount(rollup.activeUsers?.dau)} · WAU ${formatCount(
                      rollup.activeUsers?.wau
                    )}`
                  : 'DAU·WAU·MAU를 셀 수 없는 날입니다'
            }
            detail={
              hasRollup ? `기여자 ${formatCount(rollup.activeUsers?.contributors)}` : undefined
            }
            spark={sparkOf('active', 'contributors')}
          />
          <KpiCard
            title="프렌즈"
            basis="실시간 기준"
            value={live?.friends?.total}
            delta={sumMetric(decorated, 'friends', 'new')}
            deltaLabel="기간 신규"
            detail={`연결 ${formatCount(live?.friends?.linked)} · 미연결 ${formatCount(
              live?.friends?.unlinked
            )}`}
            spark={sparkOf('friends', 'new')}
          />
          <KpiCard
            title="라운딩"
            basis="실시간 기준"
            value={live?.rounds?.total}
            delta={sumMetric(decorated, 'rounds', 'started')}
            deltaLabel="기간 시작"
            detail={`진행 ${formatCount(live?.rounds?.live)} · 종료 ${formatCount(
              live?.rounds?.ended
            )} · 중단 ${formatCount(live?.rounds?.aborted)}`}
            spark={sparkOf('rounds', 'started')}
          />
          <KpiCard
            title="피드"
            basis="실시간 기준"
            value={live?.feeds?.alive}
            delta={sumMetric(decorated, 'feeds', 'created')}
            deltaLabel="기간 작성"
            detail={`전체 ${formatCount(live?.feeds?.total)} · 삭제 ${formatCount(
              live?.feeds?.deleted
            )}`}
            spark={sparkOf('feeds', 'created')}
          />
        </div>
      )}

      {/* ②③④ — 롤업이 한 번도 안 돌았으면 0 을 그리는 대신 통째로 안내로 바꾼다 */}
      {!summaryLoading && !summaryFailed && !hasRollup ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium">아직 집계된 데이터가 없습니다.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              매일 04:00(KST)에 전날치가 집계됩니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ② 일별 추이 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-sm font-bold">일별 추이</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                {TREND_METRICS.map((item) => (
                  <Button
                    key={item.key}
                    type="button"
                    size="xs"
                    variant={trendKey === item.key ? 'default' : 'outline'}
                    className="rounded-lg"
                    onClick={() => setTrendKey(item.key)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChartLegend
                items={[
                  { label: `${trend.label} 신규 (좌축)`, color: SERIES[0] },
                  { label: `${trend.label} 누적 (우축)`, color: SERIES[4] },
                ]}
              />
              {chartsLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : daysFailed ? (
                <ChartPlaceholder>
                  <div className="space-y-2">
                    <p>일자별 지표를 불러오지 못했습니다.</p>
                    <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={loadDaily}>
                      <RotateCcw className="size-4" />
                      다시 시도
                    </Button>
                  </div>
                </ChartPlaceholder>
              ) : decorated.length === 0 ? (
                <ChartPlaceholder>선택한 기간에 데이터가 없습니다.</ChartPlaceholder>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                      <YAxis yAxisId="daily" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                      <YAxis
                        yAxisId="cumulative"
                        orientation="right"
                        tick={AXIS_TICK}
                        tickLine={false}
                        axisLine={false}
                        width={56}
                      />
                      <RechartsTooltip
                        cursor={{ fill: 'var(--muted)' }}
                        content={
                          <ChartTooltip
                            series={[
                              { dataKey: 'daily', label: '신규', color: SERIES[0] },
                              { dataKey: 'cumulative', label: '누적', color: SERIES[4] },
                            ]}
                          />
                        }
                      />
                      <Bar
                        yAxisId="daily"
                        dataKey="daily"
                        fill={SERIES[0]}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                        isAnimationActive={false}
                      />
                      {/* 값이 없는 날은 null 이라 선이 끊긴다(connectNulls 를 켜지 마라 —
                          없는 날을 이어 버리면 "그날도 뭔가 있었다"로 읽힌다) */}
                      <Line
                        yAxisId="cumulative"
                        type="monotone"
                        dataKey="cumulative"
                        stroke={SERIES[4]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ③ 구성 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-bold">피드 유형</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ChartLegend
                  items={FEED_TYPES.map((type, index) => ({
                    label: type.label,
                    color: SERIES[index],
                  }))}
                />
                {chartsLoading ? (
                  <Skeleton className="h-72 w-full" />
                ) : decorated.length === 0 || daysFailed ? (
                  <ChartPlaceholder>표시할 데이터가 없습니다.</ChartPlaceholder>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={feedTypeData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                        <RechartsTooltip
                          cursor={{ fill: 'var(--muted)' }}
                          content={
                            <ChartTooltip
                              series={FEED_TYPES.map((type, index) => ({
                                dataKey: type.key,
                                label: type.label,
                                color: SERIES[index],
                              }))}
                            />
                          }
                        />
                        {FEED_TYPES.map((type, index) => (
                          <Bar
                            key={type.key}
                            dataKey={type.key}
                            stackId="feeds"
                            fill={SERIES[index]}
                            // 조각 사이를 카드색 실선으로 갈라 둔다(색만으로 붙어 보이지 않게)
                            stroke="var(--card)"
                            strokeWidth={1.5}
                            maxBarSize={28}
                            isAnimationActive={false}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-bold">라운드 내기 방식</CardTitle>
              </CardHeader>
              <CardContent>
                {chartsLoading ? (
                  <Skeleton className="h-72 w-full" />
                ) : !betTypeData || betTypeTotal === 0 ? (
                  <ChartPlaceholder>
                    {betTypeData ? '기간 내 시작된 라운드가 없습니다.' : '표시할 데이터가 없습니다.'}
                  </ChartPlaceholder>
                ) : (
                  <div className="flex flex-col items-center gap-4 sm:flex-row">
                    <div className="h-56 w-full sm:w-1/2">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={betTypeData}
                            dataKey="value"
                            nameKey="label"
                            innerRadius="58%"
                            outerRadius="85%"
                            paddingAngle={2}
                            stroke="var(--card)"
                            strokeWidth={2}
                            isAnimationActive={false}
                          >
                            {betTypeData.map((item, index) => (
                              <Cell key={item.key} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            content={({ active, payload }) =>
                              active && payload?.length ? (
                                <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-sm">
                                  <span className="font-semibold">{payload[0].name}</span>{' '}
                                  <span className="tabular-nums">
                                    {formatCount(payload[0].value)}
                                  </span>
                                </div>
                              ) : null
                            }
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* 조각마다 값을 글자로도 적는다 — 색만으로 읽게 두지 않는다 */}
                    <ul className="w-full space-y-2 sm:w-1/2">
                      {betTypeData.map((item, index) => (
                        <li key={item.key} className="flex items-center gap-2 text-sm">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
                          />
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="ml-auto font-medium tabular-nums">
                            {formatCount(item.value)}
                          </span>
                          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                            {betTypeTotal > 0
                              ? `${Math.round((item.value / betTypeTotal) * 100)}%`
                              : NO_VALUE}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ④ 일자별 표 */}
          <section className="rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-bold">일자별</h3>
                <p className="text-xs text-muted-foreground">
                  {range.dateFrom} ~ {range.dateTo} (KST) · 값이 없는 날은 {NO_VALUE}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={daysLoading || tableDays.length === 0}
                onClick={exportCsv}
              >
                <Download className="size-4" />
                CSV 내보내기
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40 pl-5">날짜</TableHead>
                  {TABLE_COLUMNS.map((column) => (
                    <TableHead key={`${column.group}-${column.key}`} className="text-right">
                      {column.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-4 pr-5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {daysLoading ? (
                  Array.from({ length: 6 }).map((_, rowIndex) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <TableRow key={rowIndex}>
                      {Array.from({ length: TABLE_COLUMNS.length + 2 }).map((__, cellIndex) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <TableCell key={cellIndex} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : tableDays.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={TABLE_COLUMNS.length + 2}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      선택한 기간에 데이터가 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  tableDays.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell className="py-3 pl-5 font-mono text-xs text-muted-foreground">
                        {/* 배지 세 종류는 서로 다른 사건이다. 특히 '데이터 없음' 은
                            집계 시각이 지났는데도 비어 있다는 뜻이라 배치를 봐야 한다는 신호다 —
                            '집계 중' 과 같은 모양으로 두면 운영자가 정상으로 읽고 넘어간다. */}
                        <span className="flex flex-wrap items-center gap-2">
                          {day.date}
                          {day.pending && (
                            <Badge
                              variant="secondary"
                              className="font-sans font-normal"
                              title="아직 집계될 시각(다음 날 04:00 KST)이 지나지 않았습니다"
                            >
                              집계 중
                            </Badge>
                          )}
                          {day.missing && (
                            <Badge
                              variant="outline"
                              className="border-destructive/50 font-sans font-normal text-destructive"
                              title="집계 시각이 지났는데도 이 날의 집계 결과가 없습니다"
                            >
                              데이터 없음
                            </Badge>
                          )}
                          {day.cumulativeGap && (
                            <Badge
                              variant="outline"
                              className="font-sans font-normal"
                              title="누계를 전날에서 이어받지 못했습니다. 이 날의 증분은 유효합니다"
                            >
                              누계 끊김
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      {TABLE_COLUMNS.map((column) => {
                        const value = metricValue(day, column.group, column.key);
                        return (
                          <TableCell
                            key={`${column.group}-${column.key}`}
                            className={`py-3 text-right tabular-nums ${
                              value === null ? 'text-muted-foreground' : ''
                            }`}
                          >
                            {formatCount(value)}
                          </TableCell>
                        );
                      })}
                      <TableCell className="pr-5" />
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}
