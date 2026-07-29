/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The app is mock-first; the MSW browser worker is wired in P5-04. This dev proxy is
// here so that when the app talks to the live backend (P5-13), requests to `/api/v1`
// (the client's default base URL) are forwarded without any code change.
export default defineConfig(({ mode }) => {
  // loadEnv is required to read .env* files here — Vite does not populate process.env
  // from them inside the config. '' loads all keys, not just VITE_-prefixed ones.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/v1': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  };
});
