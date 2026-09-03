/**
 * BirdieUp 브랜드 칩.
 *
 * 잉크(딥그린) 바탕에 라임 `b` 를 세운다. birdieup-app 헤더의 홈 배지와 같은 그림이라
 * 두 화면을 오가는 사람이 같은 마크로 읽는다.
 *
 * 글리프는 앱의 `assets/images/home-b.png` 를 그대로 가져왔다(public/home-b.png).
 * 원본 `b` 심볼은 진초록이어서 진초록 바탕 위에서는 보이지 않는다 — 알파만 남기고
 * 라임으로 칠해 둔 그 파일을 써야 한다.
 *
 * **색은 테마를 따르지 않는다.** 라임과 딥그린은 로고의 일부여서 다크 모드라고 바뀌면
 * 다른 로고가 된다.
 *
 * 🔴 앱의 원본이 바뀌면 public/home-b.png 도 함께 바꿔야 한다. 같은 그림이 두 저장소에
 *    두 벌로 있는 셈이라 한쪽만 고치면 앱과 어드민의 로고가 조용히 갈라진다.
 *
 * 크기와 모서리는 쓰는 자리가 className 으로 정한다(사이드바 size-10, 로그인 size-9).
 */
export default function BrandMark({ className = '' }) {
  return (
    <span
      role="img"
      aria-label="BirdieUp"
      className={`inline-flex items-center justify-center bg-[#12301F] ${className}`}
    >
      {/* 배지 대비 글리프 비율은 앱과 같게 맞춘다(20 / 34 ≈ 0.59). */}
      <img src="/home-b.png" alt="" className="h-[59%] w-[59%] object-contain" />
    </span>
  );
}
