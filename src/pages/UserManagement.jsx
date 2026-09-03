import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, UserCog, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminId } from '@/utils/auth';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import adminUserService from '@/services/adminUserService';
import { permissionOptions } from '@/config/navigation';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 서버(POST /admin/admins)가 요구하는 최소 비밀번호 길이 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * axios 에러에서 화면에 띄울 문구를 고른다.
 *
 * 서버 에러는 전부 { code, message, details? } 이고 message 는 그대로 보여줘도 되는
 * 한국어 문장이다(docs/admin-api.md). 그래서 code 로 분기하지 않고 message 를 먼저 쓴다.
 * message 가 없는 경우(네트워크 단절 등)만 호출부가 준 fallback 으로 내려간다.
 */
function readErrorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

/** createdAt 을 한국식 날짜로 표기. 값이 없거나 파싱 실패면 '-' */
function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ko-KR');
}

/**
 * 응답 행을 화면용 shape 으로 정규화한다.
 * 서버가 필드를 생략해도(예: permissions 없음) 렌더가 터지지 않도록 기본값을 채운다.
 */
function normalizeAdmin(raw) {
  return {
    adminId: raw.adminId,
    email: raw.email ?? '',
    name: raw.name ?? '',
    isActive: Boolean(raw.isActive),
    isAdmin: Boolean(raw.isAdmin),
    permissions: raw.permissions ?? {},
    mustChangePassword: Boolean(raw.mustChangePassword),
    createdAt: raw.createdAt ?? null,
  };
}

/** permissions dict({key: true}) → 체크된 키 Set */
function toPermissionSet(permissions) {
  if (!permissions || typeof permissions !== 'object') return new Set();
  return new Set(
    Object.entries(permissions)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key)
  );
}

/** 체크된 키 Set → 서버가 요구하는 dict({key: true}). 해제된 키는 넣지 않는다 */
function toPermissionDict(permissionSet) {
  const dict = {};
  permissionSet.forEach((key) => {
    dict[key] = true;
  });
  return dict;
}

/**
 * 생성 폼 초기값.
 * mustChangePassword 는 서버 기본값이 true 다(계약 §1.3) — 발급한 초기 비밀번호를
 * 작업자가 계속 알고 있는 상태를 기본으로 두지 않기 위해 체크된 채로 시작한다.
 */
const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  mustChangePassword: true,
  isActive: true,
  isAdmin: false,
  permissions: new Set(),
};

/**
 * 생성/수정 공용 폼 다이얼로그.
 *
 * 생성/수정 모두 '첫 로그인 시 비밀번호 변경 요구' 체크박스를 작업자가 선택한다.
 * isActive(계정 활성화)는 생성 계약에 없어 수정 모드에서만 보여준다.
 * 수정 모드에서 비밀번호는 선택 입력이다(비우면 기존 유지).
 */
function AdminFormDialog({ mode, admin, open, onOpenChange, onSuccess }) {
  const isEdit = mode === 'edit';
  const isSelf = isEdit && admin?.adminId === getAdminId();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 다이얼로그가 열릴 때마다 초기값을 동기화한다
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError('');
    setSubmitting(false);
    if (isEdit && admin) {
      setForm({
        name: admin.name,
        email: admin.email,
        password: '',
        mustChangePassword: admin.mustChangePassword,
        isActive: admin.isActive,
        isAdmin: admin.isAdmin,
        permissions: toPermissionSet(admin.permissions),
      });
    } else {
      // permissions 는 Set 이라 EMPTY_FORM 인스턴스를 공유하지 않도록 새로 만든다
      setForm({ ...EMPTY_FORM, permissions: new Set() });
    }
  }, [open, isEdit, admin]);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  /** 메뉴 접근 권한 체크박스 토글 */
  const togglePermission = (key, checked) => {
    setForm((prev) => {
      const next = new Set(prev.permissions);
      if (checked) next.add(key);
      else next.delete(key);
      return { ...prev, permissions: next };
    });
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = '이름을 입력해 주세요.';
    if (!form.email.trim()) next.email = '이메일을 입력해 주세요.';
    else if (!EMAIL_PATTERN.test(form.email.trim()))
      next.email = '이메일 형식이 올바르지 않습니다.';
    if (!isEdit && !form.password) next.password = '비밀번호를 입력해 주세요.';
    else if (form.password && form.password.length < MIN_PASSWORD_LENGTH)
      next.password = `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setSubmitting(true);
    try {
      // permissions 는 반드시 dict 로 보낸다(배열은 서버가 400 을 준다)
      const permissions = toPermissionDict(form.permissions);

      if (isEdit) {
        // 본인 계정은 isAdmin/isActive 를 보내면 400 SELF_DEMOTION_FORBIDDEN 이므로
        // 아예 payload 에서 뺀다(토글은 비활성이라 값이 바뀔 일도 없다).
        await adminUserService.updateAdmin(admin.adminId, {
          name: form.name.trim(),
          isActive: isSelf ? undefined : form.isActive,
          isAdmin: isSelf ? undefined : form.isAdmin,
          permissions,
          mustChangePassword: form.mustChangePassword,
          password: form.password || undefined,
        });
        toast.success('사용자 정보를 수정했습니다.');
      } else {
        await adminUserService.createAdmin({
          email: form.email.trim(),
          name: form.name.trim(),
          password: form.password,
          isAdmin: form.isAdmin,
          permissions,
          mustChangePassword: form.mustChangePassword,
        });
        toast.success('새 사용자를 추가했습니다.');
      }
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      const message = readErrorMessage(
        error,
        isEdit ? '수정에 실패했습니다.' : '사용자 추가에 실패했습니다.'
      );
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = isEdit ? Pencil : UserPlus;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 권한 목록 때문에 내용이 길어지므로 뷰포트를 넘지 않게 스크롤을 준다 */}
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Icon className="size-5 text-primary" />
          </div>
          <DialogTitle className="text-center">
            {isEdit ? '사용자 수정' : '새 사용자 추가'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {isEdit
              ? `${admin?.name ?? ''} 계정 정보를 수정합니다.`
              : '기본값은 첫 로그인 시 비밀번호 변경을 요구하는 것입니다.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1" noValidate>
          <div className="space-y-2">
            <Label htmlFor="admin-name">이름</Label>
            <Input
              id="admin-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="홍길동"
              className="rounded-xl"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <p className="text-xs font-medium text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-email">이메일</Label>
            <Input
              id="admin-email"
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="admin@birdieup.kr"
              className="rounded-xl font-mono text-sm"
              aria-invalid={Boolean(errors.email)}
              disabled={isEdit}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                이메일은 변경할 수 없습니다.
              </p>
            )}
            {errors.email && (
              <p className="text-xs font-medium text-destructive">
                {errors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-password">비밀번호</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setField('password', e.target.value)}
              placeholder={
                isEdit ? '변경할 때만 입력' : `비밀번호 (${MIN_PASSWORD_LENGTH}자 이상)`
              }
              className="rounded-xl"
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password && (
              <p className="text-xs font-medium text-destructive">
                {errors.password}
              </p>
            )}
          </div>

          <div className="space-y-1 rounded-xl border border-border bg-muted/30 p-3">
            <label
              htmlFor="admin-must-change"
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
            >
              <Checkbox
                id="admin-must-change"
                checked={form.mustChangePassword}
                onCheckedChange={(v) => setField('mustChangePassword', v === true)}
              />
              <span className="text-sm font-medium">
                첫 로그인 시 비밀번호 변경 요구
              </span>
            </label>

            {/* 계정 활성화는 생성 계약에 없어 수정에서만 노출한다.
                본인 계정을 비활성화하면 스스로 잠기므로 서버가 400 으로 거절한다.
                눌린 뒤 에러를 보여주는 대신 토글을 아예 비활성 처리한다. */}
            {isEdit && (
            <label
              htmlFor="admin-active"
              className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                isSelf ? 'opacity-50' : 'cursor-pointer hover:bg-muted/60'
              }`}
            >
              <Checkbox
                id="admin-active"
                checked={form.isActive}
                disabled={isSelf}
                onCheckedChange={(v) => setField('isActive', v === true)}
              />
              <span className="text-sm font-medium">
                계정 활성화
                {isSelf && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    본인 계정은 변경할 수 없습니다
                  </span>
                )}
              </span>
            </label>
            )}

            {/* 관리자 권한: permissions 와 무관하게 전 메뉴 + 시스템 메뉴에 접근한다.
                본인 계정의 isAdmin 변경도 서버가 400 으로 거절하므로 토글을 비활성 처리한다. */}
            <label
              htmlFor="admin-is-admin"
              className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors ${
                isSelf ? 'opacity-50' : 'cursor-pointer hover:bg-muted/60'
              }`}
            >
              <Checkbox
                id="admin-is-admin"
                checked={form.isAdmin}
                disabled={isSelf}
                onCheckedChange={(v) => setField('isAdmin', v === true)}
              />
              <span className="text-sm font-medium">
                관리자 권한 부여
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (모든 메뉴)
                </span>
                {isSelf && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    본인 계정은 변경할 수 없습니다
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* 메뉴 접근 권한: 체크된 키만 { key: true } dict 로 서버에 보낸다 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>메뉴 접근 권한</Label>
              {form.isAdmin && (
                <span className="text-xs text-muted-foreground">
                  관리자는 모든 메뉴에 접근할 수 있습니다
                </span>
              )}
            </div>
            <div
              className={`max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-border bg-muted/30 p-2 ${
                form.isAdmin ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              {permissionOptions.map((option) => (
                <label
                  key={option.key}
                  htmlFor={`admin-perm-${option.key}`}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
                >
                  <Checkbox
                    id={`admin-perm-${option.key}`}
                    checked={form.permissions.has(option.key)}
                    disabled={form.isAdmin}
                    onCheckedChange={(v) => togglePermission(option.key, v === true)}
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          {submitError && (
            <div className="rounded-lg bg-destructive/10 px-4 py-2.5">
              <p className="text-sm font-medium text-destructive">
                {submitError}
              </p>
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
              disabled={submitting}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? '저장' : '사용자 생성'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const COLUMN_COUNT = 6;

function TableSkeleton() {
  return Array.from({ length: 4 }).map((_, rowIndex) => (
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

export default function UserManagement() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAdmin, setEditAdmin] = useState(null);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminUserService.fetchAdmins();
      setAdmins(list.map(normalizeAdmin));
    } catch (error) {
      setAdmins([]);
      toast.error(readErrorMessage(error, '사용자 목록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          어드민 콘솔에 접근하는 계정을 생성하고 관리합니다.
        </p>
        <Button
          type="button"
          className="rounded-xl font-bold"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          새 사용자 추가
        </Button>
      </div>

      {/* 사용자 목록 */}
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <UserCog className="size-4 text-primary" />
          <h3 className="text-sm font-bold">사용자 목록</h3>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>비밀번호 변경</TableHead>
              <TableHead>등록일</TableHead>
              <TableHead className="pr-5 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableSkeleton />
            ) : admins.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  등록된 관리자가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              admins.map((admin) => (
                <TableRow key={admin.adminId ?? admin.email}>
                  <TableCell className="pl-5 py-3 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      {admin.name || '-'}
                      {admin.isAdmin && (
                        <Badge className="border-0 bg-primary/10 text-primary">
                          어드민
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="font-mono text-sm">{admin.email}</span>
                  </TableCell>
                  <TableCell className="py-3">
                    {admin.isActive ? (
                      <Badge className="border-0 bg-success/10 text-success">
                        활성
                      </Badge>
                    ) : (
                      <Badge className="border-0 bg-destructive/10 text-destructive">
                        비활성
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    {admin.mustChangePassword ? (
                      <Badge className="border-0 bg-warning/10 text-warning">
                        변경 필요
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {formatDate(admin.createdAt)}
                  </TableCell>
                  <TableCell className="pr-5 py-3 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      onClick={() => setEditAdmin(admin)}
                    >
                      <Pencil className="size-3.5" />
                      수정
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <AdminFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={loadAdmins}
      />

      <AdminFormDialog
        mode="edit"
        admin={editAdmin}
        open={editAdmin !== null}
        onOpenChange={(open) => {
          if (!open) setEditAdmin(null);
        }}
        onSuccess={loadAdmins}
      />
    </div>
  );
}
