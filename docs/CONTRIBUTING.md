コントリビューションガイド

- 目的
  - cirquery は、人間可読なDSLをAST→CIRへ正規化し、Evaluator/Adapterで活用するためのコアです。本ガイドは、開発環境のセットアップ、コーディング規約、レイヤごとの責務、PR方針を定めます。

- 開発環境
  - Node.js: v22（nvm推奨）
  - パッケージマネージャ: pnpm もしくは npm（プロジェクト標準に合わせる）
  - インストール
    - npm i
  - スクリプト
    - npm run build: tsupでCJS/ESM + dts出力
    - npm run test: vitest
    - npm run lint / npm run lint:fix: ESLint
    - npm run format: Prettier

- ディレクトリ構成（要点）
  - docs/
    - spec/: 仕様の正（Single Source of Truth）
      - ast-cir.md, dsl-v0.1.1.md
    - design/: 実装設計（parser.md, normalization.md ほか）
  - src/
    - parser/: Lexer/Parser/Visitor（CST→AST）
    - ast/: AST型
    - cir/: CIR型・正規化（AST→CIR）
    - core.ts: 公開APIのエントリー
    - utils/: ユーティリティ
  - test/: 単体・結合テスト

- 変更の種類と受け入れ基準
  - docs: 仕様・設計の更新（仕様整合必須、影響範囲の説明）
  - feat: 機能追加（互換性維持、docs更新、テスト必須）
  - fix: バグ修正（再現ケースのテスト追加）
  - refactor: 挙動不変の内部改善（テストグリーン維持）
  - chore/build/ci: メタ変更
  - 原則として、仕様（docs/spec/*.md）が唯一の正。実装は必ず仕様に合致させる。

- 命名規約とレイヤ責務
  - レイヤ
    - CST: Chevrotainのctx（Parser内部のみで完結）
    - AST: src/ast/types.ts（docs/spec/ast-cir.mdに準拠）
    - CIR: src/cir/types.ts（同上）
    - Normalizer: AST→CIR（構文に基づく純関数）
    - Evaluator: CIR→JS述語（インメモリ）
    - Adapter: CIR→DBクエリ（Mongo/SQL等）
  - 命名
    - 変数・型の接頭辞
      - cstXxx / XxxCst / ctxXxx（CST）
      - astXxx / XxxAst（AST）
      - cirXxx / XxxCir（CIR）
    - Parserのルール名: camelCase（例: orExpression）
    - Visitorメソッド: ルール名に一致（例: orExpression(ctx)）
    - Token名: PascalCase（例: And, Or, Identifier）
    - Pathは常に { segments: string[] }。変数は path で一貫、要素は path.segments に一本化
  - 文字列の演算子とトークン
    - Tokenの image と ASTの operator（'AND'等）は別概念。コメントで意図を明示。

- start_chars_hint の方針
  - Lexer最適化として start_chars_hint を積極的に利用します。対象例:
    - GreaterThan, GreaterThanOrEqual: ['&gt;']
    - LessThan, LessThanOrEqual: ['&lt;']
    - Equals: ['='], NotEquals: ['!'], Colon: [':']
    - LParen: ['('], RParen: [')'], Comma: [','], Dot: ['.']
  - 予約語（AND/OR/NOT 等）にも付与可能ですが、英字全般を始動文字とするため効果は限定的です。副作用回避のため付与は任意です。

- コーディング規約
  - TypeScript strict推奨、型は明示的に
  - 関数は副作用のない純関数を優先（特に normalizer）
  - 位置情報やエラーコード（E_PARSE_*, E_NORMALIZE_*, E_EVAL_*）は将来拡張を見据え、例外型を分離（ParseError/NormalizeError/EvalError）
  - コメントに出典を記載
    - AST/CIR型: 定義元 docs/spec/ast-cir.md
    - 変換規則: 定義元 docs/design/normalization.md

- テスト方針
  - parser.test.ts
    - 優先順位（NOT > AND > OR）、左結合、値リスト AND/OR、text shorthand
  - normalization.test.ts
    - 省略形展開、NOT押し下げ、複合値展開、複数セグメントパスの展開（Quantified any）、平坦化
  - cir.test.ts（Evaluatorができ次第）
    - 真偽/null、比較、text、quantifiedの空集合ポリシー
  - integration.test.ts
    - DSL→AST→CIRの通し、代表シナリオ
  - スナップショットは代表ケースに限定し、細粒度ケースは厳密一致で検証

- コミット規約
  - Conventional Commits推奨（feat:, fix:, docs:, refactor:, test:, chore:, build:, ci:）
  - PRには
    - 目的／背景
    - 仕様差分（該当する場合）
    - 影響範囲（破壊的変更の有無）
    - テスト項目
  - 小さく、レビューしやすいPRに分割

- 合意プロセス
  - 仕様変更は、先に docs/spec を更新・合意 → 実装
  - 実装設計変更は docs/design を更新
  - 仕様にない振る舞いは導入しない（まず仕様に追記）

- 注意事項（混乱しやすい点）
  - ルールC（複数セグメントパスの展開）
    - 実装は構文変換のみ。データが配列かは見ない
    - 「暗黙のany」はユーザー向け説明。実装では Quantified(any) への機械的変換と記述
  - Evaluator と Adapter は責務が異なる
    - Evaluator: インメモリ述語
    - Adapter: DBクエリ生成
  - NOTの扱い
    - AST: UnaryExpression('NOT')
    - CIR: 末端へ押し下げ。Textは Notで包む設計（v0.1）

- コントリビューションの流れ
  - Issueを作成し、背景・要件・代替案を共有
  - 仕様/設計ドキュメントに反映（必要時）
  - 実装・テスト・lint・formatを通す
  - PRを作成（説明・スクリーンショットや例を添付）
  - レビュー指摘に対応、スレッドを解決
  - メンテナがマージ

- ライセンスと行動規範
  - 本リポジトリの LICENSE に従う
  - 建設的・敬意あるコミュニケーションをお願いします

