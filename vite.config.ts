import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

// 시상식장에서 인터넷 없이 파일 하나만 열면 되도록 결과물을 HTML 한 장으로 묶는다.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
