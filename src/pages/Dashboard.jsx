import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, MessageSquareHeart, Smile, Sparkles } from 'lucide-react';
import { navigation, canAccessItem, flattenEntries } from '@/config/navigation';
import { getAdminClaims } from '@/utils/auth';

/** navigation.js 의 icon 문자열 → lucide 컴포넌트 매핑 (홈 카드에 쓰는 것만) */
const iconMap = { Bell, MessageSquareHeart, Smile, Sparkles };

/**
 * 홈.
 *
 * 접근 권한이 있는 업무 메뉴로 가는 바로가기만 놓는다. 지표 카드를 두지 않는 이유는
 * 집계 API 가 아직 없기 때문이다 — 0 이 찍힌 카드는 "지표가 0" 인지 "아직 안 붙었는지"
 * 구분되지 않아서, 붙일 수 있게 될 때 여기에 넣는다.
 */
const Dashboard = () => {
  const claims = getAdminClaims();
  // 홈(permission 없는 항목) 자신은 카드로 만들지 않는다.
  const items = flattenEntries(navigation.main).filter(
    (item) => Boolean(item.permission) && canAccessItem(item, claims)
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BirdieUp 어드민</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {claims?.name ? `${claims.name} 님, ` : ''}관리할 메뉴를 선택하세요.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          접근 가능한 업무 메뉴가 없습니다. 관리자에게 권한을 요청하세요.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = iconMap[item.icon];
            return (
              <Link
                key={item.href}
                to={item.href}
                className="group rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {Icon && <Icon className="size-5" />}
                  </span>
                  <span className="text-base font-semibold group-hover:text-primary">
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
