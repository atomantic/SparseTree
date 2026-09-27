import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    server: { deps: { inline: [/portos-ai-toolkit/] } },
    include: ['src/**/*.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
  },
});
