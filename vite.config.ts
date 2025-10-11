/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/retirement-planner/',
  test: {
    globals: true, // Enables Jest-like globals (e.g., describe, it)
    environment: 'jsdom', // Simulates browser environment
    setupFiles: './src/setupTests.ts', // For custom setup (e.g., jest-dom)
    css: true, // Process CSS files for accurate rendering
    coverage: {
      provider: 'v8', // For code coverage reports
      reporter: ['text', 'json', 'html'],
    },
  },
});
