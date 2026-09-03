import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/**
 * 게시글 본문(마크다운) → 화면에 꽂아도 되는 HTML 문자열.
 *
 * 계약은 `docs/admin-api.md` §2.1 이다. 서버는 마크다운을 파싱하지도 렌더하지도 않고
 * 문자열 그대로 저장·반환하므로, **렌더와 새니타이즈는 전적으로 읽는 쪽의 책임이다.**
 *
 * 🔴 왜 새니타이즈가 필요한가 — 본문을 쓰는 사람이 어드민뿐이라는 것은 안전의 근거가 되지
 *    못한다. 신뢰 경계가 다르기 때문이다. 이 글은 어드민 미리보기에서 한 번 그려지고,
 *    앱의 공지 상세에서 **모든 사용자에게** 다시 그려진다. 어드민 계정 하나가 털리거나
 *    실수로 붙여넣은 조각 하나가 섞이면, 그 대가를 치르는 쪽은 글을 쓴 사람이 아니라
 *    글을 읽는 전체 사용자다. 그래서 "입력을 믿는" 방어는 여기서 성립하지 않는다.
 *
 * 🔴 날 HTML 은 렌더하지 않는다. 두 겹으로 막는다:
 *    1) marked 의 renderer.html 을 덮어써서 HTML 토큰을 **이스케이프**한다.
 *    2) DOMPurify 의 ALLOWED_TAGS 를 §2.1 이 허용한 문법으로 좁힌다.
 *    한 겹으로도 막히지만, 어느 한쪽을 나중에 누가 완화해도 다른 한쪽이 남게 하려는 것이다.
 *    새니타이즈 없이 marked 결과를 dangerouslySetInnerHTML 에 넣는 코드를 추가하지 마라.
 *
 * ⚠ 렌더러가 둘이다(어드민 미리보기 / 앱 상세). 여기서 넓힌 문법은 앱 렌더러에도 같이
 *   넓혀 줘야 하고, 그러지 않으면 "어드민에서는 멀쩡한데 앱에서는 깨진 글"이 생긴다.
 *   그 어긋남은 작성자가 저장하기 전에는 알 수 없으므로, 문법을 늘릴 때는 §2.1 을 먼저 고쳐라.
 */

/** §2.1 이 허용한 GFM 서브셋에 대응하는 태그. 여기 없는 태그는 내용만 남고 벗겨진다. */
const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'p',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'blockquote',
  'code',
  'pre',
  'hr',
  'br',
];

/**
 * 허용 속성.
 *
 * `target` / `rel` / `loading` 은 여기 없다 — 본문 작성자가 지정하는 값이 아니라 우리가
 * 사후에 붙이는 값이라, 새니타이즈가 끝난 뒤에 직접 설정한다(아래 decorate 참고).
 */
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title'];

/**
 * URI 스킴 화이트리스트.
 *
 * DOMPurify 기본값도 `javascript:` 는 막지만, 여기서는 아예 http(s)/mailto 만 남긴다.
 * 본문은 앱에서도 렌더되고 앱의 링크 처리기는 우리가 통제하지 않는다 —
 * `intent:`, `tel:`, 커스텀 스킴 딥링크가 본문을 타고 들어오는 경로를 애초에 없앤다.
 * (상대 경로도 함께 막힌다. 이미지·링크는 §2.2 대로 절대 URL 이므로 손해가 없다.)
 */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:)/i;

/** renderer.html 에서 쓰는 최소 이스케이프. marked 의 내부 헬퍼는 공개 API 가 아니라 직접 둔다. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 전역 `marked` 싱글턴 대신 인스턴스를 쓴다.
 *
 * `marked.use()` 는 프로세스 전역 설정을 바꿔서, 나중에 누가 다른 목적으로 marked 를
 * 가져다 쓰면 서로의 옵션을 덮어쓴다. 이 모듈의 설정이 이 모듈 밖으로 새지 않게 가둔다.
 */
const renderer = new Marked({
  gfm: true,
  /**
   * 단일 줄바꿈을 <br> 로 살린다.
   *
   * 본문은 원래 평문이었고(줄바꿈만 살았다) 작성자들은 Enter 한 번으로 줄을 바꿔 왔다.
   * 마크다운 기본값은 그 줄바꿈을 무시하므로, breaks 를 끄면 계약이 바뀐 날 이후로
   * 기존 글과 기존 습관이 한꺼번에 뭉개져 보인다.
   * ⚠ 앱 렌더러도 이 옵션을 켜야 두 화면이 같은 글을 같게 그린다.
   */
  breaks: true,
});

renderer.use({
  renderer: {
    /**
     * 마크다운 안의 HTML 토큰(블록·인라인 공통).
     *
     * 지우지 않고 **이스케이프해서 글자로 보여 준다.** 조용히 사라지면 작성자는 자기 글이
     * 왜 비었는지 모르고 같은 시도를 반복하는데, 글자로 남으면 "여기서는 HTML 이 안 된다"는
     * 사실이 즉시 보인다. 안전성은 어느 쪽이든 같다(태그로 해석되지 않는다).
     */
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

/**
 * 새니타이즈가 끝난 조각에 우리가 정한 속성을 붙인다.
 *
 * DOMPurify 의 addHook 은 전역이라 앱 어디서 sanitize 를 부르든 함께 걸린다. 그 부작용을
 * 피하려고 DOM 프래그먼트를 돌려받아 여기서 직접 손본다 — 새니타이즈 **이후**라
 * 여기서 붙인 속성은 다시 검사되지 않는다(그래서 붙이는 값은 전부 우리가 만든 상수다).
 */
function decorate(fragment) {
  fragment.querySelectorAll('a').forEach((anchor) => {
    // 어드민 화면 밖으로 나가는 링크다. noopener 가 없으면 새 탭이 window.opener 로
    // 이 화면을 조작할 수 있고, referrer 도 굳이 넘길 이유가 없다.
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });

  fragment.querySelectorAll('img').forEach((image) => {
    // 본문에 이미지가 여러 장 들어가는 글이 흔하다. 미리보기를 열자마자 전부 받게 두지 않는다.
    image.setAttribute('loading', 'lazy');
    // 원본이 컨테이너보다 넓어도 레이아웃을 밀어내지 않게 한다.
    image.style.maxWidth = '100%';
    image.style.height = 'auto';
  });

  return fragment;
}

/**
 * 마크다운 문자열을 새니타이즈된 HTML 로 바꾼다.
 *
 * 반환값은 `dangerouslySetInnerHTML` 에 그대로 넣어도 되는 문자열이다.
 * 빈 입력은 빈 문자열을 돌려주므로 호출부가 "미리보기 없음" 분기를 만들 수 있다.
 */
export function renderMarkdown(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  if (!source.trim()) return '';

  const rawHtml = renderer.parse(source);

  const fragment = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // 허용하지 않은 태그는 벗기되 안의 글은 남긴다. `~~취소선~~` 이나 `#### h4` 처럼
    // 문법만 살짝 벗어난 글이 통째로 사라지지 않고 글자로 남아, 작성자가 저장하기 전에
    // "이 문법은 안 먹는다"를 눈으로 확인할 수 있다.
    // ⚠ 표는 예외다. 브라우저의 표 파싱 특성상 thead 안의 셀 글자까지 함께 없어져서
    //   내용이 부분적으로 사라진 채 남는다. §2.1 이 표를 쓰지 않기로 했으므로 그대로 둔다.
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });

  const holder = document.createElement('div');
  holder.appendChild(decorate(fragment));
  return holder.innerHTML;
}

export default renderMarkdown;
