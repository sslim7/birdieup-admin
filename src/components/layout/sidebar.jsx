import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronRight,
  Home,
  LogOut,
  Megaphone,
  MessageSquareHeart,
  ScrollText,
  Smile,
  Sparkles,
  UserCog,
} from 'lucide-react';
import { useSidebar } from '@/components/layout/sidebar-context';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  navigation,
  isNavGroup,
  resolveActiveHref,
  canAccessItem,
} from '@/config/navigation';
import BrandMark from '@/components/brand-mark';
import { getAdminClaims, deleteToken } from '@/utils/auth';

/** navigation.js 의 icon 문자열 → lucide 컴포넌트 매핑 */
const iconMap = {
  Bell,
  ChevronRight,
  Home,
  Megaphone,
  MessageSquareHeart,
  ScrollText,
  Smile,
  Sparkles,
  UserCog,
};

function NavGroupItem({ group, activeHref, onNavigate }) {
  const hasActiveChild = group.children.some((child) => child.href === activeHref);
  const [expanded, setExpanded] = useState(hasActiveChild);

  // SPA 에서는 사이드바가 언마운트되지 않으므로, 다른 그룹으로 이동했을 때
  // 해당 그룹이 자동으로 펼쳐지도록 활성 상태를 따라간다.
  useEffect(() => {
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  const Icon = iconMap[group.icon];

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all font-medium cursor-pointer ${
          hasActiveChild
            ? 'text-primary'
            : 'text-sidebar-foreground/60 hover:bg-primary/10 hover:text-primary'
        }`}
      >
        {Icon && <Icon className="size-5" />}
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronRight
          className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <ul className="space-y-1 pl-6 pt-1">
          {group.children.map((child) => {
            const ChildIcon = iconMap[child.icon];
            const isActive = child.href === activeHref;

            return (
              <li key={child.href}>
                <Link
                  to={child.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-sidebar-foreground/60 font-medium hover:bg-primary/10 hover:text-primary'
                  }`}
                >
                  {ChildIcon && <ChildIcon className="size-4" />}
                  {child.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}

function NavSection({ label, items, activeHref, onNavigate }) {
  if (items.length === 0) return null;

  return (
    <div>
      {label && (
        <p className="px-4 pt-4 pb-2 text-[10px] font-bold text-sidebar-foreground/40 uppercase tracking-widest">
          {label}
        </p>
      )}
      <ul className="space-y-1 px-4">
        {items.map((item) => {
          if (isNavGroup(item)) {
            return (
              <NavGroupItem
                key={item.label}
                group={item}
                activeHref={activeHref}
                onNavigate={onNavigate}
              />
            );
          }

          const Icon = iconMap[item.icon];
          const isActive = item.href === activeHref;

          return (
            <li key={item.href}>
              <Link
                to={item.href}
                onClick={onNavigate}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-sidebar-foreground/60 font-medium hover:bg-primary/10 hover:text-primary'
                }`}
              >
                {Icon && <Icon className="size-5" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * JWT 클레임에서 표시용 프로필을 뽑는다. 클레임이 없으면 기본값으로 폴백.
 * birdieup-was 는 name/email 을 sub 객체 안에 넣으므로 getAdminClaims() 를 경유한다.
 */
function readProfile() {
  const claims = getAdminClaims();
  return {
    name: claims?.name || claims?.admin_name || claims?.username || '관리자',
    email: claims?.email || claims?.admin_email || 'admin@birdieup.kr',
  };
}

/**
 * 접근 권한이 있는 메뉴만 남긴다.
 * 그룹은 접근 가능한 자식이 하나도 없으면 그룹째 제외한다.
 */
function filterEntries(entries, claims) {
  return entries.reduce((acc, entry) => {
    if (isNavGroup(entry)) {
      const children = entry.children.filter((child) => canAccessItem(child, claims));
      if (children.length > 0) acc.push({ ...entry, children });
      return acc;
    }
    if (canAccessItem(entry, claims)) acc.push(entry);
    return acc;
  }, []);
}

function SidebarContent({ onNavigate }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeHref = resolveActiveHref(pathname);
  const { name, email } = readProfile();
  const claims = getAdminClaims();
  const mainItems = filterEntries(navigation.main, claims);
  const systemItems = filterEntries(navigation.system, claims);

  const handleLogout = async () => {
    await deleteToken();
    navigate('/login', { replace: true });
  };

  return (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 p-6">
        <BrandMark className="size-10 shrink-0 rounded-xl shadow-lg shadow-primary/20" />
        <div>
          <h1 className="text-lg font-bold leading-tight tracking-tight text-sidebar-foreground">
            BirdieUp Admin
          </h1>
          <p className="text-xs text-sidebar-foreground/50 font-medium uppercase tracking-widest">
            Console
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto mt-4 space-y-1">
        <NavSection
          label=""
          items={mainItems}
          activeHref={activeHref}
          onNavigate={onNavigate}
        />
        <NavSection
          label="Support & Settings"
          items={systemItems}
          activeHref={activeHref}
          onNavigate={onNavigate}
        />
      </nav>

      {/* User Profile */}
      <div className="mt-auto border-t border-sidebar-border p-6">
        <div className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarImage
              src={`https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(name)}`}
              alt={name}
            />
            <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-sidebar-foreground">
              {name}
            </p>
            <p className="text-xs text-sidebar-foreground/50 truncate">{email}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="로그아웃"
            className="text-sidebar-foreground/40 hover:text-primary hover:bg-transparent"
            onClick={handleLogout}
          >
            <LogOut className="size-5" />
          </Button>
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  const { isOpen, close } = useSidebar();
  const { pathname } = useLocation();

  // 라우트가 바뀌면 모바일 드로어를 닫는다
  useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <>
      {/* Desktop sidebar - always visible on lg+ */}
      <aside className="hidden lg:flex h-full w-72 flex-col bg-sidebar border-r border-sidebar-border shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile drawer overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={close} />
      )}

      {/* Mobile drawer */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent onNavigate={close} />
      </aside>
    </>
  );
}
