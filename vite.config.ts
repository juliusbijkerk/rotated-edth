import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'web',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        operator: resolve(__dirname, 'web/operator.html'),
        unit: resolve(__dirname, 'web/unit.html'),
      },
    },
  },
});
