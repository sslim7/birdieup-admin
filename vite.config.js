import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env 의 모든 키를 읽는다(VITE_ 접두사가 없는 PORT 도 읽기 위해 prefix 를 '' 로 지정).
  // 여기서 읽은 값은 서버 설정용이며, 클라이언트 번들에 노출되는 것은 VITE_ 변수뿐이다.
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.PORT) || 3000;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // kiik-admin 에서 이식한 컴포넌트가 쓰는 '@/...' 임포트를 그대로 유지하기 위한 alias
        '@': path.resolve(rootDir, 'src'),
      },
    },
    server: {
      port,
      open: false,
    },
    preview: {
      port,
    },
  };
});
