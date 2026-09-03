import React, { lazy, Suspense } from "react";
import {
    BrowserRouter as Router,
    Route,
    Routes,
    Navigate,
    Outlet,
    useLocation,
} from "react-router-dom";
import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { canAccessItem, resolveActiveItem } from "@/config/navigation";
import Login from "./pages/Login";
import { getAdminClaims, isAuthenticated, mustChangePassword } from "./utils/auth";

// Lazy loading for pages
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Notices = lazy(() => import("./pages/Notices"));
const Releases = lazy(() => import("./pages/Releases"));
const Suggestions = lazy(() => import("./pages/Suggestions"));
const SuggestionDetail = lazy(() => import("./pages/SuggestionDetail"));
const Emoticons = lazy(() => import("./pages/Emoticons"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));

const pageRoutes = [
    { path: "/", component: Dashboard },
    { path: "/posts/notices", component: Notices },
    { path: "/posts/releases", component: Releases },
    { path: "/suggestions", component: Suggestions },
    { path: "/suggestions/:suggestionId", component: SuggestionDetail },
    { path: "/emoticons", component: Emoticons },
    { path: "/users", component: UserManagement },
    { path: "/audit-logs", component: AuditLogs },
];

/** lazy 페이지가 로딩되는 동안 셸 안에 표시되는 스켈레톤 */
const PageFallback = () => (
    <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
    </div>
);

/**
 * 토큰이 없거나 만료됐으면 로그인 화면으로 보낸다.
 * 가드가 렌더 시점에 localStorage 를 직접 읽으므로 App 레벨 로그인 state 가 필요 없다.
 *
 * /change-password 처럼 비밀번호 변경 전에도 열려 있어야 하는 화면이 쓴다.
 */
const RequireAuth = ({ children }) =>
    isAuthenticated() ? children : <Navigate to="/login" replace />;

/**
 * 인증 + 비밀번호 변경 완료까지 요구한다.
 *
 * 초기 비밀번호를 쓰는 계정은 변경을 마치기 전까지 어떤 업무 화면에도 들어갈 수 없다.
 */
const RequireAuthAndPasswordChanged = ({ children }) => {
    if (!isAuthenticated()) return <Navigate to="/login" replace />;
    if (mustChangePassword()) return <Navigate to="/change-password" replace />;
    return children;
};

/**
 * 현재 경로를 담당하는 메뉴의 접근 권한을 확인한다.
 *
 * 토큰 클레임의 isAdmin / permissions 로 판정하며, 권한이 없으면 홈으로 돌려보낸다.
 * 메뉴에 없는 경로(상세 화면 등 resolveActiveItem 이 null 인 경우)는 그대로 통과시킨다.
 * 사이드바 필터링만으로는 URL 직접 입력을 막을 수 없어 라우트에서도 한 번 더 막는다.
 */
const RequireMenuPermission = ({ children }) => {
    const { pathname } = useLocation();
    const item = resolveActiveItem(pathname);
    if (item && !canAccessItem(item, getAdminClaims()))
        return <Navigate to="/" replace />;
    return children;
};

/** 이미 로그인한 상태로 /login 에 접근하면 홈으로 보낸다. */
const RedirectIfAuthenticated = ({ children }) =>
    isAuthenticated() ? <Navigate to="/" replace /> : children;

const App = () => {
    return (
        <Router>
            <Routes>
                <Route
                    path="/login"
                    element={
                        <RedirectIfAuthenticated>
                            <Login />
                        </RedirectIfAuthenticated>
                    }
                />

                {/* 비밀번호 변경은 셸(사이드바 + 헤더) 밖에서 단독으로 렌더된다 */}
                <Route
                    path="/change-password"
                    element={
                        <RequireAuth>
                            <Suspense fallback={<PageFallback />}>
                                <ChangePassword />
                            </Suspense>
                        </RequireAuth>
                    }
                />

                {/* 인증이 필요한 페이지는 전부 공통 셸(사이드바 + 헤더) 안에서 렌더된다 */}
                <Route
                    element={
                        <RequireAuthAndPasswordChanged>
                            <RequireMenuPermission>
                                <AuthenticatedShell>
                                    <Outlet />
                                </AuthenticatedShell>
                            </RequireMenuPermission>
                        </RequireAuthAndPasswordChanged>
                    }
                >
                    {pageRoutes.map(({ path, component: Component }) => (
                        <Route
                            key={path}
                            path={path}
                            element={
                                <Suspense fallback={<PageFallback />}>
                                    <Component />
                                </Suspense>
                            }
                        />
                    ))}
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            {/* 셸 밖 화면(로그인/비밀번호 변경)에서도 토스트가 떠야 하므로 루트에 둔다 */}
            <Toaster position="top-right" richColors closeButton />
        </Router>
    );
};

export default App;
