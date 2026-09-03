import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import adminUserService from '@/services/adminUserService';
import { deleteToken, saveToken } from '@/utils/auth';

/** 서버가 강제하는 최소 길이. 클라이언트에서도 미리 걸러 왕복을 줄인다. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * 비밀번호 입력 + 표시/숨김 토글 한 세트.
 * 새 비밀번호와 확인 두 칸이 완전히 같은 모양이어야 해서 컴포넌트로 뽑았다.
 */
function PasswordField({ id, label, placeholder, value, onChange }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <Label
        htmlFor={id}
        className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder={placeholder}
          className="h-12 rounded-xl pr-12"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={visible ? '비밀번호 숨기기' : '비밀번호 표시'}
          onClick={() => setVisible((prev) => !prev)}
          className="absolute right-3 top-1/2 h-auto w-auto -translate-y-1/2 p-0 text-muted-foreground hover:bg-transparent hover:text-primary"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * 에러 응답에서 표시할 문구를 고른다.
 * 서버 에러는 { code, message, details? } 이고 message 가 화면에 그대로 띄워도 되는
 * 한국어라 그것을 우선 쓴다("기존 비밀번호와 같습니다" 같은 구체적인 사유가 여기 담긴다).
 */
function readErrorMessage(error) {
  const serverMessage = error?.response?.data?.message;
  if (serverMessage) return serverMessage;

  if (error?.response?.status === 400) {
    return '새 비밀번호가 규칙에 맞지 않습니다.';
  }
  return '오류가 발생했습니다. 다시 시도해 주세요.';
}

/**
 * 첫 로그인 비밀번호 변경 화면.
 *
 * mustChangePassword 가 걸린 계정은 App.jsx 의 가드가 이 경로로 보내며,
 * 변경에 성공하기 전까지 다른 페이지에 접근할 수 없다.
 * 사이드바/헤더 셸 밖에서 단독으로 렌더된다.
 */
export default function ChangePassword() {
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const response = await adminUserService.changePassword({
        newPassword,
      });

      // 정상 경로: mustChangePassword 가 해제된 새 토큰으로 교체하고 홈으로 간다.
      const accessToken = response?.data?.accessToken;
      if (accessToken) {
        saveToken(accessToken);
        toast.success('비밀번호가 변경되었습니다.');
        navigate('/', { replace: true });
        return;
      }

      // 방어 코드: 토큰이 내려오지 않으면 기존 토큰이 낡은 플래그를 갖고 있으므로
      // 세션을 정리하고 재로그인을 유도한다.
      await deleteToken();
      toast.success('비밀번호가 변경되었습니다. 다시 로그인해 주세요.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(readErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-10 shadow-xl">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="size-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-black tracking-tight text-foreground">
              비밀번호 변경
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              초기 비밀번호를 변경해야 서비스를 이용할 수 있습니다.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <PasswordField
            id="new-password"
            label="새 비밀번호"
            placeholder={`새 비밀번호 입력 (${MIN_PASSWORD_LENGTH}자 이상)`}
            value={newPassword}
            onChange={setNewPassword}
          />
          <PasswordField
            id="confirm-password"
            label="새 비밀번호 확인"
            placeholder="새 비밀번호 재입력"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/20 active:scale-[0.98]"
          >
            {loading ? <Loader2 className="size-5 animate-spin" /> : '비밀번호 변경'}
          </Button>
        </form>
      </div>
    </div>
  );
}
