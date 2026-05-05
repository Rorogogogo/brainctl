import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(rootDir, 'package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  root: path.resolve(rootDir, 'web'),
  build: {
    outDir: path.resolve(rootDir, 'dist/web'),
    emptyOutDir: false
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'web/src')
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  }
});
