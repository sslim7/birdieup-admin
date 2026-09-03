import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  MessageSquareHeart,
  Pencil,
  Send,
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  ANSWER_MAX_LENGTH,
  ANSWER_REQUIRED,
  answerSuggestion,
  errorCode,
  fetchSuggestion,
  formatDateTime,
  isNotFound,
  notifySuggestion,
  readErrorMessage,
} from '@/services/suggestionService';

const LIST_PATH = '/suggestions';

export default function SuggestionDetail() {
  const { suggestionId } = useParams();
  const navigate = useNavigate();

  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const detail = await fetchSuggestion(suggestionId);
      setSuggestion(detail);
      setEditing(false);
      setDraft(detail?.answer ?? '');
    } catch (error) {
      setSuggestion(null);
      // 404 는 토스트 대신 전용 화면으로 안내한다 — 링크가 죽었을 때 흰 화면이 남으면 안 된다.
      if (isNotFound(error)) {
        setMissing(true);
      } else {
        toast.error(readErrorMessage(error, '제안을 불러오지 못했습니다.'));
      }
    } finally {
      setLoading(false);
    }
  }, [suggestionId]);

  useEffect(() => {
    load();
  }, [load]);

  const hasAnswer = Boolean(suggestion?.answer);
  const notified = Boolean(suggestion?.notifiedAt);
  // 답변 전이면 항상 편집 상태다. 답변이 있으면 「수정」을 눌러야 열린다.
  const editorOpen = Boolean(suggestion) && (!hasAnswer || editing);

  const trimmedDraft = draft.trim();
  const draftValid =
    trimmedDraft.length >= 1 && draft.length <= ANSWER_MAX_LENGTH;

  /** 저장은 SMS 를 동반하므로 버튼에서 바로 실행하지 않고 확인 다이얼로그를 거친다. */
  const requestSave = () => {
    if (!draftValid) return;
    setConfirmOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await answerSuggestion(suggestionId, trimmedDraft);

      setSuggestion((prev) => ({
        ...prev,
        answer: result.answer,
        answeredAt: result.answeredAt,
        // 서버가 실린 값을 그대로 쓴다(발송 실패면 null). 시각을 추정하지 않는다.
        notifiedAt: result.notifiedAt,
      }));
      setEditing(false);

      if (result.notified) {
        toast.success('답변을 저장하고 문자를 보냈습니다.');
      } else {
        // 발송 실패는 답변 저장을 되돌리지 않는다. 성공 토스트를 띄우면 운영자가
        // 문자가 나간 줄 알고 넘어가 버리므로 경고로만 알리고 재발송 버튼을 남긴다.
        toast.warning(
          result.reason || '답변은 저장했지만 문자가 발송되지 않았습니다.'
        );
      }
    } catch (error) {
      toast.error(readErrorMessage(error, '답변을 저장하지 못했습니다.'));
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const handleNotify = async () => {
    setNotifying(true);
    try {
      const result = await notifySuggestion(suggestionId);
      // 발송 시각은 서버가 준 값만 쓴다.
      setSuggestion((prev) => ({ ...prev, notifiedAt: result.notifiedAt }));

      if (result.notified) {
        toast.success('문자를 다시 보냈습니다.');
      } else {
        toast.warning(result.reason || '문자가 발송되지 않았습니다.');
      }
    } catch (error) {
      // 버튼은 답변이 있을 때만 노출하지만, 다른 창에서 답변이 지워졌거나 화면이 낡았을 수
      // 있다. 이때는 문구만 바꾸는 것으로 끝내지 말고 상세를 다시 읽어 상태를 맞춘다.
      if (errorCode(error) === ANSWER_REQUIRED) {
        toast.error('답변이 저장되어 있지 않아 문자를 보낼 수 없습니다.');
        load();
      } else {
        toast.error(readErrorMessage(error, '문자를 재발송하지 못했습니다.'));
      }
    } finally {
      setNotifying(false);
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
          <Skeleton className="h-24 w-full" />
        </section>
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-32 w-full" />
        </section>
      </div>
    );
  }

  if (missing || !suggestion) {
    return (
      <div className="space-y-6">
        {backLink}
        <section className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-5 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <MessageSquareHeart className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold">존재하지 않는 제안입니다.</p>
            <p className="text-sm text-muted-foreground">
              이미 삭제되었거나 주소가 잘못되었습니다.
            </p>
          </div>
          <Button
            type="button"
            className="rounded-xl font-bold"
            onClick={() => navigate(LIST_PATH)}
          >
            제안 목록으로
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      {/* 제안 본문 */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <MessageSquareHeart className="size-4 text-primary" />
          <h3 className="text-sm font-bold">
            {suggestion.userName || '탈퇴한 회원'}
          </h3>
          {/* 전화번호는 상세에만 내려온다(목록에 개인정보를 뿌리지 않는다) */}
          {suggestion.phoneNo && (
            <span className="font-mono text-sm text-muted-foreground">
              {suggestion.phoneNo}
            </span>
          )}
          <span className="ml-auto text-sm text-muted-foreground">
            {formatDateTime(suggestion.createdAt)}
          </span>
        </div>

        {/* body 는 평문이고 줄바꿈만 산다. 마크다운으로 렌더하지 마라 */}
        <p className="px-5 py-5 text-sm leading-relaxed whitespace-pre-wrap">
          {suggestion.body || '(내용 없음)'}
        </p>
      </section>

      {/* 답변 */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <h3 className="text-sm font-bold">답변</h3>

          {!hasAnswer && <Badge variant="secondary">답변 대기</Badge>}
          {hasAnswer && !notified && (
            <Badge variant="destructive">문자 미발송</Badge>
          )}
          {hasAnswer && notified && <Badge>문자 발송 완료</Badge>}

          {hasAnswer && !editing && (
            <div className="ml-auto flex items-center gap-2">
              {/* 답변은 저장됐는데 문자가 안 나간 건은 여기서만 되살릴 수 있다 */}
              {!notified && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="rounded-xl"
                  disabled={notifying}
                  onClick={handleNotify}
                >
                  {notifying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  문자 재발송
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => {
                  setDraft(suggestion.answer ?? '');
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" />
                수정
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4 px-5 py-5">
          {editorOpen ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="suggestion-answer">답변 내용</Label>
                  <span
                    className={`text-xs ${
                      draft.length > ANSWER_MAX_LENGTH
                        ? 'font-medium text-destructive'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {draft.length.toLocaleString()} /{' '}
                    {ANSWER_MAX_LENGTH.toLocaleString()}자
                  </span>
                </div>
                <Textarea
                  id="suggestion-answer"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="제안에 대한 답변을 입력해 주세요."
                  className="min-h-40 rounded-xl"
                  aria-invalid={draft.length > ANSWER_MAX_LENGTH}
                />
                {draft.length > ANSWER_MAX_LENGTH && (
                  <p className="text-xs font-medium text-destructive">
                    답변은 {ANSWER_MAX_LENGTH.toLocaleString()}자를 넘을 수 없습니다.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="rounded-xl font-bold"
                  disabled={!draftValid || saving}
                  onClick={requestSave}
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {hasAnswer ? '답변 저장' : '답변 보내기'}
                </Button>
                {hasAnswer && (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      setDraft(suggestion.answer ?? '');
                    }}
                  >
                    취소
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {suggestion.answer}
              </p>
              <Separator />
              {/* 발송 시각은 서버가 준 notifiedAt 그대로다 — 답변일시와 다를 수 있다(재발송) */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>답변일시 {formatDateTime(suggestion.answeredAt)}</span>
                {notified ? (
                  <span>문자 발송일시 {formatDateTime(suggestion.notifiedAt)}</span>
                ) : (
                  <span className="font-medium text-destructive">
                    문자가 발송되지 않았습니다
                  </span>
                )}
              </div>
            </>
          )}

          {/* 로컬에서 문자가 안 왔다고 발송 실패로 오해하는 일을 막는다 */}
          <p className="text-xs text-muted-foreground">
            로컬 개발 환경(에뮬레이터)에서는 문자가 실제로 발송되지 않고 서버 로그에만
            남습니다.
          </p>
        </div>
      </section>

      {/* 저장 확인 — 저장이 곧 문자 발송이라는 사실을 누르기 전에 알린다 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
              <TriangleAlert className="size-5 text-primary" />
            </div>
            <DialogTitle className="text-center">답변을 저장할까요?</DialogTitle>
            <DialogDescription className="text-center">
              {hasAnswer
                ? '답변을 저장하면 제안자에게 문자가 다시 발송됩니다. 이전 답변은 이 내용으로 덮어써집니다.'
                : '답변을 저장하면 제안자에게 문자가 발송됩니다.'}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl font-bold"
              disabled={saving}
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              className="flex-1 rounded-xl font-bold"
              disabled={saving}
              onClick={handleSave}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              저장하고 문자 발송
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
