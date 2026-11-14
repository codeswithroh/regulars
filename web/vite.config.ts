import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Reads the repo-root .env; only VITE_-prefixed values reach the browser.
// libauth uses top-level await, so both the build and the dev pre-bundler target ES2022.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  // In production /api/issue is a Vercel function; locally `npm run api -w server` serves it.
  server: { proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` } },
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
