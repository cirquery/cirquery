// examples/playground-json/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// root はこの設定ファイルのあるフォルダに固定する。
// '.' のままだと「コマンドを実行したフォルダ」が root になり、
// リポジトリ直下から実行したときに index.html が見つからず失敗する。
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  publicDir: 'public',
  base: '/cirquery/', // ← GitHub Pages サブパス
  build: {
    outDir: './dist', // GitHub Pages公開用の出力先（root からの相対）
    emptyOutDir: true, // ビルド時に出力先をクリーンアップ
  },
});
