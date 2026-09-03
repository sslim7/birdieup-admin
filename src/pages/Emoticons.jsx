import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  GripVertical,
  ImageOff,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Smile,
  Trash2,
  UserRoundPlus,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import emoticonService, {
  ALLOWED_IMAGE_TYPES,
  EMOTICON_ID_RULE_TEXT,
  MAX_IMAGE_BYTES,
  formatBytes,
  isValidEmoticonId,
  readErrorCode,
  readErrorMessage,
  validateImageFile,
} from '@/services/emoticonService';

/** 파일 선택창에 넘길 accept 문자열. 서버가 받는 타입과 같은 목록에서 만든다. */
const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(',');

/**
 * 이모티콘 id 는 **만들 때 한 번만** 정할 수 있다는 것을 화면 곳곳에서 같은 문장으로 알린다.
 * 피드 문서에 남는 것은 emoticonId 하나뿐이라 id 를 바꾸면 그 id 를 쓴 과거 피드가
 * 이모티콘을 찾지 못하고 빈 칸이 된다.
 */
const ID_IMMUTABLE_HELP =
  'id 는 만든 뒤 바꿀 수 없어요. 과거 피드가 이 id 로 그림을 찾기 때문입니다.';

/**
 * order 를 벌려 두는 간격.
 *
 * 드래그로 옮길 때 이웃 둘의 가운데 값을 주기 위한 여유다. 100 이면 같은 자리에
 * 연달아 끼워 넣어도 예닐곱 번은 버티고, 닳으면 그때 다시 벌린다.
 */
const ORDER_STEP = 100;

/**
 * order 상한. **서버의 maxOrder 와 같은 값이어야 한다**
 * (birdieup-was internal/emoticons/admin.go). 넘겨 보내면 400 이고
 * "정렬 순서는 0 이상 9999 이하 정수여야 해요" 가 돌아온다.
 *
 * 100 간격이면 99개까지 들어간다. 그보다 많아지면 간격을 좁혀서 맞춘다(renumberStep).
 */
const MAX_ORDER = 9999;

/**
 * 목록을 통째로 다시 벌릴 때 쓸 간격.
 *
 * 항목이 많으면 100 간격으로는 상한을 넘으므로 들어갈 만큼 좁힌다. 좁혀도 1 미만은
 * 될 수 없어 9999개까지가 한계이고, 그 앞에서 서버 상한에 먼저 걸린다.
 */
function renumberStep(count) {
  if (count <= 0) return ORDER_STEP;
  return Math.max(1, Math.min(ORDER_STEP, Math.floor(MAX_ORDER / count)));
}

/**
 * 새 항목의 기본 order. 뒤에 붙는 편이 기존 순서를 흔들지 않는다.
 * 상한을 넘기면 상한에 붙인다 — 같은 값이 되면 서버가 id 로 갈라 정렬하고,
 * 자리는 나중에 끌어서 잡으면 된다.
 */
function nextOrder(rows) {
  const max = rows.reduce((acc, row) => Math.max(acc, Number(row.order) || 0), 0);
  return Math.min(max + ORDER_STEP, MAX_ORDER);
}

/**
 * 이미지 파일 선택 + 미리보기.
 *
 * 미리보기는 objectURL 이라 반드시 revoke 한다 — 다이얼로그를 여러 번 여닫으면
 * 파일 핸들이 계속 쌓인다.
 */
function ImageField({ id, label, file, existingUrl, error, onPick }) {
  const [localPreview, setLocalPreview] = useState('');

  useEffect(() => {
    if (!file) {
      setLocalPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shown = localPreview || existingUrl || '';

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
          {shown ? (
            <img src={shown} alt="" className="size-full object-contain" />
          ) : (
            <ImageOff className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            id={id}
            type="file"
            accept={IMAGE_ACCEPT}
            className="h-9 rounded-xl text-sm file:mr-2 file:text-sm"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            PNG · JPG · WEBP, {formatBytes(MAX_IMAGE_BYTES)} 이하
            {existingUrl && !file ? ' · 고르지 않으면 기존 이미지를 그대로 씁니다' : ''}
          </p>
        </div>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/**
 * 이모티콘 생성/수정 공용 다이얼로그.
 *
 * PUT 이 upsert 라 서버는 "이미 있는 id" 를 거절하지 않는다. 새로 만들 때의 중복 검사를
 * 화면이 하지 않으면 남의 이모티콘을 조용히 덮어쓰게 되므로 existingIds 로 미리 막는다.
 */
function EmoticonFormDialog({
  open,
  onOpenChange,
  mode,
  emoticon,
  characterId,
  existingIds,
  defaultOrder,
  onSaved,
}) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState({ id: '', name: '', order: 1, active: true });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setErrors({});
    setSubmitError('');
    setSubmitting(false);
    if (isEdit && emoticon) {
      setForm({
        id: emoticon.id,
        name: emoticon.name ?? '',
        order: Number(emoticon.order) || 0,
        active: Boolean(emoticon.active),
      });
    } else {
      setForm({ id: '', name: '', order: defaultOrder, active: true });
    }
  }, [open, isEdit, emoticon, defaultOrder]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handlePick = (picked) => {
    if (!picked) {
      setFile(null);
      setErrors((prev) => ({ ...prev, image: undefined }));
      return;
    }
    const reason = validateImageFile(picked);
    if (reason) {
      setFile(null);
      setErrors((prev) => ({ ...prev, image: reason }));
      return;
    }
    setFile(picked);
    setErrors((prev) => ({ ...prev, image: undefined }));
  };

  const validate = () => {
    const next = {};
    const id = form.id.trim();

    if (!isEdit) {
      if (!id) next.id = 'id 를 입력해 주세요.';
      else if (!isValidEmoticonId(id)) next.id = EMOTICON_ID_RULE_TEXT;
      else if (existingIds.has(id))
        next.id = '이미 있는 id 입니다. 저장하면 기존 이모티콘을 덮어씁니다.';
    }

    if (!form.name.trim()) next.name = '이름을 입력해 주세요.';
    if (!Number.isInteger(Number(form.order))) next.order = '정수를 입력해 주세요.';
    else if (Number(form.order) < 0 || Number(form.order) > MAX_ORDER)
      next.order = `0 이상 ${MAX_ORDER} 이하여야 해요.`;

    // 그림이 없는 이모티콘은 서랍에서 아예 빠진다(서버가 imagePath 빈 행을 걸러 낸다).
    if (!file && !emoticon?.imagePath) next.image = '이미지를 선택해 주세요.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // 저장 버튼을 막는 조건. 규칙 위반 상태에서 눌러 보고 실패하는 왕복을 줄인다.
  const idBlocked =
    !isEdit &&
    (!form.id.trim() ||
      !isValidEmoticonId(form.id.trim()) ||
      existingIds.has(form.id.trim()));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    const id = isEdit ? emoticon.id : form.id.trim();
    setSubmitting(true);
    try {
      // 새 파일을 고르지 않았으면 기존 경로를 그대로 되돌려 보낸다. PUT 은 부분 수정이
      // 아니라서 imagePath 를 빼면 그림이 사라진다.
      const imagePath = file
        ? await emoticonService.uploadImage(file, { characterId, emoticonId: id })
        : emoticon?.imagePath;

      await emoticonService.saveEmoticon(id, {
        characterId,
        name: form.name.trim(),
        imagePath,
        order: Number(form.order),
        active: form.active,
      });

      toast.success(isEdit ? '이모티콘을 수정했습니다.' : '이모티콘을 추가했습니다.');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      const message = readErrorMessage(
        error,
        isEdit ? '수정에 실패했습니다.' : '이모티콘 추가에 실패했습니다.'
      );
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            {isEdit ? (
              <Pencil className="size-5 text-primary" />
            ) : (
              <ImagePlus className="size-5 text-primary" />
            )}
          </div>
          <DialogTitle className="text-center">
            {isEdit ? '이모티콘 수정' : '이모티콘 추가'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isEdit
              ? `${emoticon?.name ?? ''} 이모티콘을 수정합니다.`
              : `${characterId} 캐릭터에 새 이모티콘을 추가합니다.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1" noValidate>
          <div className="space-y-2">
            <Label htmlFor="emoticon-id">id</Label>
            <Input
              id="emoticon-id"
              value={form.id}
              onChange={(e) => setField('id', e.target.value)}
              placeholder="nice_shot"
              className="rounded-xl font-mono text-sm"
              disabled={isEdit}
              aria-invalid={Boolean(errors.id)}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? ID_IMMUTABLE_HELP : EMOTICON_ID_RULE_TEXT}
            </p>
            {errors.id && (
              <p className="text-xs font-medium text-destructive">{errors.id}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="emoticon-name">이름</Label>
            <Input
              id="emoticon-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="나이스 샷"
              className="rounded-xl"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <p className="text-xs font-medium text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="emoticon-order">정렬 순서</Label>
            <Input
              id="emoticon-order"
              type="number"
              value={form.order}
              onChange={(e) => setField('order', e.target.value)}
              className="rounded-xl"
              aria-invalid={Boolean(errors.order)}
            />
            <p className="text-xs text-muted-foreground">
              숫자가 작을수록 앱 서랍에서 앞에 놓입니다.
            </p>
            {errors.order && (
              <p className="text-xs font-medium text-destructive">{errors.order}</p>
            )}
          </div>

          <ImageField
            id="emoticon-image"
            label="이미지"
            file={file}
            existingUrl={emoticon?.url}
            error={errors.image}
            onPick={handlePick}
          />

          <label
            htmlFor="emoticon-active"
            className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
          >
            <span className="text-sm font-medium">
              활성
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                끄면 앱 서랍에서 숨겨집니다
              </span>
            </span>
            <Switch
              id="emoticon-active"
              checked={form.active}
              onCheckedChange={(v) => setField('active', v)}
            />
          </label>

          {submitError && (
            <div className="rounded-lg bg-destructive/10 px-4 py-2.5">
              <p className="text-sm font-medium text-destructive">{submitError}</p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl font-bold"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-xl font-bold"
              disabled={submitting || idBlocked}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 캐릭터 생성/수정 다이얼로그. 이모티콘 쪽과 규칙이 같고 필드 이름만 iconPath 다. */
function CharacterFormDialog({
  open,
  onOpenChange,
  mode,
  character,
  existingIds,
  defaultOrder,
  onSaved,
}) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState({ id: '', name: '', order: 1, active: true });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setErrors({});
    setSubmitError('');
    setSubmitting(false);
    if (isEdit && character) {
      setForm({
        id: character.id,
        name: character.name ?? '',
        order: Number(character.order) || 0,
        active: Boolean(character.active),
      });
    } else {
      setForm({ id: '', name: '', order: defaultOrder, active: true });
    }
  }, [open, isEdit, character, defaultOrder]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handlePick = (picked) => {
    if (!picked) {
      setFile(null);
      setErrors((prev) => ({ ...prev, image: undefined }));
      return;
    }
    const reason = validateImageFile(picked);
    if (reason) {
      setFile(null);
      setErrors((prev) => ({ ...prev, image: reason }));
      return;
    }
    setFile(picked);
    setErrors((prev) => ({ ...prev, image: undefined }));
  };

  const validate = () => {
    const next = {};
    const id = form.id.trim();

    if (!isEdit) {
      if (!id) next.id = 'id 를 입력해 주세요.';
      else if (!isValidEmoticonId(id)) next.id = EMOTICON_ID_RULE_TEXT;
      else if (existingIds.has(id))
        next.id = '이미 있는 id 입니다. 저장하면 기존 캐릭터를 덮어씁니다.';
    }

    if (!form.name.trim()) next.name = '이름을 입력해 주세요.';
    if (!Number.isInteger(Number(form.order))) next.order = '정수를 입력해 주세요.';
    else if (Number(form.order) < 0 || Number(form.order) > MAX_ORDER)
      next.order = `0 이상 ${MAX_ORDER} 이하여야 해요.`;
    if (!file && !character?.iconPath) next.image = '아이콘 이미지를 선택해 주세요.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const idBlocked =
    !isEdit &&
    (!form.id.trim() ||
      !isValidEmoticonId(form.id.trim()) ||
      existingIds.has(form.id.trim()));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    const id = isEdit ? character.id : form.id.trim();
    setSubmitting(true);
    try {
      // emoticonId 를 빼고 부르면 서버가 캐릭터 아이콘 경로(_character-…)를 잡아 준다.
      const iconPath = file
        ? await emoticonService.uploadImage(file, { characterId: id })
        : character?.iconPath;

      await emoticonService.saveCharacter(id, {
        name: form.name.trim(),
        iconPath,
        order: Number(form.order),
        active: form.active,
      });

      toast.success(isEdit ? '캐릭터를 수정했습니다.' : '캐릭터를 추가했습니다.');
      onOpenChange(false);
      onSaved(id);
    } catch (error) {
      const message = readErrorMessage(
        error,
        isEdit ? '수정에 실패했습니다.' : '캐릭터 추가에 실패했습니다.'
      );
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            {isEdit ? (
              <Pencil className="size-5 text-primary" />
            ) : (
              <UserRoundPlus className="size-5 text-primary" />
            )}
          </div>
          <DialogTitle className="text-center">
            {isEdit ? '캐릭터 수정' : '캐릭터 추가'}
          </DialogTitle>
          <DialogDescription className="text-center">
            캐릭터는 앱 이모티콘 서랍의 탭 하나입니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1" noValidate>
          <div className="space-y-2">
            <Label htmlFor="character-id">id</Label>
            <Input
              id="character-id"
              value={form.id}
              onChange={(e) => setField('id', e.target.value)}
              placeholder="birdieup"
              className="rounded-xl font-mono text-sm"
              disabled={isEdit}
              aria-invalid={Boolean(errors.id)}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? ID_IMMUTABLE_HELP : EMOTICON_ID_RULE_TEXT}
            </p>
            {errors.id && (
              <p className="text-xs font-medium text-destructive">{errors.id}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="character-name">이름</Label>
            <Input
              id="character-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="버디업"
              className="rounded-xl"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <p className="text-xs font-medium text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="character-order">정렬 순서</Label>
            <Input
              id="character-order"
              type="number"
              value={form.order}
              onChange={(e) => setField('order', e.target.value)}
              className="rounded-xl"
              aria-invalid={Boolean(errors.order)}
            />
            {errors.order && (
              <p className="text-xs font-medium text-destructive">{errors.order}</p>
            )}
          </div>

          <ImageField
            id="character-icon"
            label="탭 아이콘"
            file={file}
            existingUrl={character?.iconUrl}
            error={errors.image}
            onPick={handlePick}
          />

          <label
            htmlFor="character-active"
            className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
          >
            <span className="text-sm font-medium">
              활성
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                끄면 탭이 앱에서 숨겨집니다
              </span>
            </span>
            <Switch
              id="character-active"
              checked={form.active}
              onCheckedChange={(v) => setField('active', v)}
            />
          </label>

          {submitError && (
            <div className="rounded-lg bg-destructive/10 px-4 py-2.5">
              <p className="text-sm font-medium text-destructive">{submitError}</p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl font-bold"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              취소
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-xl font-bold"
              disabled={submitting || idBlocked}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 삭제 확인 다이얼로그.
 *
 * 삭제는 되돌릴 수 없고 이미 쓰인 이모티콘이면 과거 피드가 깨진다. 그래서 확인창 안에
 * **안전한 대안(비활성)** 을 나란히 둔다 — 경고 문구만 두면 결국 삭제를 누르게 된다.
 */
function DeleteConfirmDialog({ open, onOpenChange, target, onConfirm, onDeactivate }) {
  const [busy, setBusy] = useState(false);
  const isCharacter = target?.kind === 'character';

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <DialogTitle className="text-center">
            {isCharacter ? '캐릭터를 삭제할까요?' : '이모티콘을 삭제할까요?'}
          </DialogTitle>
          <DialogDescription className="text-center">
            <span className="font-medium text-foreground">{target?.item?.name}</span>
            <span className="ml-1 font-mono text-xs">({target?.item?.id})</span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-destructive/10 px-4 py-3">
          <p className="text-sm font-medium text-destructive">
            {isCharacter
              ? '이미 사용된 캐릭터를 지우면 그 탭이 앱에서 사라집니다. 숨기려면 삭제 대신 비활성을 쓰세요.'
              : '이미 사용된 이모티콘을 지우면 과거 피드에서 그림이 사라집니다. 숨기려면 삭제 대신 비활성을 쓰세요.'}
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 pt-1 sm:flex-col">
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl font-bold"
            disabled={busy || !target?.item?.active}
            onClick={() => run(onDeactivate)}
          >
            {target?.item?.active ? '대신 비활성화' : '이미 비활성 상태입니다'}
          </Button>
          <div className="flex w-full gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 rounded-xl font-bold"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 rounded-xl font-bold"
              disabled={busy}
              onClick={() => run(onConfirm)}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              삭제
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 목록 로딩 자리를 채우는 스켈레톤 격자 */
function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <Skeleton key={index} className="h-44 rounded-2xl" />
      ))}
    </div>
  );
}

export default function Emoticons() {
  const [characters, setCharacters] = useState([]);
  const [emoticons, setEmoticons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharacterId, setSelectedCharacterId] = useState('');

  const [emoticonDialog, setEmoticonDialog] = useState({ open: false, mode: 'create', item: null });
  const [characterDialog, setCharacterDialog] = useState({ open: false, mode: 'create', item: null });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await emoticonService.fetchCatalog();
      setCharacters(data.characters);
      setEmoticons(data.emoticons);
      return data;
    } catch (error) {
      toast.error(readErrorMessage(error, '이모티콘 목록을 불러오지 못했습니다.'));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 선택한 캐릭터가 사라지면(삭제·최초 로드) 첫 캐릭터로 돌려놓는다.
  useEffect(() => {
    if (characters.length === 0) {
      setSelectedCharacterId('');
      return;
    }
    if (!characters.some((c) => c.id === selectedCharacterId)) {
      setSelectedCharacterId(characters[0].id);
    }
  }, [characters, selectedCharacterId]);

  const characterIds = useMemo(
    () => new Set(characters.map((c) => c.id)),
    [characters]
  );
  const emoticonIds = useMemo(() => new Set(emoticons.map((e) => e.id)), [emoticons]);

  const visibleEmoticons = useMemo(
    () => emoticons.filter((e) => e.characterId === selectedCharacterId),
    [emoticons, selectedCharacterId]
  );

  // 어느 캐릭터에도 속하지 않는 행은 격자에서 영원히 안 보인다. 조용히 숨기지 않고 알린다.
  const orphanCount = useMemo(
    () => emoticons.filter((e) => !characterIds.has(e.characterId)).length,
    [emoticons, characterIds]
  );

  // ── 드래그 정렬 ──────────────────────────────────────────────────
  //
  // 화면은 끌어다 놓지만 **저장되는 것은 order 숫자**다. Firestore 의 emoticons 는
  // 이모티콘 하나가 문서 하나여서 컬렉션 자체에는 순서가 없고, 서버가 order 오름차순으로
  // 정렬해 내려준다(docs/admin-api.md §4). 그래서 "배열 순서" 를 저장할 자리가 없다.
  //
  // 🔴 **order 를 1,2,3… 으로 촘촘히 매기지 않는다.** 그렇게 하면 한 칸 건너뛸 때마다
  //    사이의 행이 전부 한 칸씩 밀려서, 다섯 칸을 옮기면 여섯 행을 저장하게 된다.
  //    맨 앞을 맨 뒤로 보내면 24개가 통째로 나가고 활동 로그도 그만큼 부풀어
  //    "무엇을 옮겼는지" 를 읽을 수 없다.
  //    대신 100 간격으로 벌려 두고 **이웃 둘의 가운데 값**을 준다. 몇 칸을 옮기든
  //    저장은 한 건이다.
  //
  // 틈이 다 닳으면(가운데에 정수가 없으면) 그때 한 번만 100 간격으로 다시 벌린다.
  // order 는 정수여야 하므로(§4·아래 폼 검증) 소수로 무한히 쪼갤 수 없다.
  //
  // 카드 전체를 draggable 로 두면 클릭(수정 열기)과 구분이 안 된다. 그래서 손잡이를
  // 누르고 있는 동안만 draggable 을 켠다.
  // 두 목록이 상태를 나눠 쓰면 이모티콘을 끌던 중 캐릭터 카드에 놓는 것이 가능해진다.
  // 각자 들고 있으면 상대 목록의 onDrop 이 애초에 자기 dragId 를 못 찾아 아무 일도 없다.
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [handleHeld, setHandleHeld] = useState(false);
  const [charDragId, setCharDragId] = useState(null);
  const [charDragOverId, setCharDragOverId] = useState(null);
  const [charHandleHeld, setCharHandleHeld] = useState(false);
  const [reordering, setReordering] = useState(false);

  /**
   * 원하는 최종 차례(nextList)를 만들기 위해 **실제로 저장해야 할 행**을 고른다.
   *
   * 보통은 옮긴 행 하나뿐이고, 틈이 없을 때만 전체를 다시 벌린다.
   * id 와 order 만 보므로 이모티콘과 캐릭터가 함께 쓴다 — 둘이 다른 규칙으로 갈리면
   * 한쪽에서만 틈이 닳아 순서가 어긋난다.
   * @returns {{row: object, order: number}[]}
   */
  const planOrderWrites = (movedId, nextList) => {
    const at = nextList.findIndex((e) => e.id === movedId);
    if (at < 0) return [];

    const before = at > 0 ? Number(nextList[at - 1].order) : null;
    const after =
      at < nextList.length - 1 ? Number(nextList[at + 1].order) : null;

    let candidate;
    if (before === null && after === null) candidate = ORDER_STEP;
    else if (before === null) candidate = Math.floor(after / 2);
    else if (after === null) candidate = before + ORDER_STEP;
    else candidate = Math.floor((before + after) / 2);

    // 🔴 상한을 함께 본다. 맨 뒤로 보내면 candidate 가 이전값+100 이라 뒤로 보내기를
    //    거듭할수록 값이 자란다. 상한을 안 보면 언젠가 9999 를 넘겨 400 을 받는데,
    //    그때 화면에는 "순서를 저장하지 못했습니다" 만 뜨고 이유가 드러나지 않는다.
    const fits =
      Number.isInteger(candidate) &&
      candidate >= 0 &&
      candidate <= MAX_ORDER &&
      (before === null || candidate > before) &&
      (after === null || candidate < after);

    if (fits) return [{ row: nextList[at], order: candidate }];

    // 틈이 닳았거나 상한에 닿았다. 이 목록을 통째로 다시 벌리고 값이 달라진 행만 저장한다.
    const step = renumberStep(nextList.length);
    return nextList
      .map((row, index) => ({ row, order: (index + 1) * step }))
      .filter(({ row, order }) => Number(row.order) !== order);
  };

  /**
   * 옮긴 결과를 화면에 먼저 반영하고 서버에 저장한다.
   *
   * PUT 은 upsert 이므로 order 만 보내면 name·imagePath 가 비워진다
   * (toggleEmoticonActive 주석과 같은 이유). 나머지 필드를 그대로 함께 싣는다.
   */
  const applyEmoticonMove = async (movedId, nextList) => {
    const writes = planOrderWrites(movedId, nextList);
    if (writes.length === 0) return;

    const snapshot = emoticons;
    const orderById = new Map(writes.map(({ row, order }) => [row.id, order]));

    // 격자에 보이는 것은 이 캐릭터의 행뿐이지만 state 는 전 캐릭터를 한 배열로 들고 있다.
    // 이 캐릭터가 차지하던 자리에 새 차례를 끼워 넣어 다른 캐릭터를 흔들지 않는다.
    setEmoticons((prev) => {
      const slots = [];
      prev.forEach((e, index) => {
        if (e.characterId === selectedCharacterId) slots.push(index);
      });
      const out = [...prev];
      nextList.forEach((e, k) => {
        if (slots[k] === undefined) return;
        out[slots[k]] = orderById.has(e.id)
          ? { ...e, order: orderById.get(e.id) }
          : e;
      });
      return out;
    });

    setReordering(true);
    try {
      const results = await Promise.allSettled(
        writes.map(({ row, order }) =>
          emoticonService.saveEmoticon(row.id, {
            characterId: row.characterId,
            name: row.name,
            imagePath: row.imagePath,
            order,
            active: row.active,
          })
        )
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        // 일부만 저장되면 화면과 서버가 어긋난 채로 남는다. 추측하지 말고 다시 받아온다.
        toast.error(readErrorMessage(failed.reason, '순서를 저장하지 못했습니다.'));
        await load();
        return;
      }
      toast.success(
        writes.length > 1
          ? `순서를 바꿨습니다. (간격이 닳아 ${writes.length}개를 다시 정렬)`
          : '순서를 바꿨습니다.'
      );
    } catch (error) {
      setEmoticons(snapshot);
      toast.error(readErrorMessage(error, '순서를 저장하지 못했습니다.'));
    } finally {
      setReordering(false);
    }
  };

  /**
   * 캐릭터 순서. 이모티콘과 같은 규칙이다(planOrderWrites 주석).
   *
   * 캐릭터 목록은 전 캐릭터가 그대로 한 배열이라 이모티콘처럼 자리를 골라 끼울 필요가 없다.
   */
  const applyCharacterMove = async (movedId, nextList) => {
    const writes = planOrderWrites(movedId, nextList);
    if (writes.length === 0) return;

    const snapshot = characters;
    const orderById = new Map(writes.map(({ row, order }) => [row.id, order]));
    setCharacters(
      nextList.map((c) =>
        orderById.has(c.id) ? { ...c, order: orderById.get(c.id) } : c
      )
    );

    setReordering(true);
    try {
      const results = await Promise.allSettled(
        writes.map(({ row, order }) =>
          emoticonService.saveCharacter(row.id, {
            name: row.name,
            iconPath: row.iconPath,
            order,
            active: row.active,
          })
        )
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        toast.error(readErrorMessage(failed.reason, '순서를 저장하지 못했습니다.'));
        await load();
        return;
      }
      toast.success(
        writes.length > 1
          ? `순서를 바꿨습니다. (간격이 닳아 ${writes.length}개를 다시 정렬)`
          : '순서를 바꿨습니다.'
      );
    } catch (error) {
      setCharacters(snapshot);
      toast.error(readErrorMessage(error, '순서를 저장하지 못했습니다.'));
    } finally {
      setReordering(false);
    }
  };

  const moveCharacter = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const from = characters.findIndex((c) => c.id === sourceId);
    const to = characters.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...characters];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyCharacterMove(sourceId, next);
  };

  const nudgeCharacter = (character, delta) => {
    const from = characters.findIndex((c) => c.id === character.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= characters.length) return;
    const next = [...characters];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyCharacterMove(character.id, next);
  };

  /** sourceId 를 targetId 자리로 옮긴다. */
  const moveEmoticon = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const from = visibleEmoticons.findIndex((e) => e.id === sourceId);
    const to = visibleEmoticons.findIndex((e) => e.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...visibleEmoticons];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyEmoticonMove(sourceId, next);
  };

  /**
   * 손잡이에서 화살표 키로 한 칸씩 옮긴다.
   *
   * 드래그만 두면 키보드로는 순서를 바꿀 방법이 아예 없다.
   */
  const nudgeEmoticon = (emoticon, delta) => {
    const from = visibleEmoticons.findIndex((e) => e.id === emoticon.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= visibleEmoticons.length) return;
    const next = [...visibleEmoticons];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    applyEmoticonMove(emoticon.id, next);
  };

  /**
   * 활성 스위치 즉시 저장.
   *
   * 스위치는 눌린 즉시 움직여야 하므로 낙관적으로 화면을 먼저 바꾸고, 서버가 거절하면
   * 되돌린다. PUT 은 upsert 라 나머지 필드도 함께 실어야 값이 비워지지 않는다.
   */
  const toggleEmoticonActive = async (emoticon, active) => {
    setEmoticons((prev) =>
      prev.map((e) => (e.id === emoticon.id ? { ...e, active } : e))
    );
    try {
      await emoticonService.saveEmoticon(emoticon.id, {
        characterId: emoticon.characterId,
        name: emoticon.name,
        imagePath: emoticon.imagePath,
        order: emoticon.order,
        active,
      });
      toast.success(active ? '이모티콘을 활성화했습니다.' : '이모티콘을 숨겼습니다.');
    } catch (error) {
      setEmoticons((prev) =>
        prev.map((e) => (e.id === emoticon.id ? { ...e, active: emoticon.active } : e))
      );
      toast.error(readErrorMessage(error, '활성 상태를 바꾸지 못했습니다.'));
    }
  };

  const toggleCharacterActive = async (character, active) => {
    setCharacters((prev) =>
      prev.map((c) => (c.id === character.id ? { ...c, active } : c))
    );
    try {
      await emoticonService.saveCharacter(character.id, {
        name: character.name,
        iconPath: character.iconPath,
        order: character.order,
        active,
      });
      toast.success(active ? '캐릭터를 활성화했습니다.' : '캐릭터를 숨겼습니다.');
    } catch (error) {
      setCharacters((prev) =>
        prev.map((c) => (c.id === character.id ? { ...c, active: character.active } : c))
      );
      toast.error(readErrorMessage(error, '활성 상태를 바꾸지 못했습니다.'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { kind, item } = deleteTarget;
    try {
      if (kind === 'character') await emoticonService.deleteCharacter(item.id);
      else await emoticonService.deleteEmoticon(item.id);
      toast.success('삭제했습니다.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      // 캐릭터에 이모티콘이 남아 있으면 서버가 409 로 막는다. 다음에 할 일을 알려 준다.
      if (readErrorCode(error) === 'CHARACTER_NOT_EMPTY') {
        toast.error('이 캐릭터의 이모티콘을 먼저 정리하세요.');
        return;
      }
      toast.error(readErrorMessage(error, '삭제하지 못했습니다.'));
    }
  };

  /** 삭제 확인창의 「대신 비활성화」. 안전한 쪽을 고른 것이므로 창을 닫아 준다. */
  const handleDeactivateInstead = async () => {
    if (!deleteTarget) return;
    const { kind, item } = deleteTarget;
    setDeleteTarget(null);
    if (kind === 'character') await toggleCharacterActive(item, false);
    else await toggleEmoticonActive(item, false);
  };

  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId) ?? null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        앱 이모티콘 서랍에 뜨는 캐릭터와 이모티콘을 관리합니다. 활성을 끄면 앱에서 숨겨지고,
        최대 5분 뒤 모든 사용자에게 반영됩니다.
      </p>

      {/* 캐릭터 — 앱 서랍의 탭 한 줄에 해당한다 */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Smile className="size-4 text-primary" />
          <h3 className="mr-auto text-sm font-bold">
            캐릭터
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {characters.length}개
            </span>
          </h3>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-xl"
            onClick={() => setCharacterDialog({ open: true, mode: 'create', item: null })}
          >
            <Plus className="size-4" />
            캐릭터 추가
          </Button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex gap-3">
              <Skeleton className="h-24 w-56 rounded-2xl" />
              <Skeleton className="h-24 w-56 rounded-2xl" />
            </div>
          ) : characters.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              등록된 캐릭터가 없습니다. 캐릭터를 먼저 추가해 주세요.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {characters.map((character, index) => {
                const selected = character.id === selectedCharacterId;
                const count = emoticons.filter(
                  (e) => e.characterId === character.id
                ).length;
                return (
                  <div
                    key={character.id}
                    role="button"
                    tabIndex={0}
                    draggable={charHandleHeld}
                    onDragStart={(e) => {
                      setCharDragId(character.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', character.id);
                    }}
                    onDragOver={(e) => {
                      if (!charDragId || charDragId === character.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setCharDragOverId(character.id);
                    }}
                    onDragLeave={() =>
                      setCharDragOverId((prev) =>
                        prev === character.id ? null : prev
                      )
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      moveCharacter(charDragId, character.id);
                      setCharDragId(null);
                      setCharDragOverId(null);
                      setCharHandleHeld(false);
                    }}
                    onDragEnd={() => {
                      setCharDragId(null);
                      setCharDragOverId(null);
                      setCharHandleHeld(false);
                    }}
                    onClick={() => setSelectedCharacterId(character.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCharacterId(character.id);
                      }
                    }}
                    className={`group flex w-64 cursor-pointer items-center gap-2 rounded-2xl border p-3 transition-colors ${
                      charDragOverId === character.id
                        ? 'border-primary bg-primary/5'
                        : selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/40'
                    } ${charDragId === character.id ? 'opacity-40' : ''} ${
                      character.active ? '' : 'opacity-50'
                    }`}
                  >
                    {/* 이모티콘 카드와 같은 규칙: 손잡이를 쥐고 있는 동안만 draggable.
                        가로로 긴 카드라 그림 위에 얹지 않고 맨 왼쪽에 세운다. */}
                    <button
                      type="button"
                      aria-label={`${character.name} 순서 옮기기`}
                      title="끌어서 옮기기 · 화살표 키로 한 칸씩"
                      disabled={reordering}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={() => setCharHandleHeld(true)}
                      onMouseUp={() => setCharHandleHeld(false)}
                      onTouchStart={() => setCharHandleHeld(true)}
                      onTouchEnd={() => setCharHandleHeld(false)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          nudgeCharacter(character, -1);
                        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          nudgeCharacter(character, 1);
                        }
                      }}
                      className="-ml-1 shrink-0 cursor-grab rounded-md p-0.5 text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <GripVertical className="size-3.5" />
                    </button>
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
                      {character.iconUrl ? (
                        <img
                          src={character.iconUrl}
                          alt=""
                          className="size-full object-contain"
                        />
                      ) : (
                        <ImageOff className="size-4 text-muted-foreground" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{character.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {character.id}
                      </p>
                      <p
                        className="truncate text-[11px] text-muted-foreground"
                        title={`order ${character.order}`}
                      >
                        이모티콘 {count}개 · {index + 1}번째
                      </p>
                    </div>

                    <div
                      className="flex flex-col items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      <Switch
                        checked={Boolean(character.active)}
                        onCheckedChange={(v) => toggleCharacterActive(character, v)}
                        aria-label={`${character.name} 활성`}
                      />
                      <div className="flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="캐릭터 수정"
                          onClick={() =>
                            setCharacterDialog({
                              open: true,
                              mode: 'edit',
                              item: character,
                            })
                          }
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          aria-label="캐릭터 삭제"
                          onClick={() =>
                            setDeleteTarget({ kind: 'character', item: character })
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 이모티콘 — 위에서 고른 캐릭터에 속한 것만 보여 준다 */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <ImagePlus className="size-4 text-primary" />
          <h3 className="mr-auto text-sm font-bold">
            이모티콘
            {selectedCharacter && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {selectedCharacter.name} · {visibleEmoticons.length}개
              </span>
            )}
          </h3>
          <Button
            type="button"
            className="h-9 rounded-xl"
            disabled={!selectedCharacterId}
            onClick={() => setEmoticonDialog({ open: true, mode: 'create', item: null })}
          >
            <Plus className="size-4" />
            이모티콘 추가
          </Button>
        </div>

        <div className="space-y-3 p-5">
          {orphanCount > 0 && (
            <p className="rounded-xl bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              어느 캐릭터에도 속하지 않은 이모티콘이 {orphanCount}개 있습니다. characterId 를
              확인해 주세요.
            </p>
          )}

          {loading ? (
            <GridSkeleton />
          ) : !selectedCharacterId ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              캐릭터를 먼저 추가하면 이모티콘을 등록할 수 있습니다.
            </p>
          ) : visibleEmoticons.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              이 캐릭터에 등록된 이모티콘이 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {visibleEmoticons.map((emoticon, index) => (
                <div
                  key={emoticon.id}
                  role="button"
                  tabIndex={0}
                  draggable={handleHeld}
                  onDragStart={(e) => {
                    setDragId(emoticon.id);
                    e.dataTransfer.effectAllowed = 'move';
                    // Firefox 는 데이터가 실리지 않은 드래그를 시작하지 않는다.
                    e.dataTransfer.setData('text/plain', emoticon.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragId || dragId === emoticon.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverId(emoticon.id);
                  }}
                  onDragLeave={() =>
                    setDragOverId((prev) => (prev === emoticon.id ? null : prev))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    moveEmoticon(dragId, emoticon.id);
                    setDragId(null);
                    setDragOverId(null);
                    setHandleHeld(false);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                    setHandleHeld(false);
                  }}
                  onClick={() =>
                    setEmoticonDialog({ open: true, mode: 'edit', item: emoticon })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEmoticonDialog({ open: true, mode: 'edit', item: emoticon });
                    }
                  }}
                  className={`group cursor-pointer rounded-2xl border p-3 transition-colors hover:bg-muted/40 ${
                    dragOverId === emoticon.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  } ${dragId === emoticon.id ? 'opacity-40' : ''} ${
                    emoticon.active ? '' : 'opacity-50'
                  }`}
                >
                  {/* 손잡이를 누르고 있는 동안만 카드가 draggable 이 된다.
                      카드 전체를 항상 draggable 로 두면 수정하려고 누른 클릭이 조금만
                      흔들려도 드래그가 되어 버린다. 아래 줄(배지·스위치·삭제)은 좁은
                      카드에서 이미 꽉 차 있어 손잡이를 그림 위에 얹는다. */}
                  <div className="relative mb-2 aspect-square overflow-hidden rounded-xl bg-muted/40">
                    <button
                      type="button"
                      aria-label={`${emoticon.name} 순서 옮기기`}
                      title="끌어서 옮기기 · 화살표 키로 한 칸씩"
                      disabled={reordering}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={() => setHandleHeld(true)}
                      onMouseUp={() => setHandleHeld(false)}
                      onTouchStart={() => setHandleHeld(true)}
                      onTouchEnd={() => setHandleHeld(false)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          nudgeEmoticon(emoticon, -1);
                        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          nudgeEmoticon(emoticon, 1);
                        }
                      }}
                      className="absolute left-1 top-1 z-10 cursor-grab rounded-md bg-background/80 p-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <GripVertical className="size-3.5" />
                    </button>
                    <div className="flex size-full items-center justify-center">
                    {emoticon.url ? (
                      <img
                        src={emoticon.url}
                        alt={emoticon.name}
                        className="size-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <ImageOff className="size-5" />
                        <span className="text-[10px]">이미지 없음</span>
                      </div>
                    )}
                    </div>
                  </div>

                  <p className="truncate text-sm font-bold">{emoticon.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {emoticon.id}
                  </p>

                  <div className="mt-2 flex items-center justify-between gap-1">
                    {/* 벌려 둔 order(100·200…)를 그대로 보이면 운영자가 읽을 이유가 없는
                        숫자가 카드마다 뜬다. 자리 번호를 보이고 원값은 tooltip 에 둔다. */}
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px]"
                      title={`order ${emoticon.order}`}
                    >
                      {index + 1}번째
                    </Badge>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      <Switch
                        checked={Boolean(emoticon.active)}
                        onCheckedChange={(v) => toggleEmoticonActive(emoticon, v)}
                        aria-label={`${emoticon.name} 활성`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        aria-label="이모티콘 삭제"
                        onClick={() =>
                          setDeleteTarget({ kind: 'emoticon', item: emoticon })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <EmoticonFormDialog
        open={emoticonDialog.open}
        onOpenChange={(open) => setEmoticonDialog((prev) => ({ ...prev, open }))}
        mode={emoticonDialog.mode}
        emoticon={emoticonDialog.item}
        characterId={
          emoticonDialog.item?.characterId ?? selectedCharacterId
        }
        existingIds={emoticonIds}
        defaultOrder={nextOrder(visibleEmoticons)}
        onSaved={load}
      />

      <CharacterFormDialog
        open={characterDialog.open}
        onOpenChange={(open) => setCharacterDialog((prev) => ({ ...prev, open }))}
        mode={characterDialog.mode}
        character={characterDialog.item}
        existingIds={characterIds}
        defaultOrder={nextOrder(characters)}
        onSaved={async (savedId) => {
          setSelectedCharacterId(savedId);
          await load();
        }}
      />

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        target={deleteTarget}
        onConfirm={handleDelete}
        onDeactivate={handleDeactivateInstead}
      />
    </div>
  );
}
