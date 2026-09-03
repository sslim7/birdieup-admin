import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ScrollText,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { fetchAuditLogs } from '@/services/auditLogService';

/** 서버 기본값과 동일하게 고정한다(페이지 크기 선택 UI 는 두지 않는다) */
const PAGE_SIZE = 20;

/** 시각 / 관리자 / 액션 / 대상 / IP / 펼침 */
const COLUMN_COUNT = 6;

/** 검색·대상 입력 디바운스(ms) */
const DEBOUNCE_MS = 300;

/**
 * axios 에러에서 화면에 띄울 문구를 고른다.
 * 서버 에러는 { code, message, details? } 이고 message 가 그대로 쓸 수 있는 한국어라
 * 그것을 먼저 쓴다. message 가 없을 때만 fallback 으로 내려간다.
 */
function readErrorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

/**
 * createdAt 을 KST 기준 'YYYY-MM-DD HH:mm:ss' 로 표기한다.
 *
 * 계약상 모든 timestamp 는 RFC3339 UTC 문자열이라 브라우저 타임존을 따라가면
 * 운영자가 보는 시각과 어긋난다. 그래서 표시는 Asia/Seoul 로 고정한다.
 * 오프셋이 없는 값이 섞여 들어오면 로컬 시각으로 해석되어 조용히 틀리므로,
 * 계약대로 UTC 로 보고 'Z' 를 붙여 파싱한다.
 */
function formatKstDateTime(value) {
  if (!value) return '-';

  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasOffset ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return parts.replace('T', ' ');
}

/** 대상 배지 색상 — 도메인 종류가 백엔드에 열려 있어 문자열 해시로 안정적인 색을 고른다 */
const TARGET_BADGE_CLASSES = [
  'bg-blue-50 text-blue-600',
  'bg-violet-50 text-violet-600',
  'bg-emerald-50 text-emerald-600',
  'bg-amber-50 text-amber-600',
  'bg-rose-50 text-rose-600',
  'bg-sky-50 text-sky-600',
  'bg-teal-50 text-teal-600',
  'bg-fuchsia-50 text-fuchsia-600',
];

function targetBadgeClass(target) {
  let hash = 0;
  for (let i = 0; i < target.length; i += 1) {
    hash = (hash * 31 + target.charCodeAt(i)) % 100000;
  }
  return TARGET_BADGE_CLASSES[hash % TARGET_BADGE_CLASSES.length];
}

/**
 * 액션 왼쪽 보더 색상.
 * actions 는 대부분 "METHOD /경로"("POST /admin/posts") 형태이고, 로그인 관련만 한글 문구다.
 */
function actionBorderClass(actions) {
  if (/실패|삭제|DELETE/.test(actions)) return 'border-l-destructive';
  if (/^(POST|PUT|PATCH)\b/.test(actions)) return 'border-l-primary';
  return 'border-l-border';
}

/** 관리자 표시용 이름. 이름/이메일이 모두 없으면 adminId 를 축약해서 보여준다 */
function adminLabel(log) {
  if (log.adminName) return log.adminName;
  if (log.adminEmail) return log.adminEmail;
  if (log.adminId) return `${String(log.adminId).slice(0, 8)}…`;
  return '시스템';
}

function TableSkeleton() {
  return Array.from({ length: 6 }).map((_, rowIndex) => (
    // eslint-disable-next-line react/no-array-index-key
    <TableRow key={rowIndex}>
      {Array.from({ length: COLUMN_COUNT }).map((__, cellIndex) => (
        // eslint-disable-next-line react/no-array-index-key
        <TableCell key={cellIndex} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export default function AuditLogs() {
  // 입력 상태(디바운스 전) / 실제 조회에 쓰이는 상태
  const [searchInput, setSearchInput] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  // target 자동완성 후보 — 지금까지 응답에서 본 도메인을 모아둔다
  const [knownTargets, setKnownTargets] = useState([]);

  // 늦게 도착한 이전 요청의 응답이 최신 결과를 덮어쓰지 않도록 한다
  const requestIdRef = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 검색어 디바운스
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // 대상(도메인) 디바운스
  useEffect(() => {
    const timer = setTimeout(() => {
      setTarget(targetInput);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [targetInput]);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    try {
      const result = await fetchAuditLogs({
        page,
        pageSize: PAGE_SIZE,
        dateFrom,
        dateTo,
        target,
        search,
        sortOrder,
      });
      if (requestIdRef.current !== requestId) return;

      setLogs(result.logs);
      setTotal(result.total);
      setExpandedId(null);
      setKnownTargets((prev) => {
        const merged = new Set(prev);
        result.logs.forEach((log) => {
          if (log.targets) merged.add(log.targets);
        });
        return merged.size === prev.length ? prev : Array.from(merged).sort();
      });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setLogs([]);
      setTotal(0);
      toast.error(readErrorMessage(error, '활동 로그를 불러오지 못했습니다.'));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [page, dateFrom, dateTo, target, search, sortOrder]);

  useEffect(() => {
    load();
  }, [load]);

  const hasActiveFilters = Boolean(
    searchInput || targetInput || dateFrom || dateTo || sortOrder !== 'desc'
  );

  const resetFilters = () => {
    setSearchInput('');
    setTargetInput('');
    setSearch('');
    setTarget('');
    setDateFrom('');
    setDateTo('');
    setSortOrder('desc');
    setPage(1);
  };

  const rangeLabel = useMemo(() => {
    if (total === 0) return '총 0건';
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, total);
    return `총 ${total.toLocaleString()}건 · ${start.toLocaleString()}–${end.toLocaleString()}`;
  }, [page, total]);

  const goToPage = (next) => {
    if (next < 1 || next > totalPages || loading) return;
    setPage(next);
  };

  return (
    <div className="space-y-6">
      {/* 페이지 헤더.
          "조회했는데 로그가 없다"는 오해가 반복되므로 기록 범위를 여기서 미리 밝힌다. */}
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          어드민 콘솔에서 일어난 작업 이력을 조회합니다.
        </p>
        <p className="text-xs text-muted-foreground">
          생성·수정·삭제 등 데이터를 바꾼 요청만 기록됩니다. 목록·상세 조회는 남지 않으며,
          로그인 성공/실패는 예외로 기록됩니다.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card">
        {/* 필터바 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <div className="mr-auto flex items-center gap-2">
            <ScrollText className="size-4 text-primary" />
            <h3 className="text-sm font-bold">활동 이력</h3>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="액션 / 관리자 / IP 검색"
              className="h-9 w-56 rounded-xl pl-8 text-sm"
              aria-label="활동 로그 검색"
            />
          </div>

          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="h-9 w-40 rounded-xl text-sm"
            aria-label="시작일"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="h-9 w-40 rounded-xl text-sm"
            aria-label="종료일"
          />

          {/* 대상 도메인은 백엔드가 늘려 갈 수 있어 고정 셀렉트 대신
              자유 입력 + 지금까지 응답에서 본 값 자동완성으로 처리한다 */}
          <Input
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder="대상 (posts, auth…)"
            list="audit-log-targets"
            className="h-9 w-44 rounded-xl font-mono text-sm"
            aria-label="대상 도메인 필터"
          />
          <datalist id="audit-log-targets">
            {knownTargets.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>

          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-xl"
            onClick={() => {
              setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
              setPage(1);
            }}
          >
            {sortOrder === 'desc' ? (
              <ArrowDownWideNarrow className="size-4" />
            ) : (
              <ArrowUpNarrowWide className="size-4" />
            )}
            {sortOrder === 'desc' ? '최신순' : '오래된순'}
          </Button>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-xl text-xs"
              onClick={resetFilters}
            >
              필터 초기화
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44 pl-5">시각</TableHead>
              <TableHead className="w-56">관리자</TableHead>
              <TableHead>액션</TableHead>
              <TableHead className="w-32">대상</TableHead>
              <TableHead className="w-36">IP</TableHead>
              <TableHead className="w-12 pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton />
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  활동 로그가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => {
                const id = log.auditLogId;
                const expanded = expandedId === id;

                return [
                  <TableRow
                    key={id}
                    onClick={() => setExpandedId(expanded ? null : id)}
                    className="cursor-pointer"
                    data-state={expanded ? 'selected' : undefined}
                  >
                    <TableCell className="py-3 pl-5 font-mono text-xs text-muted-foreground">
                      {formatKstDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="py-3">
                      <p className="text-sm font-medium">{adminLabel(log)}</p>
                      {log.adminName && log.adminEmail && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {log.adminEmail}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <span
                        className={`border-l-2 pl-2 font-mono text-xs ${actionBorderClass(
                          log.actions ?? ''
                        )}`}
                      >
                        {log.actions || '-'}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      {log.targets ? (
                        <Badge
                          className={`border-0 font-normal ${targetBadgeClass(log.targets)}`}
                        >
                          {log.targets}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 font-mono text-xs text-muted-foreground">
                      {log.ipAddress || '-'}
                    </TableCell>
                    <TableCell className="py-3 pr-5 text-right">
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      />
                    </TableCell>
                  </TableRow>,

                  expanded && (
                    <TableRow key={`${id}-details`} className="hover:bg-transparent">
                      <TableCell colSpan={COLUMN_COUNT} className="px-5 py-4">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          상세 데이터
                        </p>
                        {log.details ? (
                          <pre className="max-h-80 overflow-auto rounded-xl bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            상세 정보 없음
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })
            )}
          </TableBody>
        </Table>

        {/* 페이지네이션 */}
        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <p className="text-sm text-muted-foreground">{rangeLabel}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={page <= 1 || loading}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="size-4" />
              이전
            </Button>
            <span className="rounded-lg bg-muted px-3 py-1.5 font-mono text-sm">
              {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={page >= totalPages || loading}
              onClick={() => goToPage(page + 1)}
            >
              다음
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
