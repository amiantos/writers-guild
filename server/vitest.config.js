import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'src/**/__tests__/**',
        '**/*.test.js',
        '**/*.spec.js',
      ],
    },
    include: ['src/**/*.{test,spec}.js'],
  },
});
