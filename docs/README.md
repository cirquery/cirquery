cirquery/
└── docs/
    ├── spec/                 # 仕様書関連
    │   ├── dsl-v0.1.md       # DSL仕様（最新版）
    │   ├── ast-cir.md        # AST & CIR設計仕様
    │   ├── grammar-outline.md# 文法概要（BNF/構文図）
    │   └── changelog.md      # DSL仕様バージョン履歴と変更点
    │
    ├── design/               # 実装設計
    │   ├── parser.md         # Chevrotain実装方針＆最適化メモ
    │   ├── normalization.md  # AST→CIR正規化ルール
    │   ├── evaluator.md      # CIR→JS述語の設計
    │   └── adapters.md       # アダプタ設計方針（Mongo等）
    │
    ├── examples/             # DSLの使用例とサンプルクエリ
    │   ├── cocktails.md      # カクテルレシピを使ったクエリ例
    │   └── advanced.md       # 複合条件・配列作用の応用例
    │
    └── README.md             # docsディレクトリの説明・案内