/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { latestReleasedVersion } from './scripts/changelog-version.mjs';

function gitInfo() {
  const run = (cmd: string, fallback: string) => {
    try {
      return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch {
      return fallback;
    }
  };
  return {
    branch: run('git rev-parse --abbrev-ref HEAD', 'unknown'),
    commit: run('git rev-parse --short HEAD', 'unknown'),
    dirty: run('git status --porcelain', '').length > 0,
  };
}

const git = gitInfo();
const appVersion = latestReleasedVersion();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_BRANCH__: JSON.stringify(git.branch),
    __GIT_COMMIT__: JSON.stringify(git.commit),
    __GIT_DIRTY__: git.dirty,
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true, // Enables Jest-like globals (e.g., describe, it)
    environment: 'jsdom', // Simulates browser environment
    setupFiles: './src/setupTests.ts', // For custom setup (e.g., jest-dom)
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    css: true, // Process CSS files for accurate rendering
    coverage: {
      provider: 'v8', // For code coverage reports
      reporter: ['text', 'json', 'html'],
    },
  },
});
