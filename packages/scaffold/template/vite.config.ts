import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { homeframe } from '@builtbyted/vite';
import homeframeConfig from './homeframe.config.js';

export default defineConfig({
  plugins: [homeframe(homeframeConfig), react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
