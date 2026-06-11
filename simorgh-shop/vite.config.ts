import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built app works when served from any path (e.g. the laptop server).
export default defineConfig({
  base: './',
  plugins: [react()],
});
