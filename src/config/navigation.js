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
    // 화면에 나가는 글자만 「의견보내기」다. href·permission 은 서버와 맞춰 둔 이름이라
    // 그대로 둔다(앱 쪽 suggestion-sheet.tsx 와 같은 자세).
    { label: '의견보내기', href: '/suggestions', icon: 'MessageSquareHeart', permission: 'suggestions' },
    { label: '이모티콘', href: '/emoticons', icon: 'Smile', permission: 'emoticons' },
  ],
  system: [
    { label: '사용자 관리', href: '/users', icon: 'UserCog', adminOnly: true },
    { label: '활동 로그', href: '/audit-logs', icon: 'ScrollText', adminOnly: true },
    /*
      스코어카드 OCR **자동 전송** 목록.

      🔴 **「의견보내기」 바로 아래에 두지 않았다.** 이것은 사람이 보낸 글이 아니라 앱이
      스코어카드를 가져올 때마다 자동으로(기본 켜짐) 올리는 기계 자료다. 답할 상대가 없고
      하는 일은 자료를 꺼내 쓰고 지우는 것뿐이다. 소식·의견 옆에 나란히 세우면 운영자가
      「답해야 하는 목록」으로 읽고 두 화면을 같은 일로 다루기 시작한다 — 그게 이 분리를
      무르는 첫걸음이다. 그래서 운영 도구가 모인 system 섹션(사이드바에서 제목으로
      갈라진다)에 두고, 성격이 가장 가까운 「장면 위치 보정」(역시 기계가 놓친 자리를
      사람이 손보는 도구) 위에 세운다.

      adminOnly 가 아니라 permission 을 쓰는 이유 — 서버가 권한 키로 막는다(계약 §10).
      다만 이 섹션의 키는 permissionOptions 로 파생되지 않아
      아래 standalonePermissionOptions 에 손으로 얹어야 한다(그 주석 참고).
    */
    {
      label: 'OCR 판독결과',
      href: '/scorecard-reports',
      icon: 'ScanText',
      permission: 'scorecard-reports',
    },
    // 옛 첨부의 좌표·촬영일시를 손으로 채우는 **임시 보정 도구**(SceneFixes.jsx 머리 주석 참고).
    // 서버도 AdminOnly 로 막으므로 permission 키를 만들지 않고 adminOnly 로 둔다.
    { label: '장면 위치 보정', href: '/scene-fixes', icon: 'MapPinned', adminOnly: true },
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
  /*
    🔴 **OCR 판독결과는 navigation.system 에 있어서 파생되지 않는다.** 아래
    derivedPermissionOptions 는 navigation.main 만 훑는다(system 은 원래 adminOnly 전용
    자리였다). 이 줄을 빼면 권한 부여 UI 에 키가 아예 나타나지 않아 **누구에게도 줄 수
    없는 메뉴**가 되고, isAdmin 계정만 조용히 보게 된다 — 화면은 멀쩡해 보이므로 눈치채기
    어렵다. 메뉴를 system 밖으로 옮기면 그때 이 줄을 지워라(중복으로 두 번 뜬다).
  */
  { key: 'scorecard-reports', label: 'OCR 판독결과' },
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
 * navigation.main 에서 파생되는 키(공지·업데이트·의견보내기·이모티콘)에, 파생되지 않는
 * 키(지표 · OCR 판독결과)를 앞에 붙인 것이다.
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
