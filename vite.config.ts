import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' },
    watch: { ignored: ['**/.tools/**', '**/android/**', '**/ios/**', '**/artifacts/**', '**/releases/**', '**/serverdata/**'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 850 },
});
