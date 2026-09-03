import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/layout/sidebar-context';
import { resolveActiveItem } from '@/config/navigation';

export function Header() {
  const { pathname } = useLocation();
  const { toggle } = useSidebar();

  // 메뉴에 없는 상세 경로(/user/point/list 등)는 '홈' 으로 폴백한다.
  const pageTitle = resolveActiveItem(pathname)?.label ?? '홈';
  const isHome = pathname === '/';

  return (
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur-md flex items-center px-4 lg:px-8 sticky top-0 z-10">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden mr-2 shrink-0"
        onClick={toggle}
      >
        <Menu className="size-5" />
      </Button>
      <h2 className="text-xl font-bold tracking-tight">{pageTitle}</h2>

      {/*
        우측 끝 홈 버튼. 메뉴를 타고 들어가도 한 번에 홈으로 빠져나가는 탈출구다.
        birdieup-app 의 screen-header 와 같은 규격(34px 원 · 20px 글리프 · 잉크 배경)이라
        두 화면을 오가는 사람이 같은 버튼으로 읽는다.

        집 모양 대신 브랜드의 `b` 를 세운다. 원본 심볼은 진초록이라 진초록 원 위에서
        보이지 않으므로, 알파만 남기고 라임으로 칠해 둔 파일을 쓴다(앱과 같은 자산).

        홈에서는 감춘다 — 지금 있는 자리로 데려가는 버튼은 눌러도 아무 일이 없고,
        그러면 눌리지 않는 버튼인지 고장인지 구분되지 않는다.
      */}
      {!isHome && (
        <Link
          to="/"
          aria-label="홈으로"
          title="홈으로"
          className="ml-auto flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#12301F] transition-colors hover:bg-[#1B3F2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <img src="/home-b.png" alt="" className="size-5 object-contain" />
        </Link>
      )}
    </header>
  );
}
