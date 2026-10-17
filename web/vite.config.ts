import { defineConfig } from 'vite';

// GitHub Pages 的專案頁面要掛在 /<repo>/ 底下，CI 會把 VITE_BASE 設成 /dragonRadar/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: { target: 'es2022', sourcemap: false },
});
