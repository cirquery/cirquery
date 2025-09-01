# コントリビューションガイド

ようこそ！cirquery への貢献を歓迎します。質問・提案はまず Issue を作成してください。https://github.com/cirquery/cirquery/issues

## 開発セットアップ（最短経路）
- 前提: Node.js 22+、npm
- 手順:
  - インストール: `npm ci`
  - ビルド: `npm run build`
  - テスト: `npm test`
  - 型検査（任意）: `npm run typecheck`

スクリプト要約:
- build: tsup で ESM/CJS + d.ts を生成
- test: vitest 実行
- lint / lint:fix: ESLint
- format: Prettier

## レイヤと責務（要点）
- CST: Chevrotain の構文解析用コンテキスト（Parser内部のみ）
- AST: docs/spec/ast-cir.md に準拠する抽象構文木
- CIR: docs/spec/ast-cir.md に準拠する中間表現（正規化後）
- Normalizer: AST → CIR（純関数）
- Evaluator: CIR → JS述語（インメモリ）
- Adapter: CIR → バックエンドクエリ（将来の拡張）

命名キーワード:
- cst*/ast*/cir* の接頭辞で層を明示
- Path は常に `{ segments: string[] }` とし、変数名は `path` に統一

## 変更種別と受け入れ基準
- docs: 仕様/設計の更新（影響範囲を記載）
- feat: 機能追加（互換性維持、docs/テスト更新必須）
- fix: バグ修正（再現テストを追加）
- refactor: 挙動不変（テストグリーン維持）
原則: 仕様の正は docs/spec/*.md。実装は必ず整合させてください。

## コミットとPR
- Conventional Commits 準拠（例）
  - `feat(normalize): invert NOT(&gt;=) to &lt;`
  - `fix(parser): handle escaped quote in string literal`
  - 破壊的変更: `feat!: drop deprecated Text operator` またはフッターに `BREAKING CHANGE:` を明記
  参照: https://www.conventionalcommits.org/  
- PRに含めるもの（チェックリスト）
  - [ ] テストが追加/更新されている（単体 or 統合）
  - [ ] lint/format が通っている
  - [ ] 仕様/設計に差分があれば docs を更新済み（docs/dev/error-handling.md, docs/dev/testing-guidelines.md など）
  - [ ] 影響範囲と互換性（破壊的変更の有無）を記載
  - [ ] 例外の型・エラーコードが規約に沿っている（ParseError / NormalizeError / EvaluationError / AdapterError、`E_<LAYER>_<KIND>`）

## テストの追加場所（目安）
- 構文の挙動: `test/parser.test.ts`
- 正規化規則: `test/normalize.test.ts`
- 評価の挙動: `test/evaluator*.test.ts`
- 通し/E2E: `test/integration/*.e2e.test.ts`（examples に依存）
- エラー検証の基本: `instanceof` と `code`（E_PARSE_*, E_NORMALIZE_*, E_EVAL_*, E_ADAPTER_*）を併記で確認（guides: docs/dev/testing-guidelines.md）

## 実装メモ（抜粋）
- Normalizer は純関数を徹底（副作用なし）
- コメントに出典を明記
  - 型定義: docs/spec/ast-cir.md
  - 変換規則: docs/design/normalization.md
- NOT の扱い（v0.1.0）
  - Text: Not を保持
  - Comparison: 比較反転で Not を除去
- エラー設計（横断）
  - 例外型: ParseError / NormalizeError / EvaluationError / AdapterError（基底: CirqueryError）
  - エラーコード: `E_<LAYER>_<KIND>`（例: E_PARSE_UNEXPECTED_TOKEN, E_EVAL_TYPE_MISMATCH, E_ADAPTER_UNSUPPORTED_FEATURE）
  - 詳細は docs/dev/error-handling.md を参照

## ライセンスと行動規範
- ライセンス: MIT（LICENSE を参照）
- 互いに敬意を払ったやり取りを心掛けてください
