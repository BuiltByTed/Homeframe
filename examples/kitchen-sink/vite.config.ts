import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { homeframe } from '@builtbyted/vite';
import homeframeConfig from './homeframe.config.js';

const base = process.env.HOMEFRAME_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [homeframe(homeframeConfig), react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
