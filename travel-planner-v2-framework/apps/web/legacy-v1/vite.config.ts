import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const appDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const envDir = resolve(appDir, '../..');
  const env = loadEnv(mode, envDir, '');
  const apiTarget = env.API_PROXY_TARGET || `http://127.0.0.1:${env.PORT || '3000'}`;
  return {
    root: appDir,
    envDir,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
  };
});
