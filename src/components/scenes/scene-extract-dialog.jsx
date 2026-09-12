import { useCallback, useEffect, useState } from 'react';
import { Loader2, MapPin, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  extractSceneLocations,
  readErrorMessage,
  sceneKey,
  sceneTitle,
} from '@/services/sceneService';

/**
 * 「동영상에서 자동으로 찾기」 — 훑어 보여 주고, 사람이 승인하면 적용한다.
 *
 * # 왜 이 버튼이 값진가
 *
 * 옛 **사진**은 업로드 때 재인코딩되며 EXIF 가 날아갔고 원본에도 남아 있지 않다 — 되살릴 수
 * 없다. 그런데 **동영상은 원본 그대로 올라가서 파일 안에 촬영 좌표가 남아 있다.** 게다가 같은
 * 글에 함께 올린 사진은 같은 순간·같은 자리의 것이라, 동영상에서 꺼낸 좌표를 옆 사진에 옮겨
 * 적는 것이 몇 해 지난 사람 기억보다 정확하다. 한 번 돌릴 때마다 손으로 찍어야 할 장면이
 * **글 단위로** 줄어든다 — 이 화면에서 제일 품이 덜 드는 길이다.
 *
 * # 왜 두 번에 나눠 부르는가
 *
 * 좌표를 채우는 것은 **되돌리기 어려운 쓰기다**(되돌리려면 「보정 완료」에서 한 건씩 비워야
 * 한다). 그래서 먼저 `dryRun: true` 로 "무엇을 채울 것인지"를 받아 보여 주고, 사람이 그 목록을
 * 보고 승인해야 `dryRun: false` 로 실제로 적용한다.
 *
 * # 왜 구간(커서)마다 커서를 들고 있는가
 *
 * 서버는 한 번에 전부 훑지 않고 커서로 구간을 나눠 준다. **미리 본 것을 그대로 적용하려면
 * 적용 호출도 같은 커서로 같은 구간을 지나야 한다.** 그래서 훑은 페이지마다 "그 페이지를
 * 받을 때 보낸 커서"를 함께 들고 있다가, 적용할 때 그 커서들을 **순서대로 다시 밟는다.**
 * 커서를 버리고 한 번에 적용하면 처음 구간만 채워지고, 「더 찾기」로 본 뒷구간은 말없이 빠진다.
 *
 * 같은 구간을 두 번 지나도 안전하다 — 이 작업은 **멱등이다.** 이미 좌표가 있는 첨부는 훑기
 * 대상에서 빠지므로, 미리보기로 한 번 지나간 자리를 적용이 다시 지나도 같은 것을 두 번 쓰지 않는다.
 */

/** 한 줄. 서버가 찾은 좌표와 "이 글의 사진 몇 장이 함께 채워지는지"를 같이 세운다. */
function ExtractItemRow({ item }) {
  const latitude = Number(item?.latitude);
  const longitude = Number(item?.longitude);
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
  const siblings = Number(item?.siblingPhotos) || 0;

  return (
    <li className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
      <Video className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{sceneTitle(item)}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {/* 좌표가 빠진 항목이 섞여 와도 줄을 지우지 않는다 — 무엇이 왜 안 채워지는지
              보이지 않으면 개수만 안 맞는 것으로 읽힌다. */}
          {hasCoords ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : '좌표 없음'}
        </p>
        {item?.takenLocal && (
          <p className="text-xs text-muted-foreground">{item.takenLocal} 촬영</p>
        )}
      </div>
      {siblings > 0 && (
        <Badge variant="outline" className="shrink-0 font-normal">
          사진 {siblings}장 함께
        </Badge>
      )}
    </li>
  );
}

export default function SceneExtractDialog({ open, onOpenChange, onApplied }) {
  /** 훑은 구간들. `cursor` 는 **그 구간을 받을 때 보낸 값**이다(첫 구간은 null). */
  const [pages, setPages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  /** 적용이 끝난 뒤의 결과. null 이면 아직 훑어보는 중이다. */
  const [result, setResult] = useState(null);

  const items = pages.flatMap((page) => page.items);
  const scanned = pages.reduce((sum, page) => sum + page.scanned, 0);
  const found = pages.reduce((sum, page) => sum + page.found, 0);
  const photosFilled = pages.reduce((sum, page) => sum + page.photosFilled, 0);

  /**
   * 한 구간을 훑는다(쓰지 않는다).
   * 🔴 `dryRun: true` 를 **명시**해서 보낸다 — 서버 기본값에 기대지 않는다.
   */
  const scan = useCallback(async (cursor) => {
    setScanning(true);
    try {
      const page = await extractSceneLocations({ dryRun: true, cursor });
      setPages((prev) => [
        ...prev,
        {
          cursor: cursor ?? null,
          scanned: page.scanned,
          found: page.found,
          photosFilled: page.photosFilled,
          items: page.items,
        },
      ]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      toast.error(readErrorMessage(error, '동영상을 훑지 못했습니다.'));
      // 실패한 구간은 목록에 넣지 않는다. 없는 것을 적용 대상으로 세면 안 된다.
    } finally {
      setScanning(false);
    }
  }, []);

  // 버튼을 눌러 열자마자 첫 구간을 훑는다. 여기서 「훑기」를 한 번 더 누르게 하면
  // 누를 것만 늘고 알게 되는 것은 없다.
  useEffect(() => {
    if (!open) return;
    setPages([]);
    setNextCursor(null);
    setResult(null);
    scan(undefined);
  }, [open, scan]);

  /**
   * 승인. 훑은 구간을 **같은 커서로 순서대로** 다시 지나며 실제로 채운다.
   *
   * 도중에 한 구간이 실패해도 앞 구간은 이미 채워진 상태다. 그래서 실패를 알리되 목록은
   * 반드시 다시 읽게 한다 — 화면과 실제가 어긋난 채로 두는 것이 가장 나쁜 결말이다.
   *
   * ⚠ 값을 치르는 구석: 서버는 훑을 때마다 동영상 **파일을 내려받아** 읽는다(몇 MB짜리다).
   *   미리보기와 적용이 나뉘어 있으니 같은 파일을 두 번 읽는다. 그래도 되돌리기 어려운 쓰기를
   *   눈으로 확인하고 누르는 값이 더 크다고 보고 이 구조를 택했다.
   */
  const apply = async () => {
    if (applying || pages.length === 0 || found === 0) return;

    setApplying(true);
    let videosTotal = 0;
    let photosTotal = 0;
    let failed = null;

    try {
      // 🔴 순서대로, 하나씩. 병렬로 던지면 같은 글을 두 요청이 동시에 고칠 수 있다.
      for (const page of pages) {
        // eslint-disable-next-line no-await-in-loop
        const done = await extractSceneLocations({ dryRun: false, cursor: page.cursor });
        // 🔴 `applied` 는 **개수가 아니라 참/거짓**이다(실제로 썼는지). 채운 동영상 수는 `found` 다.
        //    쓰지 않았다고 답한 구간까지 세면 화면이 하지도 않은 일을 했다고 말한다.
        if (!done.applied) continue;
        videosTotal += done.found;
        photosTotal += done.photosFilled;
      }
    } catch (error) {
      failed = readErrorMessage(error, '적용하지 못했습니다.');
    }

    setApplying(false);
    setResult({ videos: videosTotal, photosFilled: photosTotal });
    // 훑어 둔 구간은 이미 적용했다. 그대로 두면 「적용」을 또 누를 수 있게 된다.
    setPages([]);

    if (failed) toast.error(failed);
    else toast.success(`동영상 ${videosTotal}건에 위치를 채웠습니다.`);

    // 채운 장면은 pending 에서 빠진다. 성공이든 부분 실패든 목록을 다시 읽는다.
    onApplied();
  };

  /** 이어서 다음 구간을 훑는다. 적용을 마친 뒤라면 결과 화면을 접고 새로 훑는다. */
  const scanMore = () => {
    if (!nextCursor || scanning || applying) return;
    setResult(null);
    scan(nextCursor);
  };

  const busy = scanning || applying;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>동영상에서 위치 찾기</DialogTitle>
          <DialogDescription>
            동영상은 원본 그대로 올라가 파일 안에 찍은 자리가 남아 있습니다. 같은 글에 올린
            사진에도 그 좌표를 함께 채웁니다.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // ── 적용 결과 ─────────────────────────────────────
          <div className="space-y-2">
            <p className="text-sm font-medium">
              동영상 {result.videos}건에 위치를 채웠습니다.
            </p>
            <p className="text-sm text-muted-foreground">
              같은 글의 사진 {result.photosFilled}장에도 함께 채웠습니다.
            </p>
            {nextCursor && (
              <p className="text-xs text-muted-foreground">
                아직 훑지 않은 구간이 남아 있습니다. 「이어서 더 찾기」로 계속할 수 있어요.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {scanning && pages.length === 0 ? (
              <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                동영상을 훑는 중…
              </p>
            ) : (
              <>
                <p className="text-sm">
                  동영상 <b>{scanned}</b>개를 훑어 <b>{found}</b>개에서 위치를 찾았습니다.
                  {photosFilled > 0 && <> 같은 글의 사진 <b>{photosFilled}</b>장에도 함께 채웁니다.</>}
                </p>

                {items.length > 0 ? (
                  <ul className="max-h-72 overflow-y-auto rounded-xl border border-border">
                    {items.map((item) => (
                      <ExtractItemRow key={sceneKey(item)} item={item} />
                    ))}
                  </ul>
                ) : (
                  // 🔴 빈 구간이 와도 끝이 아니다(계약 §9.1 의 훑기 특성). 커서가 남아 있으면
                  //    "없다"로 끝맺지 말고 계속 누를 수 있다고 말해야 한다.
                  <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    {nextCursor
                      ? '이 구간에서는 찾지 못했습니다. 「더 찾기」로 계속 훑을 수 있어요.'
                      : '위치를 꺼낼 수 있는 동영상이 없습니다.'}
                  </p>
                )}

                {found > 0 && (
                  <p className="text-xs text-muted-foreground">
                    아직 아무것도 바뀌지 않았습니다. 「적용」을 눌러야 실제로 채웁니다.
                    채운 좌표를 되돌리려면 「보정 완료」에서 한 건씩 비워야 합니다.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <Separator />

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl font-bold"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {result ? '닫기' : '취소'}
          </Button>

          {/* 한 번에 전부 훑지 않는다 — 남은 구간이 있을 때만 이어 가는 버튼을 세운다. */}
          {nextCursor && (
            <Button
              type="button"
              variant="outline"
              className="rounded-xl font-bold"
              onClick={scanMore}
              disabled={busy}
            >
              {scanning && <Loader2 className="size-4 animate-spin" />}
              {result ? '이어서 더 찾기' : '더 찾기'}
            </Button>
          )}

          {!result && (
            <Button
              type="button"
              className="rounded-xl font-bold"
              onClick={apply}
              disabled={busy || found === 0}
            >
              {applying ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
              적용
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
