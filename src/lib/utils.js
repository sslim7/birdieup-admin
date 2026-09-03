import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind 클래스 병합 유틸 (조건부 클래스 + 충돌 해소) */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
