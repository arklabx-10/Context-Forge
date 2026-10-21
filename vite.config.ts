import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/*.test.ts'],
    exclude: ['tests/fixtures/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        changeOrigin: true,
      },
    },
  },
});
