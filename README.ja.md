# cirquery

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/cirquery.svg)](https://www.npmjs.com/package/cirquery)

**Read this in other languages:** [English](README.md)

---

**cirquery**（Canonical Intermediate Representation Query）は、人間に優しいクエリDSLをバックエンドアダプタに変換するための共通中間表現（CIR）を提供するTypeScriptライブラリです。

## 🔬 JSON Playground

オンラインでcirquery DSLのフィルタリングを手軽に試せるプレイグラウンドを提供しています。  
ブラウザでJSONファイルをドラッグ&ドロップし、DSLクエリを直接実行できます。

[![Playground](https://img.shields.io/badge/Playground-Open-blue)](https://cirquery.github.io/cirquery/)

[https://cirquery.github.io/cirquery/](https://cirquery.github.io/cirquery/)

## ✨ 特徴

- **人間に優しいクエリ言語**: 自然な構文でデータ検索・フィルタリング条件を記述
- **共通中間表現**: DSLを統一されたCIRに正規化し、複数のバックエンドで再利用
- **型安全**: TypeScriptで完全に型付けされた設計
- **拡張可能**: カスタムアダプタやフィールド検索を簡単に追加
- **多言語対応**: アクセント除去やケースフォールディングをサポート

## 🚀 インストール

### 通常インストール（npm公式リリース）

最新版はnpmで配布されています。  
通常のパッケージとして以下コマンドで導入できます。
`npm install cirquery`

- npmパッケージ: [cirquery@npm](https://www.npmjs.com/package/cirquery)

詳細なローカル開発やテスト方法は「🛠️ 開発」セクションをご参照ください。

## 📖 基本的な使い方

### クエリの構文例

`cirquery`は、直感的なDSL（ドメイン固有言語）を使ってJSONデータにクエリを実行できます。以下に代表的な構文を示します。

-   **基本的な論理演算**
    等価比較 (`=`)、不等価比較 (`!=`)、数値比較 (`<`, `>`, `<=`, `>=`) と、それらを組み合わせる論理演算子 (`AND`, `OR`) をサポートしています。
    -   例: `category = "drink" AND price < 10`
    -   例: `is_alcoholic = true OR contains_citrus = true`

-   **テキスト検索**
    文字列の部分一致検索には、`contains`の省略形であるコロン (`:`) を使用します。
    -   例: `name:"Tonic"`

    前方一致 (`startsWith`) と後方一致 (`endsWith`) は関数形式で記述します。
    -   例: `startsWith(name, "Gin")`
    -   例: `endsWith(garnish, "peel")`

-   **配列・オブジェクトの量化子**
    配列の要素に対するクエリには、`any`（いずれかの要素が条件を満たす）または`all`（すべての要素が条件を満たす）量化子を使います。
    -   `ingredients`配列に`"rum"`を含むカクテル: `any(ingredients, name = "rum")`
    -   すべての材料が`"spirit"`であるカクテル: `all(ingredients, type = "spirit")`
    -   配列内のオブジェクトのプロパティへのアクセスは、ドット (`.`) で繋ぎます: `ingredients.name:"gin"`

-   **否定とグループ化**
    条件の否定には`NOT`を、複雑な条件の優先順位を明示するには括弧 `()` を使います。
    -   2000年以降ではないカクテル: `NOT (year >= 2000)`
    -   「ノンアルコール」または「スピリッツでかつ炭酸でない」もの: `is_alcoholic = false OR (type = "spirit" AND NOT is_carbonated = true)`

### JavaScript/TypeScript での使用

```
// DSLをパースしてCIRに正規化
const { ast } = parse('category = "cocktail" AND price < 15');
const cir = normalize(ast);

// CIRから述語関数を生成
const predicate = buildPredicate(cir);

// データに対してクエリを評価
const data = [
  { category: 'cocktail', price: 12, name: 'Mojito' },
  { category: 'wine', price: 20, name: 'Chardonnay' }
];

const results = data.filter(predicate);
console.log(results); // [{ category: 'cocktail', price: 12, name: 'Mojito' }]
```

### CLI での使用

```
# REPLを起動
npx cirquery

# ファイルに対してクエリ実行
echo '{"name":"test","category":"drink"}' | npx cirquery 'category = "drink"'
```

## 📚 ドキュメント

- [DSL構文リファレンス](docs/spec/dsl.md) - クエリ言語の詳細な構文
- [CIR仕様](docs/spec/ast-cir.md) - 中間表現の型定義
- [正規化設計](docs/design/normalization.md) - DSLからCIRへの変換仕様
- [サンプル集](examples/README.md) - 実用的なクエリ例

## 🛠️ 開発

### 前提条件

- Node.js 22+ 
- npm または pnpm

### セットアップ

```
git clone https://github.com/cirquery/cirquery.git
cd cirquery
npm install
npm run build
npm test
```

### ローカル利用・リンク方法

forkして手元で動作検証や開発を行いたい方向けに以下の方法を用意しています。


### 方法A: npm link（推奨・動作確認が容易）

1. リポジトリ直下でリンクを作成
   ```
   npm ci
   npm run build
   npm link
   ```
2. 利用したい別プロジェクトでリンク
   ```
   npm link cirquery
   ```
3. そのプロジェクトから `import 'cirquery'` で参照できます。

解除:
```
npm unlink cirquery && npm unlink --global cirquery
```

### 方法B: 相対インストール（簡易）

別プロジェクトで、ビルド成果物を直接参照します。
```
npm install /absolute/path/to/cirquery
```
注: ソース一式が取り込まれるため、本番に近い検証には方法Aの `npm link` を推奨します。

### 方法C: パッケージ化して検証（本番配布に近い）

1. このリポジトリでパックを生成
   ```
   npm run build
   npm pack
   ```
   distとpackage.jsonの設定に基づくtarballが生成されます（例: `cirquery-0.1.0.tgz`）。

2. 別プロジェクトでインストール
   ```
   npm install /path/to/cirquery-0.1.0.tgz
   ```


### ディレクトリ構成

```
├── src/                 # ソースコード
│   ├── parser/          # DSL パーサ
│   ├── cir/            # CIR 正規化・評価
│   ├── cli/            # CLI ツール
│   └── adapters/       # バックエンドアダプタ
├── test/               # テスト
├── docs/               # ドキュメント
├── examples/           # サンプル・データ
└── scripts/            # 開発補助スクリプト
```

### ツール配置の方針

- scripts/: 開発者向けの補助スクリプトを配置します（例: examples をローカルで実行する run-example.ts など）。配布対象ではありません。
- 将来的にCLIを提供する場合は bin/ を新設し、package.json の "bin" フィールドで公開します（現時点では bin/ は使用していません）。
- src/adapters/ は学習・E2Eの参照実装置き場です。npm 配布には含まれません。各バックエンドに合わせたアダプタは CIR を基に実装可能です（docs/dev/adapters.md 参照）。

### スクリプト

- `npm run build` - TypeScript をビルド（ESM/CJS）
- `npm test` - テスト実行
- `npm run typecheck` - 型チェック
- `npm run lint` - ESLint 実行
- `npm run format` - Prettier でフォーマット

### E2Eテストの前提と実行

E2E テストは `examples/` 配下のデータとクエリに依存します。

前提:
- Node 22+
- `examples/data/*.json`（drinks.json / cocktails.json など）
- `examples/queries/*`

実行:
- 依存インストール: `npm ci`
- 全テスト: `npm test`
- 特定のE2Eのみ: `vitest run test/integration/sqlite.e2e.test.ts`

注意:
- examples のデータやクエリを変更した場合、E2Eの期待結果も更新が必要です。

## 🔧 アーキテクチャ

```
[DSL] → [Parser] → [AST] → [Normalize] → [CIR] → [Evaluator/Adapters]
```

1. **DSL**: 人間に優しいクエリ言語
2. **Parser**: DSLを構文解析してASTを生成
3. **Normalize**: ASTを正規化してCIRに変換
4. **Evaluator/Adapters**: CIRを実行（JavaScript評価、DB変換など）

## 🎯 ロードマップ

## 🎯 ロードマップ

### v0.1 (完了)
- [x] 基本DSL構文（論理演算、比較、テキスト検索、量化子）
- [x] CIR正規化（De Morgan、NOT最適化）
- [x] JavaScript評価器
- [x] アクセント除去・ケースフォールディング

### v0.2 (現在)
- [x] 多段配列パスのショートハンドサポート (← 今回の変更を反映)

### v0.3 (予定)
- [ ] ValueList内明示OR/AND対応
- [ ] 全フィールド検索（ANYFIELD）
- [ ] 追加のバックエンドアダプタ


## 🤝 コントリビューション

バグレポート、機能要望、プルリクエストを歓迎します！

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

詳細は [CONTRIBUTING.md](docs/CONTRIBUTING.md) を参照してください。

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。

## 🙏 謝辞

- [Chevrotain](https://github.com/Chevrotain/chevrotain) - パーサジェネレータ
- [Vitest](https://vitest.dev/) - テストフレームワーク
- [tsup](https://github.com/egoist/tsup) - TypeScriptバンドラ

---

<div align="center">
Made with ❤️ for better data querying
</div>
