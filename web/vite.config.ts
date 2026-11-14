import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Reads the repo-root .env; only VITE_-prefixed values reach the browser.
// libauth uses top-level await, so both the build and the dev pre-bundler target ES2022.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
