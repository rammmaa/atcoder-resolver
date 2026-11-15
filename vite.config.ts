import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

// 시상식장에서 인터넷 없이 파일 하나만 열면 되도록 결과물을 HTML 한 장으로 묶는다.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  // 다시 빌드해도 먼저 만들어 둔 시상식용 HTML이 지워지지 않게 한다.
  build: { emptyOutDir: false },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
