import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig({
  root: 'desktop',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : undefined,
  },
  build: {
    outDir: '../dist-desktop',
    emptyOutDir: true,
  },
});
