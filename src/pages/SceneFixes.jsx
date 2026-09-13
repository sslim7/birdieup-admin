import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Loader2, MapPinned, Search, Video, X } from 'lucide-react';
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
import SceneExtractDialog from '@/components/scenes/scene-extract-dialog';
import SceneFixDialog from '@/components/scenes/scene-fix-dialog';
import {
  SCENE_MISSING,
  SOURCE_TYPE_LABEL,
  fetchPendingScenes,
  formatKstDateTime,
  readErrorMessage,
  readSceneCoords,
  readSceneTakenLocal,
  sceneKey,
  sceneTitle,
} from '@/services/sceneService';

/**
 * 좌표·촬영일시가 없는 옛 첨부를 찾아 사람이 채워 넣는 화면.
 *
 * # 이 화면은 임시 도구다
 *
 * 예전 앱은 업로드할 때 **사진의** EXIF 를 떼고 저장했다. 그래서 옛 사진에는 좌표도 촬영일시도
 * 없고, 자동으로 되살릴 원본이 어디에도 남아 있지 않다. 남은 방법이 "찍은 사람이 기억하는
 * 자리를 손으로 찍어 넣는 것"뿐이라 만든 보정용 화면이고, 보정이 끝나면 쓸 일이 줄어든다.
 *
 * ⚠ **동영상만은 예외다.** 원본 그대로 올라가 파일 안에 좌표가 남아 있어서, 서버가 꺼내
 *   채울 수 있다(「동영상에서 자동으로 찾기」 → scene-extract-dialog). 같은 글의 사진에도
 *   함께 옮겨 적히므로, 손으로 찍는 일을 가장 크게 줄이는 길이다. **먼저 그것부터 돌려라.**
 *
 * 나머지는 일부러 단순하게 두었다 — 정렬도, 손보정의 일괄 처리도 없다. 여기에 기능을 얹기
 * 전에 "이 화면이 반년 뒤에도 있을까"를 먼저 생각하라.
 *
 * # 페이지네이션
 *
 * 서버가 커서 방식이라(계약: `nextCursor`) total 도 오프셋도 없다. 페이지 번호 UI 를
 * 흉내 내지 말고 「더 보기」로 이어 붙이기만 한다. 활동 로그(AuditLogs)의 page/total
 * 코드를 베끼면 안 된다 — 그쪽만 예외다.
 */

/** 미리보기 / 원본 / 작성자 / 올린 날 / 빠진 것 */
const COLUMN_COUNT = 5;

/**
 * 검색어를 서버에 보내기까지 기다리는 시간(ms).
 *
 * 🔴 타자마다 보내면 안 된다. 이 조회는 색인을 타지 못하고 **문서를 훑는다**(계약 §9.1) —
 * 한 글자에 한 번씩 부르면 한 단어를 치는 동안 수백 건 읽기가 그 횟수만큼 일어난다.
 * 활동 로그의 검색칸과 같은 값이다(AuditLogs.DEBOUNCE_MS).
 */
const SEARCH_DEBOUNCE_MS = 300;

/** 필터 세그먼트. 값은 서버 쿼리(missing)와 같아야 한다. */
const MISSING_SEGMENTS = [
  { value: SCENE_MISSING.ANY, label: '전체' },
  { value: SCENE_MISSING.LOCATION, label: '위치 없음' },
  { value: SCENE_MISSING.TIME, label: '촬영일 없음' },
  // 「보정 완료」는 빠진 것을 찾는 갈래가 아니라 **되돌리는 통로다.** 사람이 찍어 넣은
  // 좌표(locationSource="manual")만 오고, 여기서만 잘못 넣은 값을 다시 열어 고치거나 비운다.
  // 저장하고 나면 그 장면은 나머지 갈래에서 빠지므로, 이 갈래가 없으면 손댈 길이 없다.
  { value: SCENE_MISSING.FIXED, label: '보정 완료' },
];

/**
 * 마지막 칸에 세울 것.
 *
 * 「보정 완료」에서는 모든 행이 다 채워져 있어서 「빠진 것」 칸이 같은 말만 되풀이한다.
 * 그 화면에서 운영자가 하려는 일은 "내가 찍어 넣은 값이 맞나" 를 훑는 것이므로, 같은 자리에
 * **지금 들어 있는 값**을 세운다. 표를 두 벌로 가르지 않고 칸 하나만 바꾸는 이유는, 나머지
 * 칸(사진·원본·작성자·올린 날)이 두 갈래에서 똑같이 필요하기 때문이다.
 */
function SceneValueCell({ scene }) {
  const coords = readSceneCoords(scene);
  const takenLocal = readSceneTakenLocal(scene);

  // 값이 목록에 실려 오지 않는 동안(계약 확정 전)에는 빈 칸 대신 사정을 적는다 —
  // 빈 칸은 "값이 지워졌다" 로 읽힌다.
  if (!coords && !takenLocal) {
    return <span className="text-xs text-muted-foreground">열어서 확인</span>;
  }

  return (
    <div className="space-y-0.5">
      {coords && (
        <p className="font-mono text-xs">
          {coords.latitude.toFixed(6)}, {coords.longitude.toFixed(6)}
        </p>
      )}
      {/* 🔴 takenLocal 은 시간대 없는 벽시계라 KST 변환기(formatKstDateTime)를 태우지 않는다.
          적힌 글자를 그대로 보여 주는 것이 사실에 맞다. */}
      {takenLocal && <p className="text-xs text-muted-foreground">{takenLocal} 촬영</p>}
    </div>
  );
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

/** 썸네일. 영상이거나 썸네일이 없을 때도 칸 크기가 흔들리지 않게 같은 상자를 쓴다. */
function ScenePreview({ scene }) {
  const isVideo = scene.mediaKind === 'video';
  return (
    <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
      {scene.thumbUrl ? (
        <img src={scene.thumbUrl} alt="" className="size-full object-cover" />
      ) : isVideo ? (
        <Video className="size-5 text-muted-foreground" />
      ) : (
        <ImageOff className="size-5 text-muted-foreground" />
      )}
    </div>
  );
}

export default function SceneFixes() {
  const [missing, setMissing] = useState(SCENE_MISSING.ANY);
  /*
   * 검색어가 둘인 이유. searchInput 은 **칸에 보이는 글자**이고, search 는 **지금 목록이 선
   * 조건**이다(디바운스를 거친 값). 하나로 합치면 타자마다 조회가 나가고, 그 조회는 문서를
   * 훑는 일이라 값이 비싸다(§SEARCH_DEBOUNCE_MS).
   *
   * 목록에 실린 것은 언제나 search 쪽이므로, "없습니다" 문구에 넣을 검색어도 search 다 —
   * 입력 중인 글자를 문구에 넣으면 아직 찾아보지도 않은 말로 "없다"고 말하게 된다.
   */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingScene, setEditingScene] = useState(null);
  const [extractOpen, setExtractOpen] = useState(false);

  const isFixedView = missing === SCENE_MISSING.FIXED;

  // 요청 세대 번호. 「더 보기」로 이어 붙이는 중에 목록을 처음부터 다시 불러오면
  // 늦게 온 옛 응답이 새 목록 뒤에 붙어 중복 행이 생긴다. 그 응답을 버리기 위한 장치다.
  const requestIdRef = useRef(0);

  /*
   * 검색어 디바운스. 멈춘 뒤에야 search 가 바뀌고, search 는 reload 의 의존성이라 그때
   * 첫 장부터 다시 받는다(커서는 조건과 한 쌍이다 — 계약 §9.1).
   *
   * ⚠ 여기서 items 를 비우지 않는다. 지웠다가 되돌려 친 경우처럼 **값이 그대로면** search 가
   * 바뀌지 않아 reload 가 돌지 않는데, 그때 목록만 비워 두면 빈 화면이 그대로 굳는다.
   * reload 가 곧바로 skeleton 을 세우므로(loading) 옛 행이 보이는 시간도 없다.
   */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /**
   * 지금 필터로 첫 장부터 다시 불러온다.
   *
   * 저장·비우기 뒤에도, 필터가 바뀌었을 때도 전부 이 경로로 되돌린다. **커서는 필터와 한
   * 쌍이라** 조건이 바뀌면 옛 커서를 버리고 처음부터 받아야 한다.
   */
  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    try {
      const { items: page, nextCursor: cursor } = await fetchPendingScenes({ missing, q: search });
      if (requestIdRef.current !== requestId) return;
      setItems(page);
      setNextCursor(cursor);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setItems([]);
      setNextCursor(null);
      toast.error(readErrorMessage(error, '보정할 장면 목록을 불러오지 못했습니다.'));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [missing, search]);

  // missing·search 가 reload 의 의존성이라 조건이 바뀌면 이 효과가 알아서 첫 장을 다시 받는다.
  useEffect(() => {
    reload();
  }, [reload]);

  /** 다음 장을 뒤에 이어 붙인다. */
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;

    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor: cursor } = await fetchPendingScenes({
        cursor: nextCursor,
        // 커서만 보내고 조건을 빠뜨리면 서버가 조건 없는 뒷장을 내려줄 수 있다. 항상 함께 보낸다.
        missing,
        q: search,
      });
      // 그 사이 reload 가 돌았다면 이 응답은 이미 버린 목록의 뒷장이다.
      if (requestIdRef.current !== requestId) return;
      setItems((prev) => [...prev, ...page]);
      setNextCursor(cursor);
    } catch (error) {
      toast.error(readErrorMessage(error, '다음 목록을 불러오지 못했습니다.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const openEditor = (scene) => {
    setEditingScene(scene);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          좌표나 촬영일시가 없는 옛 첨부를 찾아 손으로 채웁니다.
        </p>
        <p className="text-xs text-muted-foreground">
          예전에는 업로드할 때 사진의 EXIF 가 지워져, 찍은 자리와 시각을 자동으로 되살릴 방법이
          없습니다. 사진을 보고 기억나는 값을 넣어 주세요. 다만 <b>동영상은 원본 그대로 올라가
          파일 안에 좌표가 남아 있어</b>, 「동영상에서 자동으로 찾기」로 한꺼번에 채울 수 있습니다.
          잘못 넣었다면 「보정 완료」에서 다시 열어 고치거나 비울 수 있습니다.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <div className="mr-auto flex items-center gap-2">
            <MapPinned className="size-4 text-primary" />
            <h3 className="text-sm font-bold">보정이 필요한 장면</h3>
          </div>

          {/* 손으로 찍는 일을 가장 크게 줄이는 길이라 목록 위에 세운다. 누르면 먼저 훑어
              보여 주기만 하고(쓰지 않는다), 승인해야 채운다 — 그래서 확인 없이 눌러도 안전하다. */}
          <Button
            type="button"
            variant="outline"
            className="rounded-xl font-bold"
            onClick={() => setExtractOpen(true)}
          >
            <Video className="size-4" />
            동영상에서 자동으로 찾기
          </Button>

          {/* 선택지가 넷뿐이고 '입력 중' 상태가 없어서 누르는 즉시 조회한다.
              🔴 누르는 순간 **앞 갈래의 목록과 커서를 먼저 버린다.** reload 는 효과에서 한 박자
                 뒤에 돌기 때문에, 비우지 않으면 그 사이 새 탭이 눌린 채 앞 갈래의 행이 그대로
                 보인다 — 「위치 없음인데 있는 것도 섞여 있다」로 읽히는 자리다. 커서도 함께
                 버린다(커서는 missing 과 한 쌍이다). */}
          <div className="flex items-center rounded-xl border border-border p-0.5">
            {MISSING_SEGMENTS.map((segment) => {
              const active = missing === segment.value;
              return (
                <button
                  key={segment.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (missing === segment.value) return;
                    setItems([]);
                    setNextCursor(null);
                    setMissing(segment.value);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {segment.label}
                </button>
              );
            })}
          </div>

          {/*
            🔴 **w-full 이라 언제나 윗줄에서 떨어진다.** 이 줄에는 이미 「동영상에서 자동으로
               찾기」 버튼과 갈래 넷이 서 있어서, 입력칸까지 한 줄에 세우면 좁은 화면에서
               글자 몇 자만 보이는 칸이 된다. flex-wrap 이 걸린 줄이므로 폭만 채우면 된다.
            🔴 **어떤 경우에도 disabled 를 붙이지 마라.** 조회 중에도 계속 칠 수 있어야 한다 —
               이 목록은 훑기라 한 번에 몇 초씩 걸리는데, 그동안 칸이 잠기면 운영자는 글자를
               잃는다. 늦게 온 응답은 requestIdRef 가 버리므로 잠글 이유도 없다.
          */}
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="골프장이름이나 생활피드제목으로 검색하세요"
              className="h-9 rounded-xl pl-8 pr-9 text-sm"
              aria-label="골프장 이름·생활피드 제목으로 검색"
            />
            {/* 지우기. 디바운스를 기다리지 않고 search 까지 함께 비운다 — 지우는 동작은
                "원래 목록으로 돌아가기"라 300ms 를 기다릴 이유가 없다. 뒤늦게 타이머가
                같은 빈 값을 넣어도 상태가 그대로라 다시 조회되지 않는다. */}
            {searchInput && (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => {
                  setSearchInput('');
                  setSearch('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 pl-5">미리보기</TableHead>
              <TableHead>원본</TableHead>
              <TableHead className="w-40">작성자</TableHead>
              <TableHead className="w-44">올린 날</TableHead>
              <TableHead className="w-52 pr-5">{isFixedView ? '지금 값' : '빠진 것'}</TableHead>
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
                  {/* 🔴 이 조회는 색인이 아니라 **훑기**라, 한 번에 읽는 문서 수를 다 쓰면
                      0건인 채로 돌아오고도 뒤에 더 남아 있다(계약 §9.1). 그때 "없습니다" 로
                      끝맺으면 운영자가 보정이 끝난 줄 알고 화면을 닫는다 — 커서가 남아 있으면
                      아직 끝이 아니라고 말해야 한다.
                      끝까지 훑은 경우에도 필터 탓의 0건과 정말 다 채운 것을 갈라 적는다. */}
                  {/* 검색 중에는 그 말이 더 중요해진다. 검색어를 넣어 말하지 않으면 운영자는
                      "이 골프장은 없구나" 로 읽고 검색을 접는데, 사실은 **이 구간에** 없을
                      뿐이고 다음 구간에 있을 수 있다(훑기 예산 — 계약 §9.1). */}
                  {nextCursor
                    ? search
                      ? `'${search}' 는 이 구간에 없습니다. 아래 「더 보기」로 계속 찾을 수 있어요.`
                      : '이 구간에는 없습니다. 아래 「더 보기」로 계속 찾을 수 있어요.'
                    : search
                      ? `'${search}' 에 해당하는 장면을 찾지 못했습니다.`
                      : isFixedView
                        ? '손으로 보정한 장면이 아직 없습니다.'
                        : missing === SCENE_MISSING.ANY
                          ? '보정할 장면이 없습니다.'
                          : '이 조건에 해당하는 장면이 없습니다.'}
                </TableCell>
              </TableRow>
            ) : (
              items.map((scene) => {
                const name = (scene.sourceName ?? '').trim();
                const typeLabel = SOURCE_TYPE_LABEL[scene.sourceType] ?? scene.sourceType;

                return (
                  <TableRow
                    key={sceneKey(scene)}
                    // 행 전체가 보정 진입점이다. 키보드로도 열 수 있어야 해서 role/tabIndex 를 준다.
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => openEditor(scene)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEditor(scene);
                      }
                    }}
                  >
                    <TableCell className="py-3 pl-5">
                      <ScenePreview scene={scene} />
                    </TableCell>
                    <TableCell className="py-3">
                      {/* 이름이 비어 있으면(골프장을 안 적은 라운드) 유형만 세운다. */}
                      <p className="truncate text-sm font-medium">{sceneTitle(scene)}</p>
                      {name && <p className="text-xs text-muted-foreground">{typeLabel}</p>}
                    </TableCell>
                    <TableCell className="py-3 text-sm">
                      {scene.authorName || '-'}
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground tabular-nums">
                      {formatKstDateTime(scene.uploadedAt)}
                    </TableCell>
                    <TableCell className="py-3 pr-5">
                      {isFixedView ? (
                        <SceneValueCell scene={scene} />
                      ) : (
                      <div className="flex flex-wrap gap-1">
                        {/* 목록에 있는 장면은 전부 뭔가 빠져 있다. 빨간 경고색을 쓰면 모든 행이
                            사고처럼 보이므로, 두 종류를 구분할 만큼만 색을 달리한다. */}
                        {!scene.hasLocation && (
                          <Badge className="border-0 bg-rose-50 font-normal text-rose-600">
                            위치 없음
                          </Badge>
                        )}
                        {!scene.hasTakenAt && (
                          <Badge className="border-0 bg-amber-50 font-normal text-amber-600">
                            촬영일 없음
                          </Badge>
                        )}
                        {/* 둘 다 있는 행이 섞여 오는 경우(필터 밖에서 이미 채운 장면) */}
                        {scene.hasLocation && scene.hasTakenAt && (
                          <Badge variant="outline">채워짐</Badge>
                        )}
                      </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* nextCursor 가 없으면 마지막 장이다. 버튼을 남겨 두면 누를 게 없는 버튼이 된다. */}
        {!loading && nextCursor && (
          <div className="flex justify-center border-t border-border px-5 py-4">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl font-bold"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore && <Loader2 className="size-4 animate-spin" />}
              더 보기
            </Button>
          </div>
        )}
      </section>

      <SceneFixDialog
        scene={editingScene}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        // 저장·비우기 뒤에는 첫 장부터 다시 받는다. 커서 방식이라 "그 행만 지우면" 남은
        // 커서가 가리키는 지점과 목록이 어긋난다.
        onSaved={reload}
      />

      {/* 채운 장면은 pending 에서 빠지므로 적용 뒤에는 목록을 첫 장부터 다시 받는다. */}
      <SceneExtractDialog
        open={extractOpen}
        onOpenChange={setExtractOpen}
        onApplied={reload}
      />
    </div>
  );
}
