import apiClient from './apiClient';

/**
 * 활동 로그(감사 로그) 조회 API. 계약 정본은 docs/admin-api.md §5 다.
 *
 * baseURL 에 경로 접두사가 없으므로 경로는 루트부터 쓰고, 키는 전부 camelCase 다.
 *
 * **이 API 만 커서 페이지네이션이 아니라 page/total 을 쓴다.** 다른 목록들은
 * `?limit&cursor` → `{ items, nextCursor }` 라서 헷갈리기 쉬운데, 감사 화면은
 * "몇 건 중 몇 페이지"가 필요해서 여기만 예외로 두었다. 다른 서비스의 커서
 * 페이징 코드를 그대로 복사해 오지 말 것.
 *
 * 목록  GET /admin/audit-logs   [Bearer 필수, isAdmin 아니면 403 FORBIDDEN]
 *
 *   쿼리(전부 선택):
 *     page       기본 1
 *     pageSize   기본 20, 최대 100
 *     dateFrom   YYYY-MM-DD (KST)
 *     dateTo     YYYY-MM-DD (해당일 포함)
 *     adminId    특정 어드민만
 *     target     도메인 필터 (admin | auth | posts | suggestions | emoticons)
 *     search     actions / 관리자명 / 이메일 / IP 부분검색
 *     sortOrder  asc | desc (기본 desc, createdAt 기준)
 *
 *   응답 200:
 *   {
 *     logs: [
 *       {
 *         auditLogId: string,
 *         adminId: string,
 *         adminName: string|null,
 *         adminEmail: string|null,
 *         actions: string,           // "POST /admin/posts" 형태의 "METHOD 경로"
 *         targets: string,           // "posts"
 *         details: { status: number, body: object },  // password 계열은 서버가 [REDACTED]
 *         ipAddress: string,
 *         createdAt: string          // RFC3339
 *       }
 *     ],
 *     total: number,
 *     page: number,
 *     pageSize: number
 *   }
 *
 *   기록 범위: **쓰기 요청(GET 이 아닌 것)만 남는다.** 조회까지 남기면 로그가
 *   조회로 뒤덮여 쓸모가 없어서 내린 결정이다. 로그인 성공/실패만 예외로
 *   "어드민 로그인" / "어드민 로그인 실패" 로 기록되고, 이 조회 API 자신은 남지 않는다.
 */

/** 값이 비어 있으면(undefined/null/'') 쿼리에서 제외한다 */
function compactParams(params) {
  const query = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    query[key] = typeof value === 'string' ? value.trim() : value;
  });
  return query;
}

/**
 * 활동 로그 목록 조회.
 * 응답이 비어 있어도 화면이 깨지지 않도록 항상 { logs, total, page, pageSize } 를 돌려준다.
 */
export async function fetchAuditLogs({
  page,
  pageSize,
  dateFrom,
  dateTo,
  adminId,
  target,
  search,
  sortOrder,
} = {}) {
  const params = compactParams({
    page,
    pageSize,
    dateFrom,
    dateTo,
    adminId,
    target,
    search,
    sortOrder,
  });

  const response = await apiClient.get('/admin/audit-logs', { params });
  const body = response.data ?? {};

  return {
    logs: Array.isArray(body.logs) ? body.logs : [],
    total: Number(body.total) || 0,
    page: Number(body.page) || params.page || 1,
    pageSize: Number(body.pageSize) || params.pageSize || 20,
  };
}

const auditLogService = { fetchAuditLogs };

export default auditLogService;
