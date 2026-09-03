import PostBoard from '@/components/posts/post-board';

/**
 * 업데이트(`/posts/releases`).
 *
 * 공지사항과 같은 본체를 kind 만 바꿔 쓴다. 문구 차이는 post-board.jsx 의 KIND_META 에 있다.
 */
const Releases = () => <PostBoard kind="release" />;

export default Releases;
