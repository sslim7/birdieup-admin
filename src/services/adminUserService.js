import apiClient from './apiClient';

/**
 * 어드민 계정(어드민 콘솔 접근 계정) 관리 API.
 *
 * 계약 정본은 docs/admin-api.md §1 이다. 아래는 그 요약이며, 어긋나면 문서가 이긴다.
 *
 * 이 프로젝트의 apiClient baseURL 에는 경로 접두사가 없다. kiik 의 `/api/v1` 관습을
 * 따라 붙이면 404 가 되므로 경로는 항상 루트('/admin/...', '/auth/...')부터 쓴다.
 * JSON 키도 WAS 하우스 스타일인 camelCase 다.
 *
 * 1) 목록  GET /admin/admins   [isAdmin 토큰 필요]
 *    응답: {
 *      items: [
 *        {
 *          adminId: string,
 *          email: string,
 *          name: string,
 *          isActive: boolean,
 *          isAdmin: boolean,
 *          permissions: object,          // { '<menu-key>': true }
 *          mustChangePassword: boolean,
 *          createdAt: string,            // RFC3339 UTC
 *          updatedAt: string
 *        }
 *      ]
 *    }
 *    createdAt 내림차순으로 내려오므로 화면에서 다시 정렬하지 않는다.
 *
 * 2) 생성  POST /admin/admins   [isAdmin 토큰 필요]
 *    request : { email, name, password, isAdmin?, permissions?, mustChangePassword? }
 *              // password 8자 이상
 *              // isAdmin 기본 false, permissions 기본 {}, mustChangePassword 기본 true
 *    response: 201 { adminId, email, name }
 *    - isActive 는 생성 계약에 없다(항상 활성으로 생성된다).
 *    - 에러: 409 EMAIL_ALREADY_EXISTS
 *
 * 3) 수정  PATCH /admin/admins/{adminId}   [isAdmin 토큰 필요, 부분 수정]
 *    request : { name?, isActive?, isAdmin?, permissions?, mustChangePassword?, password? }
 *    response: 200 Admin(목록 item 과 같은 shape)
 *    - adminId 는 body 가 아니라 경로 파라미터다.
 *    - email 은 변경할 수 없다. 보내면 400 이다.
 *    - password 는 값을 입력했을 때만 포함한다(비우면 기존 비밀번호 유지).
 *      password 를 보내면 서버가 mustChangePassword 를 함께 내린다.
 *    - 본인 계정의 isAdmin/isActive 변경은 400 SELF_DEMOTION_FORBIDDEN 으로 거절된다.
 *      (kiik 은 조용히 무시했다.) → UI 도 본인 행의 두 토글을 비활성 처리한다.
 *
 * ※ permissions 는 반드시 dict(객체)로 보낸다. 배열은 400 이다.
 *    채택한 형태는 체크된 메뉴 키만 담는 { '<menu-key>': true } 맵이며,
 *    키 목록은 src/config/navigation.js 의 permissionOptions 가 정의한다.
 *
 * 4) 비밀번호 변경  POST /auth/admin.change-password   [어드민 토큰 필요]
 *    request : { newPassword }    // 8자 이상, 기존과 달라야 한다
 *    response: 200 { accessToken }   // mustChangePassword=false 가 반영된 새 토큰
 *
 *    현재 비밀번호는 보내지 않는다. 서버가 Authorization 토큰만으로 본인을 확인하며,
 *    이 화면은 로그인(= 비밀번호 검증) 직후에만 도달하는 것이 전제다.
 *
 * 에러는 전 엔드포인트 공통으로 { code, message, details? } 이고,
 * message 는 화면에 그대로 띄워도 되는 한국어 문장이다.
 */

/**
 * 응답 body 에서 어드민 배열을 뽑아낸다.
 * 계약은 { items: [...] } 이지만, 래핑 방식이 바뀌어도 목록이 통째로 사라지지 않도록
 * items → data → body 자체 순서로 배열을 찾는다.
 */
function extractAdmins(body) {
  if (!body) return [];
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data?.items)) return body.data.items;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body)) return body;
  return [];
}

/** 값이 undefined 인 키를 payload 에서 뺀다(PATCH 는 보낸 키만 바뀐다) */
function compact(payload) {
  const next = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) next[key] = value;
  });
  return next;
}

const adminUserService = {
  /** 어드민 목록 조회 → 항상 배열을 돌려준다 */
  fetchAdmins: async () => {
    const response = await apiClient.get('/admin/admins');
    return extractAdmins(response.data);
  },

  /** 어드민 생성. 성공 시 201 { adminId, email, name } */
  createAdmin: ({
    email,
    name,
    password,
    isAdmin,
    permissions,
    mustChangePassword,
  }) =>
    apiClient.post(
      '/admin/admins',
      compact({ email, name, password, isAdmin, permissions, mustChangePassword })
    ),

  /**
   * 어드민 수정(부분 수정).
   *
   * adminId 는 경로 파라미터이고, 넘기지 않은 필드는 payload 에 싣지 않는다.
   * undefined 를 그대로 실어 보내면 서버가 "값을 비워 달라"는 요청으로 읽고 400 을 줄 수 있다.
   * password 도 값이 있을 때만 포함한다(빈 문자열 = 변경 없음).
   */
  updateAdmin: (
    adminId,
    { name, isActive, isAdmin, permissions, mustChangePassword, password } = {}
  ) => {
    const payload = compact({
      name,
      isActive,
      isAdmin,
      permissions,
      mustChangePassword,
    });
    if (password) payload.password = password;
    return apiClient.patch(
      `/admin/admins/${encodeURIComponent(adminId)}`,
      payload
    );
  },

  /**
   * 로그인한 본인의 비밀번호 변경(토큰으로 본인 확인).
   * 성공하면 mustChangePassword 가 해제된 새 accessToken 이 내려온다.
   */
  changePassword: ({ newPassword }) =>
    apiClient.post('/auth/admin.change-password', { newPassword }),
};

export default adminUserService;
