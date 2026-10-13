import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileJson,
  Loader2,
  ScanText,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/services/emoticonService';
import {
  deleteScorecardReport,
  describeDevice,
  fetchScorecardReport,
  formatDateTime,
  isNotFound,
  readErrorMessage,
} from '@/services/scorecardReportService';

const LIST_PATH = '/scorecard-reports';

/**
 * 스코어카드 OCR 자동 전송 상세.
 *
 * 운영자가 여기서 하는 일은 둘이다 — 사진과 판독 결과를 꺼내 회귀 자료
 * (birdieup-app 의 tests/fixtures/real/)로 옮겨 적고, 다 쓴 건을 지운다.
 *
 * 🔴 **파일 주소는 짧게 사는 서명 주소다**(계약 §10 / internal/medialinks 의 ReadTTL).
 * 그래서 이 화면은 **열 때마다 상세를 다시 읽는다** — 주소를 state 밖에 보관하지도,
 * 목록에서 미리 받아 두지도 않는다. 상세를 열어 두고 한참 뒤에 누르면 만료되는데,
 * 남은 시간을 화면에 세어 두는 쪽은 고르지 않았다(그 숫자를 맞추는 일이 또 생기고,
 * 열리는 동안에도 사람을 재촉한다). 열어 보고 안 되면 그 자리에서 다시 받는다.
 */
export default function ScorecardReportDetail() {
  const { reportId } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 서명 주소가 만료돼 사진이 안 열렸는지. 상세를 다시 받으면 풀린다.
  const [photoBroken, setPhotoBroken] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const detail = await fetchScorecardReport(reportId);
      setReport(detail);
      // 새 주소를 받았으니 깨짐 표시를 지운다.
      setPhotoBroken(false);
    } catch (error) {
      setReport(null);
      // 404 는 토스트 대신 전용 화면으로 안내한다 — 링크가 죽었을 때 흰 화면이 남으면 안 된다.
      if (isNotFound(error)) {
        setMissing(true);
      } else {
        toast.error(readErrorMessage(error, '판독결과를 불러오지 못했습니다.'));
      }
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    load();
  }, [load]);

  const attachment = report?.attachment ?? null;
  const device = attachment?.device ?? null;
  const deviceParts = describeDevice(device);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteScorecardReport(reportId);
      toast.success('판독결과를 삭제했습니다.');
      navigate(LIST_PATH);
    } catch (error) {
      // 404 는 이미 지워진 것이다(다른 창에서 지웠거나 두 번 눌렀다). 실패로 몰아세우면
      // 운영자가 지워지지 않은 줄 알고 계속 누르게 되므로, 사실대로 알리고 목록으로 보낸다.
      if (isNotFound(error)) {
        toast.message('이미 삭제된 판독결과입니다.');
        navigate(LIST_PATH);
        return;
      }
      toast.error(readErrorMessage(error, '판독결과를 삭제하지 못했습니다.'));
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  const backLink = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 rounded-xl text-muted-foreground"
      onClick={() => navigate(LIST_PATH)}
    >
      <ArrowLeft className="size-4" />
      목록으로
    </Button>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {backLink}
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-64 w-full" />
        </section>
      </div>
    );
  }

  if (missing || !report) {
    return (
      <div className="space-y-6">
        {backLink}
        <section className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-5 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <ScanText className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold">존재하지 않는 판독결과입니다.</p>
            <p className="text-sm text-muted-foreground">
              이미 삭제되었거나 주소가 잘못되었습니다.
            </p>
          </div>
          <Button
            type="button"
            className="rounded-xl font-bold"
            onClick={() => navigate(LIST_PATH)}
          >
            판독결과 목록으로
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <ScanText className="size-4 text-primary" />
          <h3 className="text-sm font-bold">자동 전송</h3>
          <Badge variant="secondary">스코어카드 판독</Badge>
          <span className="ml-auto text-sm text-muted-foreground">
            {formatDateTime(report.createdAt)}
          </span>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/*
            기기 정보가 맨 위다 — 같은 사진이 아이폰 Vision 에서는 177블록, 안드로이드
            ML Kit 에서는 74블록이라 엔진이 갈리면 새는 자리도 갈린다. 고치는 사람이
            가장 먼저 보는 값이다. device 는 옛 앱이 올린 건에서 null 이다.
          */}
          {deviceParts.length > 0 ? (
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {deviceParts.map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              기기 정보가 없습니다. 기기를 모르면 같은 실패를 재현할 수 없어, 이 건은
              회귀 자료로 쓰기 어렵습니다.
            </p>
          )}

          {/*
            userId 는 여기서만 통째로 보여 준다. 목록은 앞자리만 세운다(열을 먹는다).
            계약이 userName·phoneNo 를 일부러 싣지 않으므로, 같은 사람이 쏟아 낸 건을
            맞춰 보는 단서는 이 값뿐이다.
          */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">보낸 사람</span>
            <span className="font-mono text-xs break-all">
              {report.userId || '-'}
            </span>
          </div>

          {/* 한 줄(note) — 자동 전송이라 비어 있는 것이 정상이다 */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">한 줄</p>
            {report.note ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {report.note}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                덧붙인 글 없이 자동으로 전송된 건입니다.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 첨부 — 이 화면의 본체다. 둘 중 하나라도 없을 수 있다(계약이 null 을 허용한다) */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <FileJson className="size-4 text-primary" />
          <h3 className="text-sm font-bold">사진과 판독 결과</h3>
          {/*
            🔴 주소가 만료되면 사진도 내려받기도 열리지 않는다. 미리 세지 않고 다시
            받는 쪽을 골랐다(머리 주석) — 그 입구가 이 버튼이다.
          */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto h-auto p-0 text-muted-foreground"
            onClick={load}
          >
            주소 새로 받기
          </Button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {!attachment?.photo?.url && !attachment?.data?.url && (
            <p className="text-sm text-muted-foreground">
              꺼낼 파일이 없는 건입니다. 볼 것이 없으니 지워도 잃는 것이 없습니다.
            </p>
          )}

          {/* 사진 — 스코어카드라 작게 보면 쓸모가 없다. 눌러서 원본으로 연다 */}
          {attachment?.photo?.url &&
            (photoBroken ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
                <TriangleAlert className="size-4 shrink-0 text-destructive" />
                <span className="text-muted-foreground">
                  사진 주소가 만료되었습니다.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={load}
                >
                  다시 불러오기
                </Button>
              </div>
            ) : (
              <a
                href={attachment.photo.url}
                target="_blank"
                rel="noreferrer"
                className="block w-fit"
              >
                <img
                  src={attachment.photo.url}
                  alt="자동 전송된 스코어카드 사진"
                  className="max-h-96 rounded-xl border border-border object-contain"
                  onError={() => setPhotoBroken(true)}
                />
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  눌러서 원본 보기 · {formatBytes(attachment.photo.bytes)}
                </span>
              </a>
            ))}

          {/*
            판독 결과(JSON). 화면에 펼쳐 놓을 값이 아니다 — 이 파일이 그대로 birdieup-app
            의 회귀 자료(tests/fixtures/real/)가 되므로 **내려받는 것이 본래 용도**다.
            새 창으로 여는 길도 함께 둔다(블록 몇 개가 왔는지만 확인할 때 파일을 받지
            않아도 된다). 둘 다 방금 받은 주소를 그 자리에서 쓴다 — 만료되면 열리지 않으니
            위의 「주소 새로 받기」로 다시 받는다.
          */}
          {attachment?.data?.url && (
            <div className="flex flex-wrap items-center gap-4">
              <a
                href={attachment.data.url}
                target="_blank"
                rel="noreferrer"
                download
                className="inline-flex items-center gap-2 text-sm font-medium text-primary"
              >
                <Download className="size-4" />
                판독 결과 내려받기
                <span className="font-normal text-muted-foreground">
                  {formatBytes(attachment.data.bytes)}
                </span>
              </a>
              <a
                href={attachment.data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground"
              >
                <ExternalLink className="size-4" />
                새 창에서 보기
              </a>
            </div>
          )}
        </div>
      </section>

      {/*
        지우는 손은 이 한 곳이다(목록에는 두지 않았다 — ScorecardReports.jsx 꼬리 주석).
        자동 전송이라 지우지 않으면 끝없이 쌓이므로 거르는 자리가 반드시 있어야 하고,
        🔴 되돌릴 수 없으므로 확인창을 거친다.
      */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mr-auto space-y-0.5">
          <p className="text-sm font-bold">이 전송을 지웁니다</p>
          <p className="text-xs text-muted-foreground">
            회귀 자료로 옮겨 적었거나 볼 것이 없는 건을 지웁니다. 사진과 판독 결과가 함께
            사라지고 되돌릴 수 없습니다.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="rounded-xl font-bold"
          disabled={deleting}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-3.5" />
          삭제
        </Button>
      </section>

      <Dialog
        open={confirmOpen}
        onOpenChange={deleting ? undefined : setConfirmOpen}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert className="size-5 text-destructive" />
            </div>
            <DialogTitle className="text-center">
              판독결과를 삭제할까요?
            </DialogTitle>
            <DialogDescription className="text-center">
              <span className="font-mono text-xs break-all">{reportId}</span>
            </DialogDescription>
          </DialogHeader>

          {/*
            「대신 ○○」로 돌릴 안전한 길이 없다(비활성·보관 같은 상태가 계약에 없다).
            그래서 경고 문구만으로 끝내지 않고, 아직 꺼내지 않았을 수 있는 것을 짚는다.
          */}
          <div className="rounded-xl bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">
              사진과 판독 결과 파일이 함께 지워지고 되돌릴 수 없습니다. 회귀 자료로 쓸
              것이 남아 있으면 먼저 내려받으세요.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl font-bold"
              disabled={deleting}
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 rounded-xl font-bold"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />
      <p className="text-xs text-muted-foreground">
        파일 주소는 짧게만 살아 있습니다. 상세를 열어 둔 채 한참 뒤에 누르면 열리지 않으니
        그때는 「주소 새로 받기」를 누르세요.
      </p>
    </div>
  );
}
