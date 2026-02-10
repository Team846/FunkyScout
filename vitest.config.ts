import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./lib/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/dist/**',
        '**/build/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, './lib'),
      '@apps': path.resolve(__dirname, './apps'),
    },
  },
});
