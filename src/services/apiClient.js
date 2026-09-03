import axios from 'axios';
import {  getToken, deleteToken } from '../utils/auth';

// Axios instance creation
const apiClient = axios.create({
    // 환경별 API 주소는 .env(로컬) 또는 빌드 시 주입되는 환경변수로 설정한다
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081',
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to add token to headers
apiClient.interceptors.request.use(
    async (config) => {
        const token = getToken();

        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor to handle token expiration
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response && error.response.status === 401) {
            await deleteToken();
            // 이미 로그인 화면이면 리다이렉트하지 않는다(로그인 실패 시 화면이 초기화되는 것을 막는다).
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

export default apiClient;
