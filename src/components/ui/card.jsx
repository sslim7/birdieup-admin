import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn Card. 이 저장소는 shadcn CLI 를 쓰지 않으므로 손으로 옮겼다.
 *
 * 원본과 다르게 둔 것 두 가지:
 *   - 반경이 rounded-xl 이 아니라 rounded-2xl 이다. 활동 로그·게시판의 섹션 카드가
 *     이미 `rounded-2xl border border-border bg-card` 라서 그쪽에 맞췄다.
 *   - shadow-sm 을 걷어냈다. 이 디자인 시스템의 카드는 종이 배경(--background) 위의
 *     밝은 면(--card)이라 테두리만으로 떠 보이고, 그림자를 얹으면 탁해진다.
 *
 * variant 가 없으므로 badge/button 과 달리 cva 는 쓰지 않는다(다른 ui/ 파일과 같은 기준).
 */
function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 rounded-2xl border border-border bg-card py-6 text-card-foreground',
        className
      )}
      {...props}
    />
  );
}

/**
 * 카드 머리. CardAction 이 들어오면 오른쪽에 붙일 자리를 만들기 위해
 * 2열 그리드로 바뀐다(shadcn 의 has-data-[slot=card-action] 규칙 그대로).
 */
function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** 머리 오른쪽에 놓이는 액션(버튼·배지 등). 행을 넘겨 세로로 걸친다. */
function CardAction({ className, ...props }) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
};
