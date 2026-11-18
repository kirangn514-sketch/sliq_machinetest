import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development (npm run dev) the Vite server proxies API + WebSocket traffic to the
// backend so the browser stays same-origin, exactly like Nginx does in Docker.
const backend = process.env.VITE_DEV_BACKEND || 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/socket.io': { target: backend, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
