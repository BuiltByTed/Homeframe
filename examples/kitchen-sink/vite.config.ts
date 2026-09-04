import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { homeframe } from '@builtbyted/vite';
import homeframeConfig from './homeframe.config.js';
import homeframePackage from '../../packages/homeframe/package.json' with { type: 'json' };

const base = process.env.HOMEFRAME_BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: {
    __HOMEFRAME_VERSION__: JSON.stringify(homeframePackage.version),
  },
  plugins: [homeframe(homeframeConfig), react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      // Generating the complete asset set is intentional buildStart work.
      checks: { pluginTimings: false },
    },
  },
});
