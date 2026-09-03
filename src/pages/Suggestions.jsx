import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MessageSquareHeart, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  fetchSuggestions,
  formatDate,
  readErrorMessage,
} from '@/services/suggestionService';

/**
 * 필터 세그먼트.
 *
 * answered / notified 는 서버 쿼리 값 그대로다(undefined = 전체). 화면 키와 쿼리 값을 한 곳에
 * 묶어 두어야 "답변 대기를 골랐는데 전체가 나온다" 류의 어긋남이 생기지 않는다.
 *
 * 「문자 미발송」(answered=true & notified=false)이 이 화면의 진짜 목적이다 —
 * 답변은 달렸는데 문자가 안 나간 제안은 여기서 찾지 못하면 아무도 다시 보지 않는다.
 * total 이 없는 커서 목록이라 서버가 걸러 주지 않으면 끝까지 넘겨 보는 수밖에 없다.
 */
const FILTERS = [
  { key: 'all', label: '전체', answered: undefined, notified: undefined },
  { key: 'unanswered', label: '답변 대기', answered: false, notified: undefined },
  { key: 'answered', label: '답변 완료', answered: true, notified: undefined },
  { key: 'unnotified', label: '문자 미발송', answered: true, notified: false },
];

const UNNOTIFIED_FILTER_KEY = 'unnotified';

/** 작성자 / 내용 / 등록일 / 상태 */
const COLUMN_COUNT = 4;

/**
 * 필터별 빈 상태 문구.
 * "없습니다" 한 마디로 뭉뚱그리면 「문자 미발송」이 비었다는 좋은 소식이
 * 조회가 안 된 것처럼 보인다.
 */
const EMPTY_MESSAGES = {
  all: '등록된 제안이 없습니다.',
  unanswered: '답변을 기다리는 제안이 없습니다.',
  answered: '답변한 제안이 없습니다.',
  unnotified: '문자가 발송되지 않은 답변이 없습니다.',
};

/**
 * 상태 배지.
 *
 * 「문자 미발송」(답변은 달렸는데 notifiedAt 이 빈 상태)을 destructive 로 띄우는 것이
 * 이 화면의 존재 이유다. 발송 실패는 답변 저장을 되돌리지 않으므로, 목록에서 눈에 띄지
 * 않으면 그 제안은 아무도 다시 보지 않는다.
 */
function StatusBadge({ item }) {
  if (!item.answered) return <Badge variant="secondary">답변 대기</Badge>;
  if (!item.notifiedAt) return <Badge variant="destructive">문자 미발송</Badge>;
  return <Badge>답변 완료</Badge>;
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

export default function Suggestions() {
  const navigate = useNavigate();

  const [filterKey, setFilterKey] = useState('all');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 필터를 빠르게 바꾸면 이전 요청이 늦게 도착해 최신 결과를 덮어쓸 수 있다.
  const requestIdRef = useRef(0);

  const filter = FILTERS.find((entry) => entry.key === filterKey) ?? FILTERS[0];
  const { answered, notified } = filter;

  /**
   * cursor 가 없으면 처음부터, 있으면 뒤에 이어 붙인다.
   * 필터가 바뀌면 커서는 의미를 잃으므로 호출부가 반드시 cursor 없이 부른다.
   */
  const load = useCallback(
    async (cursor) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (cursor) setLoadingMore(true);
      else setLoading(true);

      try {
        const result = await fetchSuggestions({ answered, notified, cursor });
        if (requestIdRef.current !== requestId) return;

        setItems((prev) => (cursor ? [...prev, ...result.items] : result.items));
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (requestIdRef.current !== requestId) return;
        // 이어 받기 실패는 이미 보고 있는 목록을 지우지 않는다.
        if (!cursor) {
          setItems([]);
          setNextCursor(null);
        }
        toast.error(readErrorMessage(error, '제안 목록을 불러오지 못했습니다.'));
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [answered, notified]
  );

  // 필터가 바뀌면 커서를 버리고 처음부터 다시 받는다.
  useEffect(() => {
    load(undefined);
  }, [load]);

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <p className="text-sm text-muted-foreground">
        앱에서 들어온 제안을 확인하고 답변합니다. 답변을 저장하면 제안자에게 문자가
        발송됩니다.
      </p>

      {/*
        여기서 건수를 세어 보여 주지 않는다. 커서 목록이라 셀 수 있는 것은 지금 불러온
        페이지뿐이고, 그 부분 집계를 전체인 양 적으면 뒤쪽에 묻힌 제안을 놓치게 만든다.
        대신 서버가 전부 걸러 주는 「문자 미발송」 필터로 보낸다.
      */}
      {filterKey !== UNNOTIFIED_FILTER_KEY && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span>답변은 달렸는데 문자가 나가지 않은 제안은</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto p-0 text-destructive"
            onClick={() => setFilterKey(UNNOTIFIED_FILTER_KEY)}
          >
            「문자 미발송」
          </Button>
          <span>에서 한 번에 확인하고 재발송할 수 있습니다.</span>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card">
        {/* 필터바 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <div className="mr-auto flex items-center gap-2">
            <MessageSquareHeart className="size-4 text-primary" />
            <h3 className="text-sm font-bold">제안 목록</h3>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
            {FILTERS.map((entry) => {
              const active = entry.key === filterKey;
              // 「문자 미발송」만 붉게 둔다 — 나머지와 성격이 다른, 조치가 필요한 묶음이다
              const danger = entry.key === UNNOTIFIED_FILTER_KEY;

              return (
                <Button
                  key={entry.key}
                  type="button"
                  size="sm"
                  variant={active ? (danger ? 'destructive' : 'default') : 'ghost'}
                  className={`rounded-lg ${!active && danger ? 'text-destructive' : ''}`}
                  aria-pressed={active}
                  onClick={() => setFilterKey(entry.key)}
                >
                  {entry.label}
                </Button>
              );
            })}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44 pl-5">작성자</TableHead>
              <TableHead>내용</TableHead>
              <TableHead className="w-36">등록일</TableHead>
              <TableHead className="w-32 pr-5">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton />
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  {EMPTY_MESSAGES[filterKey] ?? EMPTY_MESSAGES.all}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow
                  key={item.suggestionId}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => navigate(`/suggestions/${item.suggestionId}`)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    navigate(`/suggestions/${item.suggestionId}`);
                  }}
                >
                  <TableCell className="py-3 pl-5 text-sm font-medium">
                    {item.userName || '탈퇴한 회원'}
                  </TableCell>
                  <TableCell className="py-3">
                    {/* excerpt 는 서버가 잘라 넣은 앞부분이다. 두 줄까지만 보여 준다 */}
                    <p className="line-clamp-2 max-w-xl text-sm whitespace-pre-wrap">
                      {item.excerpt || '(내용 없음)'}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {formatDate(item.createdAt)}
                  </TableCell>
                  <TableCell className="py-3 pr-5">
                    <StatusBadge item={item} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/*
          커서 페이지네이션. 응답에 total 이 없어 몇 페이지인지 셀 수 없으므로
          페이지 번호 대신 「더 보기」만 둔다.
        */}
        <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {loading ? '불러오는 중…' : `${items.length.toLocaleString()}건 표시 중`}
          </p>
          {nextCursor && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={loadingMore}
              onClick={() => load(nextCursor)}
            >
              {loadingMore && <Loader2 className="size-4 animate-spin" />}
              더 보기
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
