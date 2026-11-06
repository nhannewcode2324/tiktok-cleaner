import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Builds the two extension UI pages (Side Panel + full-screen Dashboard).
// Background service worker and content script are bundled separately by
// scripts/build.mjs with esbuild (content scripts must be a single classic script).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome114',
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
} as any);
