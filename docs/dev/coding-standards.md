# Coding Standards (TypeScript/設計の横断規約)

本書は cirquery の実装全般に適用する横断的な規約です。層別の詳細（Lexer/Parserの最適化など）は docs/dev/lexer-and-parser.md を参照してください。

## 基本方針

- 型安全を最優先にする
  - tsconfig の strict 系は有効（strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes 等）。
  - 推論に頼りすぎず、API境界や分岐の要所では明示的な型注釈を付ける。
- 純関数と不変性を尊重する
  - 特に Normalizer（AST→CIR）は副作用なし・入力不変・出力決定的を徹底する。
  - 変換は新しいオブジェクト/配列を返す（破壊的変更は避ける）。
- 責務分割を徹底する
  - 1ファイル/1モジュールの役割を絞る。長い関数は分割（目安100行未満）。
  - 公開APIは src/index.ts の再エクスポートに統一し、内部実装は公開しない。

## ディレクトリと公開範囲

- 構成
  - parser/: トークナイズ/構文解析（Lexer/Parser/Visitor）
  - ast/: AST型定義
  - cir/: CIRの型・正規化・評価
  - adapters/: バックエンドアダプタ（将来拡張）
  - cli/: CLI（将来）
  - test/: 単体/結合/統合テスト（integration は test/integration/）
  - docs/: 公開ドキュメント、docs/dev/: 開発者向け詳細
- 公開ポリシー
  - パッケージのエクスポートは src/index.ts に限定する。
  - 将来サブパスエクスポートが必要な場合は exports に明示的に追加する。

## 命名・コードスタイル

- 識別子
  - Token名: PascalCase（And, Or, Identifier）
  - Parserルール: camelCase（orExpression）
  - Visitorメソッド: ルール名と一致（orExpression(ctx)）
  - ブール: is*/has*/can* 接頭辞を用いる。
  - 層接頭辞（必要に応じて）: cst*/ast*/cir* を使い誤用を防ぐ。
- パス表現
  - Path は `{ segments: string[] }` に統一。変数名は `path`、要素アクセスは `path.segments`。
- フォーマット/静的解析
  - Prettier 基本設定（printWidth 100, singleQuote, semi, trailingComma: all, endOfLine: lf）。
  - ESLint は TypeScript向け推奨設定をベース。未使用・到達不能等を検出する。
  - 競合回避が必要なら eslint-config-prettier を導入する。

## TypeScript規約

- 判別可能共用体（Discriminated Union）
  - `type` などの判別キーを持つユニオンを基本とし、ユーザー定義型ガードを積極利用する。
- any/unknown の扱い
  - any は原則禁止。外部入力は unknown とし、狭義化を行う。
- null/undefined
  - 返り値の null は慎重に。undefined で表現できる場合は undefined を選好し、選択理由をコメントする。
- ユーティリティ型
  - Pick/Partial/Omit/Readonly/Record など標準を優先。条件型や複雑な mapped types は読みやすさと保守性を重視。
- enum の代替
  - enum は極力避け、`as const` オブジェクト + `keyof typeof` を使う。

## エラー設計（横断）

- 例外型の分離
  - ParseError / NormalizeError / EvaluationError など層ごとに明確化する。
- エラーコード
  - `E_PARSE_*`, `E_NORMALIZE_*`, `E_EVAL_*` の形式。メッセージは簡潔・一貫・再現手順が想起できる内容にする。
- 例外か戻り値か
  - 仕様違反・パース不能は例外をスロー。
  - 実行時・評価時の「入力依存で失敗し得る処理」は、例外または Result 的（成功/失敗）戻り値を、呼び出し側の期待に合わせて統一する。

## ドキュメンテーション

- コメントの出典明記
  - 型定義（AST/CIR）の根拠: docs/spec/ast-cir.md
  - 変換規則の根拠: docs/design/normalization.md
  - Lexer/Parserの最適化根拠: docs/dev/lexer-and-parser.md
- コードコメント
  - 公開APIはTSDoc/JSDoc記法で要点を説明（パラメータ・返り値・例外）。
  - 内部実装は意図や制約・非自明なアルゴリズムの要点を1-3行で記す。

## 依存・モジュール指針

- 配布形式
  - ESM/CJS 両対応を維持（.mjs/.cjs）。型定義（.d.ts/.d.cts）を配布。
- 依存最小化
  - コアは最少依存を目指す。パーサは Chevrotain を使用。
  - 標準APIで代替可能な処理は外部依存を避ける。

## テストの原則（横断）

- どこに書くか
  - parser: 構文の受理/拒否、優先順位、結合規則
  - normalize: 省略形展開、否定の押し下げ、比較反転、構造の平坦化
  - evaluator: 真偽/比較/テキスト処理/量化子の空集合ポリシー
  - integration: DSL→AST→CIR の一貫性、examples 依存のE2Eシナリオ
- スナップショット
  - 代表ケースに限定。細粒度は厳密一致アサーションで担保。
- 実行順
  - install → typecheck → test →（必要に応じて）測定。examples に依存するテストは README の手順に合わせる。

## パフォーマンスの考慮

- ホットパスの明示
  - Lexer/Parser はホットパスになりやすい。docs/dev/lexer-and-parser.md の最適化方針（ensureOptimizations, start_chars_hint 等）に従う。
- 計測
  - 大きめ入力でウォームアップ後の挙動を観測。最適化追加/除去の前後差は同条件で比較する。
- 回帰防止
  - 重大な最適化方針（例: ensureOptimizations 必須）はユニットテストで検知する。

## ログ/デバッグ

- ログ
  - ライブラリコアではデフォルト無音。必要時はデバッグフラグ経由で詳細を出力できる拡張性を持たせる。
- デバッグユーティリティ
  - 内部専用の dump/trace は src/internal または scripts/ に隔離し、配布物から除外する。

## セキュリティ/入力検証（簡易）

- 不正入力
  - Lexer/Parser は例外で早期失敗させ、後段に曖昧な状態を渡さない。
- 文字列正規化
  - ケース/ダイアクリティクス処理はユースケースごとに明示的に適用し、暗黙の規則を導入しない。

## PR/レビュー指針（統一）

- PRの最小要件
  - 目的/背景の説明
  - 影響範囲と互換性（破壊的変更の有無）
  - 関連ドキュメント更新（spec/design/devいずれか）
  - テスト追加/更新（必要な層に）
  - lint/format/型検査が通過
- レビュー観点
  - 仕様整合（docs/spec と矛盾がないか）
  - 横断規約（本書）の遵守
  - 層の責務逸脱の有無（parser/ast/cir/evaluator）
  - ネーミング/可読性/保守性/テスト妥当性/パフォーマンス影響
- コミットメッセージ
  - `<type>(scope): <desc>` の形式（例: `feat(normalize): invert comparison under NOT`）
  - 破壊的変更は `!` または本文末尾に `BREAKING CHANGE:` を付記する。

## 例（判別共用体 + 型ガード）

```
type Node = AndNode | OrNode | ComparisonNode;

interface AndNode { type: 'and'; children: Node[] }
interface OrNode  { type: 'or';  children: Node[] }
interface ComparisonNode {
  type: 'cmp';
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le';
  // …
}

function isAnd(n: Node): n is AndNode { return n.type === 'and'; }
function isOr(n: Node): n is OrNode   { return n.type === 'or'; }

export function flattenAnd(n: Node): AndNode {
  if (!isAnd(n)) return n as AndNode;
  const children = n.children.flatMap(c => isAnd(c) ? c.children : [c]);
  return { ...n, children };
}
```

## 改訂ポリシー

- 本書は横断規約。変更時は PR タイトルに `[docs][standards]` を付け、要旨と影響範囲を記載する。
- 仕様・設計（docs/spec, docs/design）と矛盾する場合は、先にそちらを更新してから本書を追従させる。
