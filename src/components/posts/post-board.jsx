import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  Search,
  Trash2,
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { renderMarkdown } from '@/lib/markdown';
import {
  createPost,
  deletePost,
  fetchPost,
  fetchPosts,
  formatKstDateTime,
  isScheduled,
  nowKstInputValue,
  POST_STATUS,
  readPostError,
  toKstInputValue,
  toUtcFromKstInput,
  updatePost,
  uploadPostImage,
  validatePostImage,
} from '@/services/postService';

/**
 * kind 별로 달라지는 것은 문구뿐이다.
 *
 * 공지사항과 업데이트는 서버에서 한 컬렉션이고 필드도 동작도 같아서, 화면을 두 벌 만들면
 * 한쪽만 고쳐진 채 서서히 벌어진다. 그래서 컴포넌트는 하나로 두고 차이를 이 표에만 모은다.
 * 새 kind 가 생기면 여기에 한 줄을 더하는 것으로 끝나야 한다.
 */
const KIND_META = {
  notice: {
    label: '공지사항',
    description: '앱의 공지사항 게시글을 작성하고 관리합니다.',
    createLabel: '공지 작성',
    empty: '등록된 공지사항이 없습니다.',
    searchPlaceholder: '공지 제목 검색',
  },
  release: {
    label: '업데이트',
    description: '앱의 업데이트 소식 게시글을 작성하고 관리합니다.',
    createLabel: '업데이트 작성',
    empty: '등록된 업데이트가 없습니다.',
    searchPlaceholder: '업데이트 제목 검색',
  },
};

/** 계약이 정한 길이 제한. 서버가 400 을 주기 전에 화면에서 먼저 막는다. */
const TITLE_MAX = 100;
const BODY_MAX = 20000;

/** 제목 / 발행일시 / 상태 / 수정일 */
const COLUMN_COUNT = 4;

/**
 * 상태 필터 세그먼트.
 *
 * 값 자체는 postService 의 POST_STATUS 를 그대로 쓴다 — 여기서 문자열을 새로 적으면
 * 서버가 모르는 값을 보내는 사고가 라벨 수정 한 번에 일어난다.
 */
const STATUS_SEGMENTS = [
  { value: POST_STATUS.ALL, label: '전체' },
  { value: POST_STATUS.PUBLISHED, label: '발행됨' },
  { value: POST_STATUS.SCHEDULED, label: '예약' },
];

function TableSkeleton() {
  return Array.from({ length: 5 }).map((_, rowIndex) => (
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

/** 글자수 카운터. 한도를 넘으면 붉게 물들여 저장 버튼이 왜 잠겼는지 바로 보이게 한다. */
function CharCount({ current, max }) {
  const over = current > max;
  return (
    <span
      className={`text-xs tabular-nums ${
        over ? 'font-medium text-destructive' : 'text-muted-foreground'
      }`}
    >
      {current.toLocaleString('ko-KR')} / {max.toLocaleString('ko-KR')}
    </span>
  );
}

/**
 * 미리보기 렌더 비용을 타이핑에서 떼어 놓는다.
 *
 * 본문은 최대 20000자이고 renderMarkdown 은 파싱 + 새니타이즈 + DOM 조작을 한다.
 * 키 입력마다 전부 돌리면 긴 글에서 입력이 눈에 띄게 밀린다. 미리보기는 몇십 ms 늦어도
 * 아무도 눈치채지 못하지만 타이핑이 밀리는 것은 즉시 느껴지므로, 늦출 쪽은 미리보기다.
 */
function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/** 미리보기 렌더 지연(ms). 사람이 한 글자 더 치는 시간보다 짧게 잡는다. */
const PREVIEW_DEBOUNCE_MS = 200;

/**
 * 미리보기 서식.
 *
 * `@tailwindcss/typography` 가 설치돼 있지 않고(설치하지 않기로 했다) Tailwind 의 기본 리셋은
 * h1·ul·blockquote 의 서식을 전부 지운다. 그대로 두면 마크다운을 렌더한 결과가 밋밋한
 * 한 덩어리로 보여서 미리보기가 제 역할을 못 한다. 그래서 필요한 최소한만 자식 선택자로 준다.
 * 여기 없는 태그는 markdown.js 의 ALLOWED_TAGS 에도 없다 — 둘을 함께 고쳐야 한다.
 */
const PREVIEW_PROSE_CLASS = [
  'text-sm leading-relaxed break-words',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-1',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-4 [&_hr]:border-border',
  '[&_img]:my-2 [&_img]:rounded-lg [&_img]:border [&_img]:border-border',
].join(' ');

/** 툴바 버튼. 아이콘만 두므로 title/aria-label 로 이름을 남긴다. */
function ToolbarButton({ label, onClick, disabled, children }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="rounded-lg"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/** 업로드 중임을 본문 안에서 보여 주는 자리표시자. id 를 넣어 동시 업로드끼리 섞이지 않게 한다. */
function uploadingPlaceholder(uploadId) {
  return `![업로드 중…](uploading:${uploadId})`;
}

let uploadSequence = 0;

/**
 * 본문 마크다운 에디터.
 *
 * 계약 §2.1 이 본문을 평문에서 마크다운으로 바꾸면서 필요해진 화면이다. 서식은 전부
 * 마크다운 기호로만 표현되고, 이 컴포넌트가 하는 일은 그 기호를 대신 찍어 주는 것과
 * 결과를 미리 보여 주는 것뿐이다 — **리치 에디터(WYSIWYG)를 붙이지 마라.** 저장되는 것은
 * 어디까지나 사람이 읽고 고칠 수 있는 마크다운 문자열이어야 한다.
 */
function MarkdownBodyEditor({ value, onChange, disabled, onUploadingChange }) {
  const [tab, setTab] = useState('write');
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState(0);

  // 🔴 ref 를 Textarea 에 직접 걸지 않는다.
  // src/components/ui/textarea.jsx 는 forwardRef 를 쓰지 않는 평범한 함수 컴포넌트라
  // ref 가 전달되지 않고 React 가 경고만 남긴다. 그 공용 컴포넌트는 다른 화면들이 함께 쓰고
  // 있어 여기서 고치지 않기로 했으므로, 감싼 div 에서 실제 textarea 노드를 찾아 쓴다.
  const bodyBoxRef = useRef(null);
  const fileInputRef = useRef(null);

  const getTextarea = () => bodyBoxRef.current?.querySelector('textarea') ?? null;

  // 툴바로 본문을 바꾼 뒤 복원할 커서 위치. React 가 새 value 를 DOM 에 반영한 다음에
  // 적용해야 하므로 즉시 setSelectionRange 하지 않고 여기 담아 두었다가 effect 에서 쓴다.
  const pendingSelectionRef = useRef(null);

  useEffect(() => {
    const selection = pendingSelectionRef.current;
    if (!selection) return;
    pendingSelectionRef.current = null;

    const textarea = getTextarea();
    if (!textarea) return;
    // 포커스와 커서를 되돌리지 않으면 툴바를 누를 때마다 타이핑 흐름이 끊긴다.
    textarea.focus();
    textarea.setSelectionRange(selection[0], selection[1]);
  }, [value]);

  // 업로드가 도는 동안에는 저장을 막아야 한다(자리표시자가 그대로 저장되는 것을 피한다).
  useEffect(() => {
    onUploadingChange?.(uploads > 0);
  }, [uploads, onUploadingChange]);

  const debouncedBody = useDebouncedValue(value, PREVIEW_DEBOUNCE_MS);
  const previewHtml = useMemo(() => renderMarkdown(debouncedBody), [debouncedBody]);

  /** 현재 선택 영역. 포커스가 없으면 글 끝을 커서로 본다. */
  const readSelection = () => {
    const textarea = getTextarea();
    if (!textarea) return { start: value.length, end: value.length };
    return { start: textarea.selectionStart, end: textarea.selectionEnd };
  };

  const applyChange = (next, selectionStart, selectionEnd) => {
    // 좁은 화면에서 미리보기 탭을 보는 중에도 툴바는 눌린다. 그대로 두면 본문이 바뀌었는데
    // 화면에는 아무 일도 안 일어난 것처럼 보이므로 작성 탭으로 되돌린다.
    setTab('write');
    pendingSelectionRef.current = [selectionStart, selectionEnd];
    onChange(next);
  };

  /**
   * 선택 영역을 기호로 감싼다(굵게·기울임·코드).
   * 선택이 없으면 안내 문구를 넣고 그 문구를 선택 상태로 둬서 바로 덮어쓸 수 있게 한다.
   */
  const wrapSelection = (marker, placeholder) => {
    const { start, end } = readSelection();
    const selected = value.slice(start, end) || placeholder;
    const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
    const innerStart = start + marker.length;
    applyChange(next, innerStart, innerStart + selected.length);
  };

  /**
   * 선택된 줄들 앞에 기호를 붙인다(제목·목록·인용).
   *
   * 줄 단위 문법이라 커서가 줄 중간에 있어도 그 줄 맨 앞에 붙여야 한다. 이미 같은 기호가
   * 붙어 있으면 떼어 낸다 — 토글이 아니면 목록 버튼을 두 번 눌렀을 때 `- - 항목` 이 된다.
   */
  const prefixLines = (prefix) => {
    const { start, end } = readSelection();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIndex = value.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

    const block = value.slice(lineStart, lineEnd);
    const allPrefixed = block
      .split('\n')
      .every((line) => line.startsWith(prefix));

    const nextBlock = block
      .split('\n')
      .map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`))
      .join('\n');

    const next = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
    applyChange(next, lineStart, lineStart + nextBlock.length);
  };

  /** 링크. 선택 영역이 있으면 그것을 링크 텍스트로 쓰고 커서는 URL 자리에 둔다. */
  const insertLink = () => {
    const { start, end } = readSelection();
    const selected = value.slice(start, end) || '링크 텍스트';
    const url = 'https://';
    const snippet = `[${selected}](${url})`;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    const urlStart = start + selected.length + 3;
    applyChange(next, urlStart, urlStart + url.length);
  };

  /**
   * 이미지 업로드. 툴바의 파일 선택과 드래그&드롭이 함께 쓴다.
   *
   * 업로드가 끝나기 전에 커서 자리에 자리표시자를 먼저 꽂는다. 5MB 짜리 파일은 몇 초가
   * 걸리는데 그동안 아무 반응이 없으면 사용자는 실패한 줄 알고 같은 파일을 다시 올린다.
   *
   * 본문 갱신은 전부 함수형으로 한다 — await 를 건너뛴 뒤의 `value` 는 이미 낡았고,
   * 그 사이 사용자가 계속 타이핑하거나 다른 이미지를 더 올릴 수 있다.
   */
  const uploadFiles = async (files) => {
    // 자리표시자가 본문에 꽂히는 것을 보여 줘야 하므로 작성 탭으로 되돌린다.
    setTab('write');

    for (const file of files) {
      const reason = validatePostImage(file);
      if (reason) {
        toast.error(reason);
        continue;
      }

      uploadSequence += 1;
      const placeholder = uploadingPlaceholder(uploadSequence);
      const { start, end } = readSelection();

      // 자리표시자 삽입. 커서는 그 뒤로 보내 계속 타이핑할 수 있게 한다.
      onChange(
        (prev) => `${prev.slice(0, start)}${placeholder}${prev.slice(end)}`
      );
      pendingSelectionRef.current = [
        start + placeholder.length,
        start + placeholder.length,
      ];

      setUploads((count) => count + 1);
      try {
        const url = await uploadPostImage(file);
        // 계약 §2.2 대로 path 가 아니라 절대 URL 을 본문에 박는다.
        onChange((prev) => prev.replace(placeholder, `![](${url})`));
      } catch (error) {
        // 실패한 자리표시자를 남기면 그대로 저장되어 앱에 깨진 이미지가 뜬다. 지운다.
        onChange((prev) => prev.replace(placeholder, ''));
        toast.error(error?.message || '이미지 업로드에 실패했습니다.');
      } finally {
        setUploads((count) => count - 1);
      }
    }
  };

  const handleFilePicked = (event) => {
    const files = Array.from(event.target.files ?? []);
    // 같은 파일을 연속으로 고를 수 있어야 하므로 input 값을 비운다(안 그러면 change 가 안 뜬다).
    event.target.value = '';
    if (files.length > 0) uploadFiles(files);
  };

  /** 파일 드래그일 때만 가로챈다. 글자를 끌어다 놓는 기본 동작은 그대로 살린다. */
  const isFileDrag = (event) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const busy = disabled || uploads > 0;

  return (
    <div className="space-y-2">
      {/* 툴바 + 탭. 좁은 화면에서는 탭으로 전환하고 lg 이상에서는 두 패널을 나란히 놓는다. */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/30 p-1">
        <ToolbarButton label="굵게" onClick={() => wrapSelection('**', '굵은 글씨')} disabled={disabled}>
          <Bold />
        </ToolbarButton>
        <ToolbarButton label="기울임" onClick={() => wrapSelection('*', '기울인 글씨')} disabled={disabled}>
          <Italic />
        </ToolbarButton>
        <ToolbarButton label="제목" onClick={() => prefixLines('## ')} disabled={disabled}>
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton label="목록" onClick={() => prefixLines('- ')} disabled={disabled}>
          <List />
        </ToolbarButton>
        <ToolbarButton label="인용" onClick={() => prefixLines('> ')} disabled={disabled}>
          <Quote />
        </ToolbarButton>
        <ToolbarButton label="링크" onClick={insertLink} disabled={disabled}>
          <Link2 />
        </ToolbarButton>
        <ToolbarButton
          label="이미지 업로드"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          {uploads > 0 ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        </ToolbarButton>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={handleFilePicked}
        />

        {/* 탭 전환은 좁은 화면 전용이다. lg 이상에서는 두 패널이 다 보이므로 감춘다. */}
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          {[
            { key: 'write', label: '작성' },
            { key: 'preview', label: '미리보기' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                tab === item.key
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 작성 패널 */}
        <div ref={bodyBoxRef} className={`${tab === 'write' ? 'block' : 'hidden'} lg:block`}>
          <Textarea
            id="post-body"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="마크다운으로 작성합니다. 이미지는 툴바 버튼이나 파일을 끌어다 놓아 넣을 수 있어요."
            className={`min-h-72 rounded-xl font-mono text-sm ${
              dragging ? 'border-primary ring-[3px] ring-ring/50' : ''
            }`}
            aria-invalid={value.length > BODY_MAX}
            disabled={disabled}
            onDragOver={(e) => {
              if (!isFileDrag(e)) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              if (!isFileDrag(e)) return;
              e.preventDefault();
              setDragging(false);
              // 브라우저가 드롭 지점으로 캐럿을 옮겨 주지 않으므로 마지막 커서 위치에 넣는다.
              uploadFiles(Array.from(e.dataTransfer.files ?? []));
            }}
          />
        </div>

        {/* 미리보기 패널.
            renderMarkdown 이 새니타이즈까지 끝낸 문자열만 들어온다 — 이 자리에 다른 HTML 을
            직접 넣지 마라(§2.1). */}
        <div className={`${tab === 'preview' ? 'block' : 'hidden'} lg:block`}>
          <div className="h-full min-h-72 overflow-y-auto rounded-xl border border-border bg-muted/30 p-4">
            {previewHtml ? (
              <div
                className={PREVIEW_PROSE_CLASS}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                본문을 입력하면 앱에 보이는 모양으로 표시됩니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_FORM = { title: '', publishedAt: '', body: '' };

/**
 * 작성/수정 공용 폼 다이얼로그.
 *
 * `postId` 가 있으면 수정 모드다. 이때 **반드시 상세를 다시 받아온다** — 목록 item 에는
 * `body` 가 없어서(계약 §2) 목록 값만으로 폼을 채우고 저장하면 본문이 빈 문자열로 덮인다.
 * 상세를 받는 동안에는 폼 대신 스켈레톤을 보여 주고, 실패하면 다이얼로그를 닫아
 * "빈 폼에 저장을 눌러 글을 망가뜨리는" 경로 자체를 없앤다.
 */
function PostEditorDialog({ kind, postId, open, onOpenChange, onSaved, onDeleted }) {
  const meta = KIND_META[kind];
  const isEdit = Boolean(postId);

  const [form, setForm] = useState(EMPTY_FORM);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 이미지 업로드가 도는 동안에는 저장을 막는다. 자리표시자(`![업로드 중…]()`)가 그대로
  // 저장되면 앱에 깨진 이미지가 뜨고, 되돌리려면 글을 다시 열어 고쳐야 한다.
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    setConfirmOpen(false);
    setSubmitting(false);
    setDeleting(false);
    setUploadingImage(false);

    if (!isEdit) {
      // 새 글의 기본 발행일시는 '지금' 이다. 비워 두면 저장이 잠긴 채로 열려 혼란스럽고,
      // 대부분의 공지는 즉시 발행이라 기본값이 그대로 맞는 경우가 많다.
      setForm({ ...EMPTY_FORM, publishedAt: nowKstInputValue() });
      return undefined;
    }

    // 응답이 늦게 도착한 뒤 다이얼로그가 이미 닫히거나 다른 글로 바뀌었을 때
    // 옛 응답이 폼을 덮어쓰지 않도록 취소 플래그를 둔다.
    let cancelled = false;
    setLoadingDetail(true);
    setForm(EMPTY_FORM);

    fetchPost(postId)
      .then((detail) => {
        if (cancelled) return;
        setForm({
          title: detail?.title ?? '',
          publishedAt: toKstInputValue(detail?.publishedAt),
          body: detail?.body ?? '',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(readPostError(error, '게시글을 불러오지 못했습니다.'));
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
    // onOpenChange 는 부모에서 매 렌더 새로 만들어질 수 있어 의존성에서 뺀다.
    // 넣으면 다이얼로그가 열려 있는 동안 상세를 반복해서 다시 받는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, postId, isEdit]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * 본문 전용 setter. 값 대신 갱신 함수도 받는다.
   *
   * 이미지 업로드는 await 를 건너뛴 뒤에 자리표시자를 실제 URL 로 바꾸는데, 그때의 `form.body`
   * 는 이미 낡았다(그 사이 사용자가 계속 타이핑한다). 함수형 갱신만이 안전하다.
   */
  const setBody = (next) =>
    setForm((prev) => ({
      ...prev,
      body: typeof next === 'function' ? next(prev.body) : next,
    }));

  const title = form.title.trim();
  const body = form.body;
  const publishedAtUtc = toUtcFromKstInput(form.publishedAt);

  // 검증은 계약(§2)의 제약과 1:1 이다. 하나라도 어긋나면 저장 버튼을 잠근다 —
  // 눌러 보고 400 을 받는 것보다 애초에 못 누르게 하는 편이 낫다.
  const canSubmit =
    !loadingDetail &&
    !submitting &&
    !uploadingImage &&
    title.length >= 1 &&
    title.length <= TITLE_MAX &&
    body.length >= 1 &&
    body.length <= BODY_MAX &&
    publishedAtUtc !== null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      if (isEdit) {
        await updatePost(postId, { title, body, publishedAt: publishedAtUtc });
        toast.success(`${meta.label}을(를) 수정했습니다.`);
      } else {
        await createPost({ kind, title, body, publishedAt: publishedAtUtc });
        toast.success(`${meta.label}을(를) 등록했습니다.`);
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(readPostError(error, '저장에 실패했습니다.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePost(postId);
      toast.success(`${meta.label}을(를) 삭제했습니다.`);
      setConfirmOpen(false);
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      toast.error(readPostError(error, '삭제에 실패했습니다.'));
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* 본문 + 미리보기가 길어서 뷰포트를 넘기므로 내용 자체를 스크롤시킨다 */}
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-2xl sm:max-w-2xl lg:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `${meta.label} 수정` : `${meta.label} 작성`}
            </DialogTitle>
            <DialogDescription>
              본문은 마크다운으로 저장됩니다. 제목·굵게·목록·링크·이미지·인용·코드만 쓸 수
              있고, HTML 태그는 글자 그대로 보입니다.
            </DialogDescription>
          </DialogHeader>

          {loadingDetail ? (
            <div className="space-y-4 py-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="post-title">제목</Label>
                  <CharCount current={form.title.length} max={TITLE_MAX} />
                </div>
                <Input
                  id="post-title"
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  placeholder={`${meta.label} 제목`}
                  className="rounded-xl"
                  aria-invalid={form.title.length > TITLE_MAX}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="post-published-at">발행일시</Label>
                <Input
                  id="post-published-at"
                  type="datetime-local"
                  value={form.publishedAt}
                  onChange={(e) => setField('publishedAt', e.target.value)}
                  className="w-full rounded-xl sm:w-64"
                  aria-invalid={publishedAtUtc === null}
                />
                <p className="text-xs text-muted-foreground">
                  한국 시간 기준입니다. 미래 시각으로 두면 그 시각까지 앱에 노출되지 않습니다
                  (예약 발행).
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="post-body">본문</Label>
                  <CharCount current={form.body.length} max={BODY_MAX} />
                </div>
                <MarkdownBodyEditor
                  value={form.body}
                  onChange={setBody}
                  disabled={submitting || deleting}
                  onUploadingChange={setUploadingImage}
                />
                {uploadingImage && (
                  <p className="text-xs text-muted-foreground">
                    이미지를 올리는 중입니다. 업로드가 끝나면 저장할 수 있어요.
                  </p>
                )}
              </div>

              <Separator />

              <DialogFooter className="gap-2 sm:justify-between">
                {/* 삭제는 수정 모드에만 있고, 확인 다이얼로그를 한 번 더 거친다 */}
                {isEdit ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="rounded-xl font-bold"
                    onClick={() => setConfirmOpen(true)}
                    disabled={submitting || deleting}
                  >
                    <Trash2 className="size-4" />
                    삭제
                  </Button>
                ) : (
                  <span />
                )}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl font-bold"
                    onClick={() => onOpenChange(false)}
                    disabled={submitting || deleting}
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    className="rounded-xl font-bold"
                    disabled={!canSubmit || deleting}
                  >
                    {submitting && <Loader2 className="size-4 animate-spin" />}
                    저장
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 삭제 확인.
          편집 다이얼로그의 자식으로 중첩하지 않고 형제로 둔다 — Radix 는 각각 포털로 나가므로
          겹쳐 뜨는 데 문제가 없고, 확인을 취소했을 때 편집 폼이 입력값을 유지한 채 남는다. */}
      <Dialog open={confirmOpen} onOpenChange={(next) => !deleting && setConfirmOpen(next)}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{meta.label}을(를) 삭제할까요?</DialogTitle>
            <DialogDescription>
              삭제하면 되돌릴 수 없고 앱에서도 즉시 사라집니다.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm font-medium break-words">
            {form.title || '(제목 없음)'}
          </p>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 rounded-xl font-bold"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 rounded-xl font-bold"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 공지사항 · 업데이트 목록 화면.
 *
 * `kind` 만 다른 두 페이지가 이 컴포넌트를 공유한다(`/posts/notices`, `/posts/releases`).
 *
 * 페이지네이션이 「더 보기」인 이유는 서버가 커서 방식이기 때문이다(계약 §2). total 도
 * 오프셋도 없어서 "3페이지로 점프"를 만들 수 없으므로, 페이지 번호 UI 를 흉내 내지 말고
 * 이어 붙이기만 한다.
 *
 * 검색·상태 필터도 같은 이유로 전부 서버에 위임한다. 그리고 **조건이 바뀌면 지금까지 이어
 * 붙인 목록과 커서를 통째로 버리고 첫 페이지부터 다시 받는다** — 옛 조건으로 받은 커서를
 * 새 조건에 그대로 물리면 서버가 엉뚱한 지점부터 내려주거나 400 을 준다.
 */
function PostBoard({ kind }) {
  const meta = KIND_META[kind];

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 입력 중인 검색어(searchInput)와 실제 조회에 쓰인 검색어(search)를 분리한다.
  // AuditLogs 는 디바운스로 타이핑마다 조회하지만 여기서는 그러지 않는다 — 커서 방식이라
  // 요청이 잦으면 진행 중이던 「더 보기」와 새 조회의 커서가 뒤엉킨다. Enter 나 조회 버튼으로만 쏜다.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(POST_STATUS.ALL);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState(null);

  // 요청 세대 번호. 「더 보기」로 이어 붙이는 중에 목록을 처음부터 다시 불러오면
  // 늦게 온 옛 응답이 새 목록 뒤에 붙어 중복 행이 생긴다. 그 응답을 버리기 위한 장치다.
  const requestIdRef = useRef(0);

  /**
   * 현재 조건으로 첫 페이지부터 다시 불러온다.
   *
   * 저장·삭제 뒤에도, 검색어·상태가 바뀌었을 때도 전부 이 경로로 되돌린다. 세대 번호를
   * 올리므로 진행 중이던 「더 보기」 응답은 도착해도 버려진다.
   */
  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    try {
      const { items: page, nextCursor: cursor } = await fetchPosts({
        kind,
        search,
        status,
      });
      if (requestIdRef.current !== requestId) return;
      setItems(page);
      setNextCursor(cursor);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setItems([]);
      setNextCursor(null);
      toast.error(readPostError(error, `${meta.label} 목록을 불러오지 못했습니다.`));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [kind, meta.label, search, status]);

  // search·status 가 reload 의 의존성이라 조건이 바뀌면 이 효과가 알아서 첫 페이지를 다시 받는다.
  useEffect(() => {
    reload();
  }, [reload]);

  /** 다음 페이지를 뒤에 이어 붙인다. */
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;

    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor: cursor } = await fetchPosts({
        kind,
        cursor: nextCursor,
        // 커서만 보내고 조건을 빠뜨리면 서버가 필터 없는 뒷장을 내려줄 수 있다. 항상 함께 보낸다.
        search,
        status,
      });
      // 그 사이 reload 가 돌았다면 이 응답은 이미 낡은 목록의 뒷장이다. 버린다.
      if (requestIdRef.current !== requestId) return;
      setItems((prev) => [...prev, ...page]);
      setNextCursor(cursor);
    } catch (error) {
      toast.error(readPostError(error, '다음 목록을 불러오지 못했습니다.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const openCreate = () => {
    setEditingPostId(null);
    setEditorOpen(true);
  };

  const openEdit = (postId) => {
    setEditingPostId(postId);
    setEditorOpen(true);
  };

  /**
   * 검색 실행. Enter(폼 submit)와 조회 버튼이 함께 쓴다.
   *
   * 값이 그대로면 state 가 안 바뀌어 reload 효과가 돌지 않는다. 그때는 직접 reload 를 불러
   * "눌렀는데 아무 일도 안 일어나는" 버튼이 되지 않게 한다(새로고침 용도로도 쓰인다).
   */
  const submitSearch = (event) => {
    event.preventDefault();
    const next = searchInput.trim();
    if (next === search) reload();
    else setSearch(next);
  };

  /**
   * 지금 보고 있는 목록이 필터를 거친 결과인가.
   *
   * 입력 중인 searchInput 이 아니라 **실제 조회에 쓰인 search** 로 판정한다 — 빈 목록 문구를
   * 가르는 기준이라, 아직 조회하지 않은 입력값 때문에 "검색 결과가 없습니다" 가 뜨면 거짓말이 된다.
   */
  const filtered = Boolean(search) || status !== POST_STATUS.ALL;

  /** 초기화 버튼 노출 기준. 이쪽은 아직 조회하지 않은 입력값도 지울 수 있어야 하므로 입력값도 본다. */
  const hasFilterInput = filtered || Boolean(searchInput);

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatus(POST_STATUS.ALL);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{meta.description}</p>
        <Button type="button" className="rounded-xl font-bold" onClick={openCreate}>
          <Plus className="size-4" />
          {meta.createLabel}
        </Button>
      </div>

      <section className="rounded-2xl border border-border bg-card">
        {/* 필터바 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <div className="mr-auto flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            <h3 className="text-sm font-bold">{meta.label} 목록</h3>
          </div>

          {/* 상태 세그먼트. 값이 바뀌는 즉시 조회한다 —
              선택지가 셋뿐이라 오조작이 드물고, 검색어와 달리 '입력 중' 상태가 없다. */}
          <div className="flex items-center rounded-xl border border-border p-0.5">
            {STATUS_SEGMENTS.map((segment) => {
              const active = status === segment.value;
              return (
                <button
                  key={segment.value || 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(segment.value)}
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

          {/* 검색. form 으로 감싸서 Enter 와 조회 버튼이 같은 경로를 타게 한다. */}
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={meta.searchPlaceholder}
                className="h-9 w-56 rounded-xl pl-8 text-sm"
                aria-label={`${meta.label} 제목 검색`}
              />
            </div>
            <Button type="submit" variant="outline" className="h-9 rounded-xl" disabled={loading}>
              조회
            </Button>
          </form>

          {/* 조건이 걸려 있을 때만 노출한다. 늘 떠 있으면 누를 일이 없는 버튼이 자리만 차지한다. */}
          {hasFilterInput && (
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-xl"
              onClick={resetFilters}
              disabled={loading}
            >
              <RotateCcw className="size-4" />
              초기화
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">제목</TableHead>
              <TableHead className="w-44">발행일시</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-44 pr-5">수정일</TableHead>
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
                  {/* 필터 때문에 0건인 것과 애초에 글이 없는 것을 반드시 구분한다.
                      같은 문구를 쓰면 운영자가 데이터가 지워진 줄 안다. */}
                  {filtered ? '검색 결과가 없습니다.' : meta.empty}
                </TableCell>
              </TableRow>
            ) : (
              items.map((post) => {
                const scheduled = isScheduled(post.publishedAt);
                return (
                  <TableRow
                    key={post.postId}
                    // 행 전체가 수정 진입점이다. 키보드로도 열 수 있어야 해서 role/tabIndex 를 준다.
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => openEdit(post.postId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEdit(post.postId);
                      }
                    }}
                  >
                    <TableCell className="py-3 pl-5">
                      <div className="flex items-start gap-2">
                        <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {post.title || '(제목 없음)'}
                          </p>
                          {/* excerpt 는 서버가 본문 앞 100자를 잘라 준 것이다. 목록에 body 가
                              없으므로 내용을 가늠할 수단은 이것뿐이라 한 줄로 보여 준다.

                              🔴 본문이 마크다운이 된 뒤로도 **여기서는 렌더하지 않는다**(§2.1).
                              100자에서 기계적으로 잘리므로 `**`·`![](` 같은 기호가 중간에서
                              끊긴 채 섞여 오고, 그걸 렌더하면 깨진 서식이 나온다. 더 나쁜 것은
                              HTML 로 꽂는 경우로, 목록 셀이 새니타이즈를 우회하는 구멍이 된다.
                              문자열 그대로 두는 것이 계약이 정한 사용법이다. */}
                          {post.excerpt && (
                            <p className="truncate text-xs text-muted-foreground">
                              {post.excerpt}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground tabular-nums">
                      {formatKstDateTime(post.publishedAt)}
                    </TableCell>
                    <TableCell className="py-3">
                      {scheduled ? (
                        <Badge variant="secondary">예약</Badge>
                      ) : (
                        <Badge variant="outline">발행됨</Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-3 pr-5 text-sm text-muted-foreground tabular-nums">
                      {formatKstDateTime(post.updatedAt)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* nextCursor 가 null 이면 마지막 장이다. 버튼을 남겨 두면 누를 게 없는 버튼이 된다. */}
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

      <PostEditorDialog
        kind={kind}
        postId={editingPostId}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        // 저장·삭제 뒤에는 첫 페이지부터 다시 받는다. 커서 방식이라 "그 행만 갱신" 하면
        // 정렬 위치가 바뀐 경우(발행일시 수정)에 목록이 실제 순서와 어긋난다.
        onSaved={reload}
        onDeleted={reload}
      />
    </div>
  );
}

export default PostBoard;
