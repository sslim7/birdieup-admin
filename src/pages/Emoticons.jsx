import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
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

/** 새 항목의 기본 order. 뒤에 붙는 편이 기존 순서를 흔들지 않는다. */
function nextOrder(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.order) || 0), 0) + 1;
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
              {characters.map((character) => {
                const selected = character.id === selectedCharacterId;
                const count = emoticons.filter(
                  (e) => e.characterId === character.id
                ).length;
                return (
                  <div
                    key={character.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedCharacterId(character.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedCharacterId(character.id);
                      }
                    }}
                    className={`flex w-64 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors ${
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/40'
                    } ${character.active ? '' : 'opacity-50'}`}
                  >
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
                      <p className="text-[11px] text-muted-foreground">
                        이모티콘 {count}개 · order {character.order}
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
              {visibleEmoticons.map((emoticon) => (
                <div
                  key={emoticon.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setEmoticonDialog({ open: true, mode: 'edit', item: emoticon })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEmoticonDialog({ open: true, mode: 'edit', item: emoticon });
                    }
                  }}
                  className={`group cursor-pointer rounded-2xl border border-border p-3 transition-colors hover:bg-muted/40 ${
                    emoticon.active ? '' : 'opacity-50'
                  }`}
                >
                  <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-muted/40">
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

                  <p className="truncate text-sm font-bold">{emoticon.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {emoticon.id}
                  </p>

                  <div className="mt-2 flex items-center justify-between gap-1">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      order {emoticon.order}
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
