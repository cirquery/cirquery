// examples/playground-json/vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'examples/playground-json', // プロジェクトのルートを明示
  build: {
    outDir: '../../docs/json-playground', // GitHub Pages公開用の出力先
    emptyOutDir: true, // ビルド時に出力先をクリーンアップ
  },
});
