// Key for storing the token in localStorage
const TOKEN_KEY = 'adminToken';

/**
 * Saves the token to localStorage.
 * @param {string} token - The token to save.
 */
export const saveToken = (token) => {
    try {
        localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
        console.error('Error saving token:', error);
    }
};

/**
 * Retrieves the token from localStorage.
 * @returns {string|null} The retrieved token, or null if not found.
 */
export const getToken = () => {
    try {
        const token = localStorage.getItem(TOKEN_KEY);
        return token ? token : null;
    } catch (error) {
        console.error('Error retrieving token:', error);
        return null;
    }
};

/**
 * Decodes the JWT payload from the stored admin token.
 * Returns the full payload object so callers can inspect any claim.
 */
export const getTokenPayload = () => {
    const token = getToken();
    if (!token) return null;
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(
            atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(json);
    } catch (error) {
        console.error('Error decoding token:', error);
        return null;
    }
};

/**
 * 관리자 정보가 담긴 클레임 객체를 돌려준다.
 *
 * 어드민 토큰은 관리자 정보를 sub 객체 안에 넣는다(docs/admin-api.md §1.1):
 *   { sub: { adminId, email, name, isAdmin, permissions, mustChangePassword },
 *     isAdmin, tokenUse: 'admin_access', exp }
 * sub 가 문자열인 표준 형태의 토큰도 있을 수 있으므로,
 * sub 가 객체일 때만 그것을 쓰고 아니면 payload 자체를 본다.
 *
 * @returns {object|null} 클레임 객체. 토큰이 없으면 null.
 */
export const getAdminClaims = () => {
    const payload = getTokenPayload();
    if (!payload) return null;
    if (payload.sub && typeof payload.sub === 'object') return payload.sub;
    return payload;
};

/**
 * JWT 에서 adminId 클레임을 돌려준다.
 */
export const getAdminId = () => {
    const claims = getAdminClaims();
    if (!claims) return null;
    return (
        claims.adminId ||
        // sub 가 객체가 아닌 토큰에서는 sub 자체가 식별자다
        (typeof claims.sub === 'string' ? claims.sub : null)
    );
};

/**
 * 첫 로그인 비밀번호 변경이 강제된 계정인지 여부.
 * @returns {boolean} 변경이 필요하면 true
 */
export const mustChangePassword = () => {
    return Boolean(getAdminClaims()?.mustChangePassword);
};

/**
 * 저장된 토큰의 exp 클레임이 지났는지 확인한다.
 *
 * 토큰이 없거나 디코딩할 수 없으면 만료로 간주한다.
 * exp 클레임이 없는 토큰은 만료 시점을 알 수 없으므로 유효한 것으로 보고,
 * 최종 판정은 서버의 401 응답에 맡긴다.
 * @returns {boolean} 만료되었으면 true
 */
export const isTokenExpired = () => {
    const payload = getTokenPayload();
    if (!payload) return true;
    if (typeof payload.exp !== 'number') return false;
    // exp 는 초 단위 epoch
    return payload.exp * 1000 <= Date.now();
};

/**
 * 유효한(존재하고 만료되지 않은) 토큰을 갖고 있는지 여부.
 */
export const isAuthenticated = () => {
    return !!getToken() && !isTokenExpired();
};

/**
 * Deletes the token from localStorage.
 */
export const deleteToken = async () => {
    try {
        await localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
        console.error('Error deleting token:', error);
    }
};
