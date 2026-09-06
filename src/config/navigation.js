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
 *   - 둘 다 없는 항목(대시보드=홈)은 로그인한 누구나 접근한다. 이유는 METRICS_PERMISSION 주석 참고.
 */

/** NavEntry 가 그룹인지 판별 */
export function isNavGroup(entry) {
  return 'children' in entry;
}

export const navigation = {
  main: [
    { label: '대시보드', href: '/', icon: 'LayoutDashboard' },
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
 * 지표 대시보드(홈) 데이터 조회 권한 키.
 *
 * 🔴 **이 키를 navigation 의 홈 항목에 permission 으로 달면 안 된다.**
 * 라우트 가드(App.jsx 의 RequireMenuPermission)는 권한 없는 경로를 홈으로 되돌리는데,
 * 그 홈까지 막히면 홈 → 홈으로 무한 리다이렉트가 된다. 로그인 후 착지점은 누구나
 * 열려 있어야 하므로 화면은 열어 두고, 지표 **API** 만 이 키로 막는다.
 * 최종 판정자는 서버다 — 권한이 없으면 GET /admin/metrics/* 가 403 을 준다(docs/admin-api.md §8).
 */
export const METRICS_PERMISSION = 'metrics';

/**
 * navigation 에서 파생되지 않는 권한 키들.
 *
 * permissionOptions 는 원래 navigation.main 에서만 파생됐는데, 그러면 메뉴에 permission 을
 * 달 수 없는 지표 권한이 권한 부여 UI 에서 통째로 사라진다. 그래서 파생분 **앞에** 얹는다.
 */
const standalonePermissionOptions = [
  { key: METRICS_PERMISSION, label: '대시보드 - 지표' },
];

/** navigation.main 에서 파생되는 권한 선택지 (그룹 자식은 "그룹라벨 - 아이템라벨") */
const derivedPermissionOptions = navigation.main.flatMap((entry) => {
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

/**
 * 권한 부여 UI(사용자 관리)에서 쓰는 선택지 목록.
 * 메뉴에서 파생되는 키(공지·업데이트·제안·이모티콘)에 메뉴 밖 키(지표)를 앞에 붙인 것이다.
 */
export const permissionOptions = [
  ...standalonePermissionOptions,
  ...derivedPermissionOptions,
];

/**
 * 지표 API 를 부를 수 있는 계정인지 판정한다.
 *
 * 화면은 이걸로 403 이 뻔한 요청을 아예 보내지 않는 데만 쓴다. 클레임은 로그인 시점에
 * 굳은 값이라 권한이 방금 회수됐어도 true 가 나올 수 있으므로, 호출부는 응답의 403 도
 * 함께 처리해야 한다.
 */
export function canAccessMetrics(claims) {
  return Boolean(claims?.isAdmin) || Boolean(claims?.permissions?.[METRICS_PERMISSION]);
}

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
