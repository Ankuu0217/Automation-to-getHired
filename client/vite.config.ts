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
        manualChunks: {
          // React core + routing — always needed
          vendor: ['react', 'react-dom', 'react-router-dom'],
          // Server-state layer
          query: ['@tanstack/react-query'],
          // Charting — only loaded on Analytics page
          charts: ['recharts'],
          // Drag-and-drop — only loaded on Pipeline
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // Animation — progressively enhanced
          motion: ['framer-motion'],
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
