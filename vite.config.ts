import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps the production build portable (GitHub Pages, any sub-path).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
