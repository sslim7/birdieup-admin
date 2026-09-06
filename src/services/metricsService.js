import apiClient from './apiClient';

/**
 * 지표(metrics) 어드민 API.
 *
 * 계약의 정본은 docs/admin-api.md §8 이다. 이 주석과 문서가 어긋나면 문서가 맞다.
 * apiClient 의 baseURL 에는 경로 접두사가 없고 응답 키는 camelCase 다.
 *
 * 권한 키는 `metrics` 다. isAdmin 이거나 permissions.metrics 가 true 인 계정만 부를 수 있고,
 * 아니면 403 FORBIDDEN 이다. **홈 화면 자체는 누구나 열 수 있고 막히는 것은 이 API 뿐이다**
 * (홈에 권한을 달면 라우트 가드가 홈 → 홈 무한 루프를 만든다. navigation.js 주석 참고).
 *
 * 1) 요약  GET /admin/metrics/summary
 *    200 {
 *      live: {                       // 요청 시점 실시간 집계
 *        users: { active, withdrawn, suspended },
 *        rounds: { total, live, ended, aborted },
 *        feeds: { total, deleted, alive },
 *        friends: { total, linked, unlinked },
 *        reactions: { total },
 *        media: { alive },
 *        asOf                        // RFC3339 UTC
 *      },
 *      rollup: {                     // 야간 배치가 접어 둔 값. **없으면 null**
 *        date,                       // 마지막으로 집계가 끝난 날 (KST, 보통 어제)
 *        activeUsers: { dau, wau, mau, contributors },
 *        cumulative: { users, usersActive, friends, rounds, feeds, messages, photos, videos, reactions },
 *        yesterday: {...}, last7d: {...}
 *      }
 *    }
 *
 * 2) 일자별  GET /admin/metrics/daily?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *    200 { days: [{ date, missing, users, active, friends, rounds, feeds, reactions, cumulative }] }
 *
 * 🔴 이 API 를 다룰 때 절대 뭉개면 안 되는 두 가지:
 *
 *   - **`rollup: null` 은 "지표가 0" 이 아니라 "아직 한 번도 집계되지 않았다" 는 뜻이다.**
 *     0 으로 채워 내려 주지 마라. 화면이 두 상태를 구분할 수 없게 된다.
 *   - **`missing: true` 인 날은 그날 롤업 문서가 없다는 뜻이고 다른 필드가 아예 오지 않는다.**
 *     아직 집계 전인 오늘, 배치가 실패한 날, 서비스 이전의 날이 전부 여기 걸린다.
 *     0 으로 그리면 "오늘 뚝 떨어졌다"로 읽힌다.
 *
 * 그래서 이 파일은 응답을 **정규화하지 않는다.** 빠진 필드를 0 으로 메우는 순간
 * 두 상태의 구분이 사라지기 때문이다. 배열/객체 모양만 보장하고 값은 그대로 넘긴다.
 */

/**
 * 지표 요약 조회.
 *
 * rollup 은 계약상 null 일 수 있으므로 그대로 넘긴다(undefined 만 null 로 맞춘다).
 */
export async function fetchMetricsSummary() {
  const response = await apiClient.get('/admin/metrics/summary');
  const body = response.data ?? {};

  return {
    live: body.live ?? null,
    rollup: body.rollup ?? null,
  };
}

/**
 * 일자별 지표 조회.
 *
 * dateFrom / dateTo 는 둘 다 필수이고 KST 날짜다(dateTo 는 그날 포함).
 * 서버가 구간의 모든 날짜를 채워서 주지만, 혹시 빠져도 화면이 깨지지 않도록
 * 날짜 오름차순 정렬만 한 번 더 해 둔다.
 */
export async function fetchDailyMetrics({ dateFrom, dateTo }) {
  const response = await apiClient.get('/admin/metrics/daily', {
    params: { dateFrom, dateTo },
  });
  const body = response.data ?? {};
  const days = Array.isArray(body.days) ? body.days : [];

  return {
    days: [...days].sort((a, b) => String(a?.date).localeCompare(String(b?.date))),
  };
}

const metricsService = { fetchMetricsSummary, fetchDailyMetrics };

export default metricsService;
