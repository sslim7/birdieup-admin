import PostBoard from '@/components/posts/post-board';

/**
 * 공지사항(`/posts/notices`).
 *
 * 업데이트 화면과 서버 자원이 같고 kind 로만 갈리므로 본체는 PostBoard 하나를 공유한다.
 * 이 파일에 화면 로직을 더하지 마라 — 더하는 순간 두 화면이 조용히 갈라진다.
 */
const Notices = () => <PostBoard kind="notice" />;

export default Notices;
