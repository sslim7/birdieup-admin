import { useId } from 'react';

/**
 * BirdieUp 심볼.
 *
 * 원본은 birdieup-app 의 `assets/images/birdieup-icon.svg` 다. 파일을 가져오지 않고
 * 컴포넌트로 옮겨 둔 이유는 두 가지다 — 요청이 한 번 줄고, 색을 토큰이 아니라 브랜드
 * 원값으로 박아 둘 수 있다. **이 마크의 색은 테마를 따르지 않는다.** 라임과 딥그린은
 * 로고의 일부여서 다크 모드라고 바뀌면 다른 로고가 된다.
 *
 * 🔴 원본이 바뀌면 여기도 바꿔야 한다. 두 저장소에 같은 그림이 두 벌로 있는 셈이라
 *    한쪽만 고치면 앱과 어드민의 로고가 조용히 갈라진다.
 *
 * 딤플 무늬는 `<pattern>` 이라 id 가 필요하고, 그 id 는 문서에서 유일해야 한다.
 * 한 화면에 두 번 그리면(사이드바 + 어딘가) 나중 것이 앞 것의 무늬를 덮어쓰므로
 * useId 로 인스턴스마다 다른 id 를 준다.
 */
export default function BrandMark({ className = '' }) {
  const patternId = useId();

  return (
    <svg
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="BirdieUp"
      className={className}
    >
      <defs>
        <pattern
          id={patternId}
          width="70.98"
          height="70.98"
          patternUnits="userSpaceOnUse"
          x="209.5"
          y="209.5"
        >
          <circle cx="35.49" cy="35.49" r="14.2" fill="#12301F" fillOpacity="0.3" />
        </pattern>
      </defs>

      <rect width="1024" height="1024" fill="#12301F" />
      <circle cx="512" cy="512" r="338" fill="#C8E85F" />
      <circle cx="512" cy="512" r="338" fill={`url(#${patternId})`} />

      <path
        d="M343 397.1 L425.8 626.9 L512 456.9 L598.2 626.9 L681 397.1"
        fill="none"
        stroke="#12301F"
        strokeWidth="41.9"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <rect x="319.3" y="493.6" width="385.4" height="27" fill="#12301F" />
      <rect x="319.3" y="539.6" width="385.4" height="27" fill="#12301F" />
    </svg>
  );
}
