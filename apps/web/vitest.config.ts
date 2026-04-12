import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      environmentOptions: {
        jsdom: {
          url: 'http://localhost/',
        },
      },
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
      clearMocks: true,
      restoreMocks: true,
      server: {
        deps: {
          inline: ['@testing-library/react', '@testing-library/user-event'],
        },
      },
    },
  }),
);
