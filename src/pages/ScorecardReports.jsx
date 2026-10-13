import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileJson, Image as ImageIcon, Loader2, ScanText } from 'lucide-react';
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
  describeDevice,
  fetchScorecardReports,
  formatDateTime,
  readErrorMessage,
} from '@/services/scorecardReportService';

/**
 * 스코어카드 OCR 자동 전송 목록.
 *
 * 🔴 **의견보내기 목록과 섞지 마라.** 앱은 스코어카드를 가져올 때마다 사진과 판독 결과를
 * 자동으로 올린다(기본 켜짐). 사람이 쓴 의견과 한 목록에 세우면 자동 전송이 목록을 덮어
 * 운영자가 실제로 온 의견을 못 본다 — 그래서 서버가 별도 컬렉션으로 받고 화면도 따로다.
 *
 * 이 화면에 **필터바가 없는 것은 빠뜨린 것이 아니다.** 계약에 거르기 쿼리가 하나도 없고
 * (docs/admin-api.md §10), total 도 없는 커서 목록이다. 받아 온 페이지 안에서만 거르면
 * 그 부분 집계가 전체인 양 보이고 뒤쪽 장에 묻힌 건을 「없다」고 말하게 된다.
 * 거르고 싶어지면 쿼리를 서버에 먼저 넣어라.
 *
 * 운영자가 여기서 하는 일은 하나다 — 쓸 자료를 골라 회귀 자료로 옮겨 적고, 나머지를
 * 지운다. 자동 전송이라 지우지 않으면 끝없이 쌓인다.
 */

/** 기기 / 보낸 때 / 첨부 / 한 줄 */
const COLUMN_COUNT = 4;

/**
 * 목록에 세우는 userId 앞자리 길이.
 *
 * 🔴 **userId 를 통째로 세우지 마라.** Firebase uid 는 28자라 열을 하나 통째로 먹고,
 * 그러면 정작 봐야 하는 기기·첨부가 밀려난다. 그렇다고 빼 버릴 수도 없다 — 한 사람이
 * 쏟아 내는 것(같은 폰에서 같은 실패가 열 번 올라오는 것)을 알아보는 값이 이것뿐이다
 * (계약이 userName·phoneNo 를 일부러 싣지 않는다).
 * 그래서 **앞자리만 보여 주고 전체는 title 과 상세에 둔다.** 앞 8자가 같은 두 uid 는
 * 실무에서 없고, 사람을 가려내는 판정은 아래 SAME_USER 배지가 **잘린 값이 아니라 전체
 * userId** 로 한다 — 잘린 값으로 세면 남의 건이 한 사람으로 묶인다.
 */
const USER_ID_HEAD = 8;

function TableSkeleton() {
  return Array.from({ length: 6 }).map((_, rowIndex) => (
    <TableRow key={rowIndex}>
      {Array.from({ length: COLUMN_COUNT }).map((__, cellIndex) => (
        <TableCell key={cellIndex} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

/**
 * 첨부 배지.
 *
 * hasPhoto / hasData 는 **고칠 자료가 실제로 왔는지**다. 둘 다 없는 건은 볼 것이 없으니
 * 지울 후보라 그 사실을 한눈에 보이게 둔다 — 안 그러면 하나씩 열어 보고 비어 있는 것을
 * 확인하게 된다. 파일 주소(서명 URL)는 상세에만 있고 목록은 있다/없다만 안다.
 */
function AttachmentBadges({ item }) {
  if (!item.hasPhoto && !item.hasData) {
    return <span className="text-xs text-muted-foreground">없음</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {item.hasPhoto && (
        <Badge variant="secondary">
          <ImageIcon />
          사진
        </Badge>
      )}
      {item.hasData && (
        <Badge variant="outline">
          <FileJson />
          판독결과
        </Badge>
      )}
    </div>
  );
}

export default function ScorecardReports() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 「더 보기」를 연달아 누르면 늦게 도착한 응답이 최신 목록을 덮을 수 있다.
  const requestIdRef = useRef(0);

  /**
   * userId → 불러온 목록 안의 건수.
   *
   * 같은 사람이 쏟아 낸 것을 알아보는 자리다. ⚠ **불러온 범위 안에서만 센다** —
   * 서버에 사용자별 집계도, 거르기 쿼리도 없다. 그래서 배지 문구도 「불러온 N건」이라고
   * 적는다. 「이 사용자 N건」처럼 쓰면 부분 집계가 전체인 양 읽힌다.
   */
  const sameUserCounts = useMemo(() => {
    const counts = new Map();
    for (const item of items) {
      if (!item.userId) continue;
      counts.set(item.userId, (counts.get(item.userId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  /** cursor 가 없으면 처음부터, 있으면 뒤에 이어 붙인다. */
  const load = useCallback(async (cursor) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (cursor) setLoadingMore(true);
    else setLoading(true);

    try {
      const result = await fetchScorecardReports({ cursor });
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
      toast.error(readErrorMessage(error, '판독결과 목록을 불러오지 못했습니다.'));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    load(undefined);
  }, [load]);

  const openDetail = (reportId) => navigate(`/scorecard-reports/${reportId}`);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        앱이 스코어카드를 가져올 때마다 사진과 판독 결과를 자동으로 보냅니다. 사람이 쓴
        글이 아니므로 답변하는 자리가 아니고, 판독을 고칠 자료를 꺼내 쓰는 자리입니다.
        앱에서 보낸 의견은{' '}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0"
          onClick={() => navigate('/suggestions')}
        >
          「의견보내기」
        </Button>
        에 따로 쌓입니다.
      </p>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <ScanText className="size-4 text-primary" />
          <h3 className="text-sm font-bold">자동 전송 목록</h3>
          {/*
            필터바를 세우지 않는 까닭은 머리 주석에 적었다. 그 대신 운영자가 기대를
            잘못 갖지 않도록 한 줄로 밝힌다.
          */}
          <span className="ml-auto text-xs text-muted-foreground">
            최근에 온 것부터 · 거르기 조건은 없습니다
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-72 pl-5">기기</TableHead>
              <TableHead className="w-40">보낸 때</TableHead>
              <TableHead className="w-40">첨부</TableHead>
              <TableHead className="pr-5">한 줄</TableHead>
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
                  자동으로 전송된 판독결과가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const parts = describeDevice(item.device);
                const sameUser = sameUserCounts.get(item.userId) ?? 0;

                return (
                  <TableRow
                    key={item.reportId}
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => openDetail(item.reportId)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      openDetail(item.reportId);
                    }}
                  >
                    {/*
                      기기가 첫 열인 까닭 — 같은 사진이 아이폰 Vision 에서는 177블록,
                      안드로이드 ML Kit 에서는 74블록이라 엔진이 갈리면 새는 자리도
                      갈린다. 고치는 사람이 가장 먼저 보는 값이다.
                      device 는 옛 앱이 올린 건에서 null 이다(계약이 그렇게 허용한다).
                    */}
                    <TableCell className="py-3 pl-5">
                      {parts.length > 0 ? (
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                          <span className="font-medium">
                            {item.device?.model || item.device?.platform}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {[item.device?.osVersion, item.device?.appVersion]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          기기 정보 없음
                        </span>
                      )}

                      {/* 사람 식별은 userId 앞자리로만 (→ USER_ID_HEAD) */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          title={item.userId}
                        >
                          {item.userId
                            ? `${item.userId.slice(0, USER_ID_HEAD)}…`
                            : '-'}
                        </span>
                        {sameUser > 1 && (
                          <Badge variant="outline" className="font-normal">
                            불러온 {sameUser}건
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="py-3 text-sm text-muted-foreground">
                      {/*
                        날짜만 적지 않고 시각까지 세운다 — 한 라운드에서 연달아 올라온
                        것인지(같은 사진 재시도) 다른 날 것인지를 분 단위로 봐야 가려진다.
                      */}
                      {formatDateTime(item.createdAt)}
                    </TableCell>

                    <TableCell className="py-3">
                      <AttachmentBadges item={item} />
                    </TableCell>

                    <TableCell className="py-3 pr-5">
                      {/*
                        note 는 비어 있는 것이 정상이다(자동 전송이라 사람이 쓴 글이 없다).
                        판독이 틀렸을 때 사용자가 덧붙인 한 줄만 여기 온다.
                      */}
                      {item.note ? (
                        <p className="line-clamp-2 max-w-xl text-sm whitespace-pre-wrap">
                          {item.note}
                        </p>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          (자동 전송)
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/*
          커서 페이지네이션. 응답에 total 이 없어 몇 페이지인지 셀 수 없으므로
          페이지 번호 대신 「더 보기」만 둔다.
        */}
        <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {loading
              ? '불러오는 중…'
              : `${items.length.toLocaleString()}건 표시 중`}
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

      {/*
        🔴 **삭제 버튼을 이 표에 두지 않았다.** 행 전체가 상세로 가는 링크라 그 안에 지우기를
        끼우면 한 손가락 차이로 사진과 판독 결과가 함께 사라진다(DELETE 는 되돌릴 수 없다).
        게다가 **쓸 자료인지 아닌지는 사진과 JSON 을 열어 본 뒤에야 알 수 있다** — 목록이
        아는 것은 파일이 있다/없다뿐이다. 그래서 지우는 손은 상세 한 곳에만 둔다.
      */}
      <p className="text-xs text-muted-foreground">
        쌓인 전송은 상세 화면에서 지웁니다. 회귀 자료로 옮겨 적은 건과 볼 것이 없는 건을
        지우지 않으면 자동 전송이라 끝없이 쌓입니다.
      </p>
    </div>
  );
}
