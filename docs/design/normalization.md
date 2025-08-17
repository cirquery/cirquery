## **docs/design/normalization.md**

### **1. 目的**

このドキュメントは、AST (Abstract Syntax Tree) から CIR (Canonical Intermediate Representation) への変換プロセス、すなわち「正規化」のルールと手順を定義します。

正規化の主な目的は以下の通りです。
-   **省略形の展開**: `path:value` のような省略形を、`contains` のような明示的な演算に変換します。
-   **表現の統一**: 多様な表現方法（例: `NOT any(...)` と `none(...)`）を、一貫した形式に統一します。
-   **構造の単純化**: `NOT` 演算子を可能な限り末端に押し下げることで、後段の評価器やアダプタの実装を大幅に簡素化します。

この正規化プロセスを経ることで、バックエンド非依存で、かつ機械的に処理しやすい中間表現CIRが完成します。

### **2. 正規化フローの概要**

正規化は、ASTを受け取りCIRを返す純粋な関数として実装されることを想定しています。  
`normalize(astNode: AstNode): CirNode`

実装は、ASTを再帰的に巡回するVisitorパターンや、パターンマッチを用いた変換関数によって行います。処理は基本的にボトムアップ、つまり子のノードを先に正規化し、その結果を使って親ノードを組み立てます。

### **3. 主要な正規化ルール**

以下に、ASTからCIRへの主要な変換ルールを定義します。

#### **ルールA: 省略形の展開**

ASTの `TextShorthandExpression` ノードを、CIRの `ComparisonNode` または `TextNode` に変換します。

-   **テキスト部分一致**:
    -   **AST**: `{ type: 'TextShorthandExpression', path: { type: 'Path', segments:['name']}, value: {type: 'StringLiteral', value: 'ジン'} }`
    -   **CIR**: `{ type: 'Text', path: { type: 'Path', segments:['name']}, op: 'contains', value: {type: 'StringLiteral', value: 'ジン'} }`

-   **比較演算**:
    -   **AST**: `{ type: 'TextShorthandExpression', path: { type: 'Path', segments:['price']}, value: {type: 'ComparisonShorthand', operator: '>', value: {type:'NumberLiteral', value:1000}} }`
    -   **CIR**: `{ type: 'Comparison', path: { type: 'Path', segments:['price']}, op: 'gt', value: {type:'NumberLiteral', value:1000} }`

- **補足**
    - テキスト関数（`contains` / `startsWith` / `endsWith`）は `(path, string)` を要求します。第2引数が文字列以外の場合は正規化エラー（例: `text functions require a string literal as the second argument`）とします。
    - 量化子（`any` / `all` / `none`）は `(path, expr)` を要求します。現状は引数不足（例: `any(items)`) は構文解析段階でエラーになります（将来的に正規化層での引数検証に移行する可能性があります）。



#### **ルールB: 複合値リストの展開**

ASTの `ValueListExpression` を、CIRの `AndNode` または `OrNode` に変換します。

-   **文字列リスト（暗黙のOR）**:
    -   **AST**: `{ type: 'ValueListExpression', values: [{type:'StringLiteral', value:'A'}, {type:'StringLiteral', value:'B'}] }`
    -   **CIR**: `{ type: 'Or', children: [ TextNode('A'), TextNode('B') ] }`

-   **数値比較リスト（暗黙のAND）**:
    -   **AST**: `{ type: 'ValueListExpression', values: [ ComparisonShorthand('>', 5), ComparisonShorthand('<', 13) ] }`
    -   **CIR**: `{ type: 'And', children: [ ComparisonNode('gt', 5), ComparisonNode('lt', 13) ] }`

-   **明示的なAND/OR**: 括弧内で `AND` や `OR` が明示されている場合は、それに従います。
    -   **AST**: `{ type: 'ValueListExpression', values: [ ... ], operator: 'AND' }`
    -   **CIR**: `{ type: 'And', children: [ ... ] }`

**注記**: 現行文法では `valueList` は1要素以上必須（空の () はパースエラー）。空リストの正規化エラー検証は不要。

#### **ルールC: 配列ショートハンドの展開**

フィールドパスが複数のセグメントで構成される場合（例: `ingredients.name`）、その操作を明示的な `QuantifiedNode` に正規化します。これは、ユーザーが`any()`を明示的に書かなくても、ドット記法（例: ingredients.name）で配列内オブジェクトのフィールドを検索できる、直感的なショートハンドを提供するための実装です。

-   **対象**: CIRに変換された後の `TextNode` や `ComparisonNode` が持つパス構造。
-   **トリガー条件**: パスのセグメントが2つ以上存在する場合（例: `['ingredients', 'name']`）。

-   **変換前 (AST)**: `ingredients.name:"ジン"`
-   **初期CIR**: `{ type: 'Text', path: {segments:['ingredients', 'name']}, op: 'contains', value: ... }`
-   **正規化後CIR**: パスの最初のセグメントを QuantifiedNode の path とし、残りのパスを持つ条件を inner に設定します。
    ```json
    {
        "type": "Quantified",
        "quantifier": "any",
        "path": { "type": "Path", "segments": ["ingredients"] },
        "predicate": { "type": "Text", "path": { "type": "Path", "segments": ["name"] }, ... }
    }
    ```

> **実装注記**: この変換ロジックは、正規化プロセスの後半で適用することを推奨します。まずASTから基本的なCIRノード（`TextNode`や`ComparisonNode`）を生成し、その後、そのノードが持つ`path`を検査して、必要であれば`QuantifiedNode`でラップするという2段階の処理が考えられます。  
>この変換は**純粋に構文的なもの**であり、対象フィールドが実際に配列かどうかを知る必要はありません。この抽象化は、後段の`Evaluator`や`Adapter`が「単一オブジェクトを要素数1の配列とみなす」などの戦略で吸収します。これにより、正規化処理はデータ構造に依存しない、高速で単純な変換であり続けることができます。
- 本実装では単段ラップ: `segments=[head, ...tail]` のとき、`Quantified(any).path=[head]`、`predicate` の `path=[tail]` とする。多段ラップは v0.1 の対象外。
- 適用ポイントは「正規化の共通出口」で `Text`/`Comparison` に対して行い、`OR`/`AND` の `children` を組み立てる箇所でも子に適用する。論理ノード（`And`/`Or`/`Not`/`Quantified`）自体は対象外。
- 例の `Path` 表現は `{ type:'Path', segments:[...] }` で統一（外側/内側とも）。



#### **ルールD: NOTの押し下げ（否定正規形）**

`NOT` 演算子をツリーの末端へ移動させ、可能な限り `ComparisonNode` や `TextNode` の否定形（`neq`, `not contains`など）に変換します。

-   **ド・モルガンの法則**:
    -   `NOT (A AND B)` → `(NOT A) OR (NOT B)`
    -   `NOT (A OR B)` → `(NOT A) AND (NOT B)`

-   **量化子の変換**:
    -   `NOT any(P, X)` → `none(P, X)`
    -   `NOT all(P, X)` → `any(P, NOT X)`
    -   `NOT none(P, X)` → `any(P, X)`

-   **比較演算子の反転**:
    -   `NOT (price > 10)` → `price <= 10`
    -   反転ルール: `eq` ⇔ `neq`, `gt` ⇔ `lte`, `gte` ⇔ `lt`
    - 実装ノート: `ComparisonNode` に対する否定は、ド・モルガン展開よりも先に「反転」を適用して `NotNode` を除去する（簡潔なCIRを優先）。

-   **テキスト演算の否定**:
    -   v0.1では、`not-contains` のような演算子はCIRに導入しません。
    -   `NOT contains(name, "ジン")` は、CIR上では `NotNode` で `TextNode` をラップしたままにします。
    -   **CIR**: `{ type: 'Not', child: { type: 'Text', op: 'contains', ... } }`

#### **ルールE: 構造の平坦化**

正規化の最後に、不要なネスト構造を平坦化し、CIRをよりシンプルにします。

-   **変換前**: `{ type: 'And', children: [ {type:'And', children:[A, B]}, C ] }`
-   **変換後**: `{ type: 'And', children: [ A, B, C ] }`


#### **ルールF**: Truthyな式の正規化（補足）

- Path単体は、存在判定に相当する比較へ正規化します。  
  CIR: `{ type: 'Comparison', path: { type: 'Path', segments:[...] }, op: 'neq', value: { type: 'NullLiteral' } }`
- Literal単体（例: `"text"`, `0`, `true`, `null` など）の truthy/falsy 判定は現状未定義です。  
  仕様上サポート外のため、正規化の対象外（エラー）とします。


### **4. 正規化の処理順序**

正確なCIRを生成するため、正規化ルールは以下の順序で適用することを推奨します。

1.  **ボトムアップ変換**: ASTを再帰的に巡回し、まず子のノードを正規化します。
2.  **基本展開**: この過程で、ルールA（省略形）とルールB（複合値リスト）を適用し、基本的な `ComparisonNode`, `TextNode`, `AndNode`, `OrNode` を生成します。
3.  **配列展開**: ルールCを適用し、ドット付きパスを持つノードを `QuantifiedNode` でラップします。
4.  **否定の押し下げ**: ルールDを適用し、ツリーの上部にある `NotNode` を可能な限り下層へ移動・変換します。
   - 優先順序: 
     1) `ComparisonNode` に対する `NOT` は「演算子反転」を先に適用して `NotNode` を除去する。  
     2) その後、残る `NOT` にはド・モルガンや量化子変換を適用する。  
     3) `TextNode` の否定は v0.1 では `NotNode(Text)` を保持する。
5.  **平坦化**: 最後にルールEを適用し、全体の構造をクリーンアップします。

    -  補足:  "5" の平坦化の前までに、Path単体の truthy 変換（ルールFの前段：`path != null`）が適用されていることを前提とします。



### **5. 実装に関する注意点**

-   **不変性**: 正規化関数は、元のASTを変更しない純粋関数として実装してください。
-   **網羅的なテスト**: `dsl.md` の第15章にある写像例や、様々なエッジケースを含むテストスイートを用意し、正規化ロジックの正しさを担保してください。

