/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Function form on purpose: the object form also drags each package's
        // shared deps (clsx, react-is, …) into that chunk, which made the main
        // bundle import — and preload — the 385 kB charts chunk on every page.
        manualChunks(id) {
          const pkg = id.match(/.*[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/)?.[1];
          if (!pkg) return undefined;
          // React core + routing + tiny utils shared with recharts (rollup would
          // otherwise pull them INTO the charts chunk) — always needed
          if (/^(react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router|clsx|react-is|tiny-invariant)$/.test(pkg)) {
            return 'vendor';
          }
          // Server-state layer
          if (pkg.startsWith('@tanstack')) return 'query';
          // Charting — only loaded on Dashboard/Analytics
          if (
            /^(recharts|victory-vendor|d3-.+|internmap|decimal\.js-light|es-toolkit|@reduxjs[\\/]toolkit|react-redux|redux|redux-thunk|reselect|immer|eventemitter3|use-sync-external-store)$/.test(
              pkg,
            )
          ) {
            return 'charts';
          }
          // Drag-and-drop — only loaded on Pipeline
          if (pkg.startsWith('@dnd-kit')) return 'dnd';
          // Animation — progressively enhanced
          if (/^(framer-motion|motion-dom|motion-utils)$/.test(pkg)) return 'motion';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Override when another local project occupies the default API port.
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
