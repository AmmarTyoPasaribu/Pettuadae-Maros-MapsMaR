import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js alone is ~600 kB; it is cached long-term by vercel.json headers.
    chunkSizeWarningLimit: 900,
  },
});
