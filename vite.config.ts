import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: '0.0.0.0', // ← ЭТО КЛЮЧЕВОЙ МОМЕНТ!
    open: true,
    hmr: {
      clientPort: 5173 // для Hot Module Replacement через туннель
    },
    // Proxy для dev режима - перенаправляет API запросы на backend сервер
    proxy: {
      '/api': {
        target: 'http://localhost:10000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
});