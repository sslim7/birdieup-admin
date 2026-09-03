/**
 * 사이드바 / 헤더가 공유하는 메뉴 정의.
 *
 * 구조는 kiik-admin 의 config/navigation.js 를 그대로 따른다:
 *   NavItem  = { label, href, icon, permission?, adminOnly? }
 *   NavGroup = { label, icon, children: NavItem[] }
 *   navigation = { main: NavEntry[], system: NavItem[] }
 *
 * icon 은 문자열이며, sidebar.jsx 의 iconMap 에서 lucide-react 컴포넌트로 매핑된다.
 *
 * 권한 모델:
 *   - permission: 토큰 클레임의 permissions 맵({ '<key>': true })에서 찾는 키.
 *     키는 href 의 슬래시를 하이픈으로 바꾼 값이다('/posts/notices' → 'posts-notices').
 *     isAdmin 계정은 permissions 와 무관하게 전 메뉴에 접근한다.
 *   - adminOnly: isAdmin 계정만 접근 가능(백엔드도 비-admin 에게 403 을 준다).
 *   - 둘 다 없는 항목(홈)은 로그인한 누구나 접근한다.
 */

/** NavEntry 가 그룹인지 판별 */
export function isNavGroup(entry) {
  return 'children' in entry;
}

export const navigation = {
  main: [
    { label: '홈', href: '/', icon: 'Home' },
    {
      label: '소식',
      icon: 'Megaphone',
      children: [
        { label: '공지사항', href: '/posts/notices', icon: 'Bell', permission: 'posts-notices' },
        { label: '업데이트', href: '/posts/releases', icon: 'Sparkles', permission: 'posts-releases' },
      ],
    },
    { label: '제안받아요', href: '/suggestions', icon: 'MessageSquareHeart', permission: 'suggestions' },
    { label: '이모티콘', href: '/emoticons', icon: 'Smile', permission: 'emoticons' },
  ],
  system: [
    { label: '사용자 관리', href: '/users', icon: 'UserCog', adminOnly: true },
    { label: '활동 로그', href: '/audit-logs', icon: 'ScrollText', adminOnly: true },
  ],
};

/**
 * 해당 메뉴 항목에 접근할 수 있는지 판정한다.
 *
 * @param {object} item   NavItem
 * @param {object|null} claims  getAdminClaims() 결과({ isAdmin, permissions, ... })
 * @returns {boolean}
 */
export function canAccessItem(item, claims) {
  if (!item) return true;
  if (item.adminOnly) return Boolean(claims?.isAdmin);
  if (item.permission) {
    return Boolean(claims?.isAdmin) || Boolean(claims?.permissions?.[item.permission]);
  }
  return true;
}

/**
 * 권한 부여 UI(사용자 관리)에서 쓰는 선택지 목록.
 * navigation.main 에서 홈(permission 없음)을 뺀 전 항목을 { key, label } 로 평탄화한다.
 * 그룹 자식은 "그룹라벨 - 아이템라벨", 최상위 단독 항목은 자기 라벨을 그대로 쓴다.
 */
export const permissionOptions = navigation.main.flatMap((entry) => {
  if (isNavGroup(entry)) {
    return entry.children
      .filter((child) => Boolean(child.permission))
      .map((child) => ({
        key: child.permission,
        label: `${entry.label} - ${child.label}`,
      }));
  }
  return entry.permission ? [{ key: entry.permission, label: entry.label }] : [];
});

/** NavEntry[] 를 NavItem[] 으로 평탄화 (그룹의 children 을 펼친다) */
export function flattenEntries(entries) {
  return entries.flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry]));
}

/** 사이드바/헤더가 쓰는 전체 메뉴 항목 목록 */
export const allNavItems = [
  ...flattenEntries(navigation.main),
  ...flattenEntries(navigation.system),
];

/**
 * 해당 href 가 현재 경로를 담당하는지 판정한다.
 * '/' 는 상세 경로까지 전부 삼켜버리므로 정확히 일치할 때만 매칭한다.
 */
function matchesHref(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * 현재 경로에 해당하는 메뉴의 href 를 돌려준다. 없으면 null.
 *
 * 한쪽이 다른 쪽의 접두사인 경로(/suggestions 와 /suggestions/:id)가 있어서
 * 단순 startsWith 로는 상위 메뉴가 먼저 매칭되어 버린다.
 * 매칭되는 것 중 가장 긴 href(= 가장 구체적인 메뉴)를 고른다.
 */
export function resolveActiveHref(pathname) {
  let best = null;
  for (const item of allNavItems) {
    if (!matchesHref(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}

/** 현재 경로에 해당하는 메뉴 항목을 돌려준다. 없으면 null. */
export function resolveActiveItem(pathname) {
  const href = resolveActiveHref(pathname);
  return href === null ? null : allNavItems.find((item) => item.href === href) ?? null;
}
