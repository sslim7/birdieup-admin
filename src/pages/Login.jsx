import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import BrandMark from '@/components/brand-mark';
import apiClient from '@/services/apiClient';
import { saveToken, mustChangePassword } from '@/utils/auth';

/**
 * 관리자 로그인.
 *
 * 백엔드 계약:
 *   POST /auth/admin.login
 *     request  { email: string, password: string, rememberMe: boolean }
 *     response { accessToken: string }   // JWT
 *
 * 🔴 키는 camelCase 다(docs/admin-api.md §0). kiik-admin 의 snake_case 를 들고 오면
 *    요청은 rememberMe 가 빠진 채 나가고 응답은 undefined 로 읽혀, 서버가 200 을 준
 *    로그인이 화면에서만 실패한다.
 *
 * JWT 클레임에 mustChangePassword 가 실린다(birdieup-was 는 sub 객체 안에 넣는다).
 * 초기 비밀번호 계정은 로그인 직후 /change-password 로 보낸다.
 *
 * 기존 SMS 2단계 인증 방식은 이메일/비밀번호 방식으로 완전히 대체되었다.
 */
/**
 * 로그인 실패 응답에서 표시할 문구를 고른다.
 *
 * 백엔드 계약(docs/admin-api.md §0·§1.3): 에러는 언제나
 *   { code: string, message: string, details?: object }
 * 이고 message 는 화면에 그대로 띄워도 되는 한국어 문장이다
 *   401 "등록된 어드민 계정이 아닙니다" / "비밀번호를 확인하세요"
 *   403 "비활성 계정입니다"  ·  400 VALIDATION_FAILED
 * 응답 자체가 없을 때(네트워크·CORS)는 자격 문제가 아니므로 다르게 말한다.
 */
function readLoginError(err) {
  const message = err?.response?.data?.message;
  if (typeof message === 'string' && message) return message;

  // 응답이 아예 없으면 서버에 닿지 못한 것이다. 자격 문제로 안내하면
  // WAS 가 꺼져 있거나 CORS 가 막힌 상황에서 비밀번호만 계속 다시 치게 된다.
  if (!err?.response) {
    return '서버에 연결할 수 없습니다. API 주소와 서버 상태를 확인해 주세요.';
  }

  return '이메일 또는 비밀번호가 올바르지 않습니다.';
}

const Login = () => {
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.post('/auth/admin.login', {
        email,
        password,
        rememberMe,
      });

      const accessToken = response?.data?.accessToken;
      if (!accessToken) {
        setError('로그인 응답이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      saveToken(accessToken);

      // 초기 비밀번호를 쓰는 계정은 변경 화면을 먼저 통과해야 한다.
      // (플래그는 방금 저장한 토큰의 클레임에서 읽는다)
      if (mustChangePassword()) {
        navigate('/change-password', { replace: true });
        return;
      }

      navigate('/', { replace: true });
    } catch (err) {
      setError(readLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Left Section: Login Form */}
      <div className="z-10 flex w-full flex-col border-r border-border bg-login-bg shadow-2xl lg:w-[480px]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-8 py-6">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9 shrink-0 rounded-xl shadow-lg shadow-primary/20" />
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              BirdieUp Admin
            </h2>
          </div>
        </header>

        {/* Form */}
        <div className="flex flex-1 flex-col justify-center overflow-y-auto px-10 py-12">
          <div className="mb-10">
            <h1 className="mb-2 text-4xl font-black leading-tight tracking-tight text-foreground">
              Welcome Back
            </h1>
            <p className="text-base text-muted-foreground">
              Sign in to get started
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="login-email"
                className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Email
              </Label>
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="user@company.com"
                className="h-14 rounded-xl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="login-password"
                className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Password
              </Label>
              <div className="relative">
                <Input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="비밀번호를 입력하세요"
                  className="h-14 rounded-xl pr-12"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 h-auto w-auto p-0 text-muted-foreground hover:text-primary hover:bg-transparent"
                >
                  {showPassword ? (
                    <EyeOff className="size-5" />
                  ) : (
                    <Eye className="size-5" />
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            <label className="group flex w-fit cursor-pointer items-center gap-2">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(v) => setRememberMe(v === true)}
              />
              <span className="text-sm text-muted-foreground transition-colors group-hover:text-primary">
                로그인 유지
              </span>
            </label>

            <Button
              type="submit"
              disabled={loading}
              className="h-14 w-full rounded-xl text-base font-bold shadow-lg shadow-primary/20 active:scale-[0.98]"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : '로그인'}
            </Button>
          </form>

          <div className="mt-12 border-t border-border pt-8 text-center">
            <p className="text-sm text-muted-foreground">
              계정이 없으신가요?{' '}
              <Button
                type="button"
                variant="link"
                onClick={() => setShowAccessDialog(true)}
                className="h-auto p-0 font-bold text-primary"
              >
                접근 권한 요청
              </Button>
            </p>
          </div>
        </div>

        {/* Access Request Dialog */}
        <Dialog open={showAccessDialog} onOpenChange={setShowAccessDialog}>
          <DialogContent className="rounded-2xl sm:max-w-md">
            <DialogHeader>
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="size-6 text-primary" />
              </div>
              <DialogTitle className="text-center">접근 권한 요청</DialogTitle>
              <DialogDescription className="text-center">
                BirdieUp Admin 계정은 직접 가입할 수 없습니다.
                <br />
                시스템 관리자에게 계정 생성을 요청해 주세요.
              </DialogDescription>
            </DialogHeader>
            <Button
              onClick={() => setShowAccessDialog(false)}
              className="h-11 w-full rounded-xl text-sm font-bold shadow-none active:scale-[0.98]"
            >
              확인
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      {/* Right Section: Dashboard Graphic (순수 장식) */}
      <div className="relative hidden flex-1 overflow-hidden bg-panel-dark lg:flex lg:items-center lg:justify-center">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-panel-dark-warm via-panel-dark to-panel-dark-deep" />

        {/* Dot grid pattern */}
        <div className="pointer-events-none absolute inset-0 text-primary opacity-10">
          <svg className="size-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="dots"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="20" cy="20" r="1" fill="currentColor" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)" />
          </svg>
        </div>

        {/* Dashboard mockup */}
        <div className="relative flex h-full w-full items-center justify-center p-20">
          <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40 shadow-2xl backdrop-blur-md">
            {/* Header bar */}
            <div className="flex h-10 items-center justify-between border-b border-white/5 bg-white/5 px-4">
              <div className="flex gap-1.5">
                <div className="size-2 rounded-full bg-red-500/50" />
                <div className="size-2 rounded-full bg-amber-500/50" />
                <div className="size-2 rounded-full bg-emerald-500/50" />
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary/60">
                BirdieUp Admin Console
              </div>
            </div>

            {/* Node visualization */}
            <div className="absolute inset-0 flex items-center justify-center text-primary">
              {/* SVG connecting lines */}
              <svg
                className="absolute inset-0 h-full w-full opacity-30"
                preserveAspectRatio="none"
              >
                <path
                  d="M100 100 L400 300 L700 150"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.5"
                />
                <path
                  d="M150 400 L500 200 L850 450"
                  fill="none"
                  stroke="currentColor"
                  strokeDasharray="5,5"
                  strokeWidth="1"
                />
                <circle cx="400" cy="300" fill="currentColor" r="2" />
                <circle cx="700" cy="150" fill="currentColor" r="2" />
                <circle cx="500" cy="200" fill="currentColor" r="2" />
              </svg>

              {/* Central glow */}
              <div className="absolute h-[400px] w-[400px] rounded-full bg-primary/10 blur-[100px]" />

              {/* Data nodes */}
              <div className="relative flex items-center justify-center gap-12">
                {/* Node 1 */}
                <div className="relative h-40 w-32 -rotate-6 translate-y-4 rounded-lg border border-primary/40 bg-gradient-to-b from-primary/30 to-transparent p-4 backdrop-blur-sm">
                  <div className="mb-4 h-2 w-full rounded bg-primary/40" />
                  <div className="mb-2 h-1.5 w-2/3 rounded bg-primary/20" />
                  <div className="mb-2 h-1.5 w-full rounded bg-primary/20" />
                  <div className="h-1.5 w-1/2 rounded bg-primary/20" />
                  <div className="absolute -bottom-2 -right-2 font-mono text-[8px] text-primary/80">
                    NODE_01_ACTIVE
                  </div>
                </div>

                {/* Node 2 (centerpiece) */}
                <div className="z-10 flex h-60 w-48 scale-110 flex-col justify-between rounded-xl border border-primary/50 bg-gradient-to-br from-primary/40 to-panel-dark/80 p-6 shadow-2xl">
                  <div className="flex items-start justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/20">
                      <span className="text-sm font-black leading-none text-primary">
                        B
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] text-primary/60">
                        THROUGHPUT
                      </div>
                      <div className="text-xl font-bold text-white">94.2%</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-1 w-full overflow-hidden rounded bg-white/10">
                      <div className="h-full w-[85%] bg-primary" />
                    </div>
                    <div className="flex justify-between font-mono text-[9px] text-slate-400">
                      <span>ENCRYPTION: AES-256</span>
                      <span>STABLE</span>
                    </div>
                  </div>
                </div>

                {/* Node 3 */}
                <div className="h-40 w-32 rotate-6 -translate-y-4 rounded-lg border border-primary/40 bg-gradient-to-t from-primary/30 to-transparent p-4 backdrop-blur-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="size-2 animate-pulse rounded-full bg-primary" />
                    <div className="font-mono text-[9px] uppercase text-primary">
                      Syncing
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-8 w-full rounded-sm bg-primary/10" />
                    <div className="h-8 w-full rounded-sm bg-primary/10" />
                  </div>
                </div>
              </div>
            </div>

            {/* Left overlay panels */}
            <div className="absolute left-8 top-16 w-40 space-y-4">
              <div className="rounded-r-md border-l-2 border-primary bg-white/5 p-3">
                <div className="text-[8px] uppercase tracking-tighter text-slate-400">
                  System Health
                </div>
                <div className="text-xs font-semibold text-white">OPTIMAL</div>
              </div>
              <div className="rounded-r-md border-l-2 border-slate-600 bg-white/5 p-3 opacity-40">
                <div className="text-[8px] uppercase tracking-tighter text-slate-400">
                  Subnet Ops
                </div>
                <div className="text-xs font-semibold text-white">STANDBY</div>
              </div>
            </div>

            {/* Bottom-right system info */}
            <div className="absolute bottom-8 right-8 text-right font-mono">
              <div className="mb-1 text-[9px] text-primary">
                SYSTEM_BOOT_LOG: OK
              </div>
              <div className="mb-1 text-[9px] text-primary/60">
                CORE_TEMP: 34.2C
              </div>
              <div className="text-[9px] text-primary/40">
                USER_ACCESS: AUTHORIZED
              </div>
            </div>

            {/* Bottom monitoring bar */}
            <div className="absolute bottom-0 left-0 flex w-full items-center gap-4 bg-gradient-to-t from-black/60 to-transparent p-6">
              <div className="flex items-center gap-2 font-mono text-[10px] text-primary/80">
                <Loader2 className="size-3 animate-spin" />
                MONITORING ACTIVE...
              </div>
              <div className="h-px flex-1 bg-primary/20" />
              <div className="font-mono text-[10px] tracking-widest text-white/40">
                0x9923-FF2A
              </div>
            </div>
          </div>
        </div>

        {/* Bottom caption */}
        <div className="absolute bottom-16 left-1/2 max-w-md -translate-x-1/2 text-center">
          <h3 className="mb-3 text-2xl font-bold text-white">BirdieUp Admin</h3>
          <p className="text-sm leading-relaxed text-slate-400">
            버디업 운영 콘솔
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
