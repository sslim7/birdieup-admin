import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/layout/sidebar-context';
import { resolveActiveItem } from '@/config/navigation';

export function Header() {
  const { pathname } = useLocation();
  const { toggle } = useSidebar();

  // 메뉴에 없는 상세 경로(/user/point/list 등)는 '홈' 으로 폴백한다.
  const pageTitle = resolveActiveItem(pathname)?.label ?? '홈';

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
    </header>
  );
}
