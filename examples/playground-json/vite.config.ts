// examples/playground-json/vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.', // プロジェクトのルートを明示
  publicDir: 'public',
  base: '/cirquery/', // ← GitHub Pages サブパス
  build: {
    outDir: './dist', // GitHub Pages公開用の出力先
    emptyOutDir: true, // ビルド時に出力先をクリーンアップ
  },
});
