## **docs/design/parser.md**

### **1. 目的**

このドキュメントは、`cirquery`プロジェクトにおけるパーサーの実装方針を定義します。  
目標は、`dsl-v0.1.1.md` 仕様書に準拠したDSL文字列を、`ast-cir.md` で定義された**AST (Abstract Syntax Tree)** へと変換する、堅牢で高パフォーマンスなパーサーを構築することです。

### **2. 技術選定：Chevrotain**

パーサーライブラリとして **Chevrotain** を採用します。選定理由は以下の通りです。

-   **パフォーマンス**: JavaScript製パーサーライブラリの中でトップクラスの性能を誇ります。
-   **TypeScriptとの親和性**: 生成ステップが不要なParsing DSL形式であり、TypeScriptの型安全性を最大限に活用できます。
-   **強力なエラー回復**: 構文エラーが発生してもパースを継続し、複数のエラーを一度に報告する機能が標準で備わっています。
-   **優れたデバッグ機能**: 文法図の自動生成など、開発を支援するツールが充実しています。



### **3. Lexer（トークナイザ）設計**

Lexerは、入力文字列を意味のあるトークンの連続に分割します。ここでは、まずトークンの一覧をテーブルで示し、その後に実装の基礎となる完全なコードを提示します。

#### **3.1 トークン概要一覧**

以下のテーブルは、本DSLで定義される主要なトークンの概要です。詳細な定義と優先順位は、後述の「3.2 トークン定義コード」を参照してください。

| トークン名 | カテゴリ | パターン（例） | 説明・備考 |
| :--- | :--- | :--- | :--- |
| `And`, `Or`, `Not` | `Keyword` | `/AND/i` | 論理演算子。大文字小文字を区別しない。`Identifier`より優先。 |
| `True`, `False`, `Null` | `Keyword` | `/true/i` | 真偽値・nullリテラル。 |
| `Contains`, `Any` ... | `Keyword` | `/contains/i` | 関数名。 |
| `GreaterThanOrEqual` | `Operator` | `>=` | 比較演算子。1文字の`>`より優先。 |
| `GreaterThan` | `Operator` | `>` | 比較演算子。 |
| `Colon`, `LParen`, `Comma` | `Separator` | `:`, `(`, `,` | 構文上の区切り文字。 |
| `StringLiteral` | `Literal` | `"[^"]*"` | ダブルクオートで囲まれた文字列（値・識別子両用。詳細は下記参照）。 |
| `NumberLiteral` | `Literal` | `-?\d+` | 数値。 |
| `Identifier` | `Identifier` | `[a-zA-Z_]\w*` | フィールド名など。すべての`Keyword`の後に評価される。 |

> 注:
> 本DSLでは文法的には「QuotedIdentifier（例: "my field"）とStringLiteral（例: "値"）」を意味上区別しますが、
> Lexer（Chevrotain）の制約によって、これらはすべてStringLiteralトークンとして統一されます。
> Parser/Visitorで「フィールドパスか値か」という文脈に基づいて意味的に区別します。
> 先頭セグメントは Identifier 限定、Dot 以降のセグメントのみ QuotedIdentifier（= StringLiteral をパス文脈で解釈）を許容します（B案 Phase1）。

#### **3.2 トークン定義コード**

実装の際には、以下の2つのファイルに分けてトークンを定義することを推奨します。

**ファイル1: `src/parser/categories.ts` （トークンカテゴリ）**

```typescript
// src/parser/categories.ts
import { createToken } from 'chevrotain';

// 全てのトークンの基底となるカテゴリ。直接は使用しない。
export const Token = createToken({ name: 'Token', pattern: /NA/ });

// 予約語や関数名など、識別子より優先されるべきトークン
export const Keyword = createToken({ name: 'Keyword', categories: Token });

// 比較演算子や区切り文字など
export const Operator = createToken({ name: 'Operator', categories: Token });
export const Separator = createToken({ name: 'Separator', categories: Token });

// リテラル値
export const Literal = createToken({ name: 'Literal', categories: Token });

// 識別子
export const Identifier = createToken({ name: 'Identifier', categories: Token });
```

**ファイル2: `src/parser/tokens.ts` （個別トークン定義）**
```typescript
// src/parser/tokens.ts
import { createToken, Lexer } from 'chevrotain';
import { Keyword, Operator, Separator, Literal, Identifier as IdentifierCat } from './categories.ts';

// 1. 無視するトークン
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

// 2. キーワード（Keywordカテゴリ）
// 正規表現の末尾に単語境界 `\b` を追加し、意図しない部分一致を防ぐ
export const And = createToken({ name: 'And', pattern: /AND\b/i, categories: Keyword });
export const Or = createToken({ name: 'Or', pattern: /OR\b/i, categories: Keyword });
export const Not = createToken({ name: 'Not', pattern: /NOT\b/i, categories: Keyword });
export const True = createToken({ name: 'True', pattern: /true\b/i, categories: Keyword });
export const False = createToken({ name: 'False', pattern: /false\b/i, categories: Keyword });
export const Null = createToken({ name: 'Null', pattern: /null\b/i, categories: Keyword });
export const Contains = createToken({ name: 'Contains', pattern: /contains\b/i, categories: Keyword });
export const StartsWith = createToken({ name: 'StartsWith', pattern: /startsWith\b/i, categories: Keyword });
export const EndsWith = createToken({ name: 'EndsWith', pattern: /endsWith\b/i, categories: Keyword });
export const Any = createToken({ name: 'Any', pattern: /any\b/i, categories: Keyword });
export const All = createToken({ name: 'All', pattern: /all\b/i, categories: Keyword });
export const None = createToken({ name: 'None', pattern: /none\b/i, categories: Keyword });

// 3. 演算子と区切り文字 (変更なし)
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/, categories: Operator });
export const GreaterThanOrEqual = createToken({ name: 'GreaterThanOrEqual', pattern: />=/, categories: Operator });
export const LessThan = createToken({ name: 'LessThan', pattern: /</, categories: Operator });
export const LessThanOrEqual = createToken({ name: 'LessThanOrEqual', pattern: /<=/, categories: Operator });
export const Equals = createToken({ name: 'Equals', pattern: /=/, categories: Operator });
export const NotEquals = createToken({ name: 'NotEquals', pattern: /!=/, categories: Operator });
export const Colon = createToken({ name: 'Colon', pattern: /:/, categories: Operator });
export const LParen = createToken({ name: 'LParen', pattern: /\(/, categories: Separator });
export const RParen = createToken({ name: 'RParen', pattern: /\)/, categories: Separator });
export const Comma = createToken({ name: 'Comma', pattern: /,/, categories: Separator });
export const Dot = createToken({ name: 'Dot', pattern: /\./, categories: Separator });

// 4. リテラル（変更なし）
export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(:?[^\\"]|\\(:?[bfnrtv"\\/]|u[0-9a-fA-F]{4}))*"/,
  categories: Literal,
});
export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  categories: Literal,
});

// 5. 識別子（変更なし）
export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_][a-zA-Z0-9_-]*/,
  categories: IdentifierCat,
});

// 6. Lexerに渡すトークンの順序
// 優先度の高いものから順に並べる
export const allTokens = [
  WhiteSpace,
  // キーワードを識別子より先に定義する
  And, Or, Not, True, False, Null, Contains, StartsWith, EndsWith, Any, All, None,
  // 2文字演算子を1文字より先に
  GreaterThanOrEqual, LessThanOrEqual, NotEquals,
  // その他の演算子と区切り文字
  GreaterThan, LessThan, Equals, Colon, LParen, RParen, Comma, Dot,
  // 最後にリテラルと識別子
  StringLiteral, NumberLiteral,
  Identifier,
];

　/*
  【実装注記】
  ― 本DSLでは文法的には「QuotedIdentifier（例: "my field"）とStringLiteral（例: "値"）」を意味上区別しますが、Lexer（Chevrotain）の制約によって、これらはすべてStringLiteralトークンとして統一されます。  
  - フィールドパスの文脈で現れたStringLiteralは意味的にQuotedIdentifierとして（Visitorで）解釈・格納します。
  - 先頭セグメントは Identifier 限定、Dot 以降のセグメントのみ QuotedIdentifier（= StringLiteral をパス文脈で解釈）を許容します（将来変更予定）。
　*/
```

#### **3.3 トークン定義に関する補足（優先順位と最適化）**

`#3.2` で定義したコード、特に `allTokens` 配列には、ChevrotainのLexerを正しく動作させるための重要なルールが適用されています。ここではその設計意図を解説します。

-   **キーワード vs 識別子**:
    `allTokens` 配列では、`And` や `Or` といった `Keyword` カテゴリのトークンが、汎用的な `Identifier` トークンよりも**先に**定義されています。これは、`and` という文字列が `Identifier` ではなく、予約語 `And` として正しく認識されるようにするための、Chevrotainにおける基本的なルールです。

-   **複合演算子の優先**:
    `>=` (`GreaterThanOrEqual`) のような2文字以上の演算子は、その接頭辞となりうる1文字の演算子 `>` (`GreaterThan`) よりも**先に**定義されています。もし順序が逆だと、`>=` は `>` と `=` の2つのトークンに誤って分割されてしまいます。

- **ダブルクオート囲み（"..."）のフィールド名と値の取り扱いについて**:
    - フィールドパスのクオート付き識別子（例: `"my-field"`）も、値の文字列リテラル（例: `name = "value"`）も
      Lexer では **すべて `StringLiteral` トークンとして受け** ています。
    - **Chevrotainの仕様**（同一正規表現パターンのToken型は定義できない）により、`QuotedIdentifier`という名前のToken型は実装上存在しません。
    - **Parser・Visitorでは**、`fieldPath`など「フィールドパス文脈」で現れた`StringLiteral`を意味的にQuotedIdentifierと解釈し、パスの一部（segments）として格納します。
    - フィールドパスの QuotedIdentifier は、B案 Phase1 として「先頭セグメントは不可」「Dot 以降のみ許容」とします。
    - 逆に、値の文脈で現れたものは通常の`StringLiteral`（値リテラル）として扱います。
    - **この「トークンとしては一元化し、文脈で意味を分ける実装」はChevrotainパーサーの制約に起因します（実装ドキュメントにもこの設計理由を明記）。**


-   **パフォーマンス最適化**:
    本実装時には、各 `createToken` のコンフィグに `start_chars_hint: ['>']` のようなヒントを追加することを強く推奨します。これにより、Lexerは入力文字列の最初の文字を見るだけで、マッチする可能性のあるトークンを高速に絞り込むことができ、パース全体のパフォーマンスが向上します。

    ```typescript
    // src/parser/tokens.ts の修正例
    // ...
    export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/, categories: Operator, start_chars_hint: ['>'] });
    export const GreaterThanOrEqual = createToken({ name: 'GreaterThanOrEqual', pattern: />=/, categories: Operator, start_chars_hint: ['>'] });
    export const LessThan = createToken({ name: 'LessThan', pattern: /</, categories: Operator, start_chars_hint: ['<'] });
    export const LessThanOrEqual = createToken({ name: 'LessThanOrEqual', pattern: /<=/, categories: Operator, start_chars_hint: ['<'] });
    // ...
    export const LParen = createToken({ name: 'LParen', pattern: /\(/, categories: Separator, start_chars_hint: ['('] });
    ```

### **4. Parser（文法）設計**

Parserは、Lexerが生成したトークンストリームを解釈し、構文構造（CST: Concrete Syntax Tree）を構築します。

#### 4.1 ルール定義

`dsl.md`の仕様に基づき、パーサーは以下の主要なルールを定義します。これらのルールは#5.2で定義するCSTからASTへの変換マッピングの基礎となります。

- 演算子の優先順位を表現するためのルール群。
  -   `expression`: トップレベルのルール。`orExpression` を呼び出す。
  -   `orExpression`: `OR` 演算子のためのルール。左結合性を実現するため `MANY_SEP` を使用。
  -   `andExpression`: `AND` 演算子のためのルール。`orExpression`よりも高い優先順位を持つ。
  -   `notExpression`: `NOT` 演算子のための単項演算ルール。

-   `atomicExpression`: `notExpression`から呼び出される、演算子の優先順位チェーンにおける末端の要素（アトム）を定義するルール。
  - atomicExpression の分岐優先順は「group → call → literal（String/Number/True/False/Null）→ pathBased」とします。  
  目的: 関数引数等の値文脈で現れる "..." を確実に literal として受け、path 文脈へ吸い込まないようにするため。
-   `pathBasedExpression`: 曖昧性解決の核となるルール。 `fieldPath`で始まる式の可能性（比較式、コロン区切り式、truthyなパス）をすべて処理します。
  - 起動条件は `atomicExpression` 側の `OR` 代替内の `GATE` で制御し、「先頭トークンが `Identifier` の場合のみ」呼び出すようにします。

- 曖昧さのない括弧付きの式や関数呼び出しを定義。
  -   `callExpression`: `any(path, ...)`のような、明示的な関数呼び出しをパース。
  -   `groupExpression`: `(...)`のように括弧で囲まれた式をパース。

- 文法の基本部品となるルール。
  -   `fieldPath`: `author.name`のような、ドット区切りのフィールドパスをパースする基本ルール。
    - fieldPath は B案 Phase1: 先頭は Identifier 限定、Dot 以降のセグメントで Identifier または StringLiteral（QuotedIdentifier）を許容します。
  -   `literal`: 文字列、数値、真偽値、nullといったリテラル値をパースする基本ルール。
  -   `valueList`: `("A", "B")` や `(>5, <13)` のような複合値リストをパース。

#### 4.2 演算子の優先順位の実装
Chevrotainでは、ルールの呼び出し順序によって演算子の優先順位を表現します。本パーサーでは、それに加えて左共通部分の括りだし（**Left Factoring**） という設計パターンを適用し、文法の曖昧性を解決します。
- B案 Phase1 における曖昧性回避の要点:
  - `atomicExpression` の `OR` 代替内で `GATE` を使い、「先頭が `Identifier` の場合のみ `pathBasedExpression` を起動」します。
  - これにより、`contains(name, "gin")` 等の第2引数の "..." は `literal` として扱われ、`path` へ誤って吸い込まれません。

- 優先順位:  
`orExpression` (低) → `andExpression` → `notExpression` (高) → `atomicExpression` の順でルールを呼び出します。

- 曖昧性解決:  
`path > 10`（比較式）と `path`（truthyなパス）のように、複数の文法ルールが同じトークン (Identifier) で始まることで曖昧性が生じます。これを解決するため、`atomicExpression`から`pathBasedExpression`ルールを呼び出します。
`pathBasedExpression`ルールは、まず共通部分である`fieldPath`を消費し、その直後に続くトークン（`>`, `:`, `EOF`など）に応じて処理を分岐させます。これにより、パーサーはどの文法を適用すべきかを明確に判断できます。

この設計に関する具体的なコードは、実装ファイル src/parser/parser.ts を参照してください。

### **5. CSTからASTへの変換戦略（Visitor実装）**

Chevrotainパーサーは、入力されたDSL文字列を直接AST（抽象構文木）に変換するのではなく、まず **CST (Concrete Syntax Tree; 具象構文木)** を生成します。この章では、CSTから私たちが定義したカスタムASTへと変換するための戦略を説明します。  
> CSTとは？
> CST (Concrete Syntax Tree) は、DSLの構文を構成するすべてのトークン（括弧 `(``)` やカンマ `,`、演算子キーワード） を忠実に保持したツリーです。これにより、元のコードの構造が完全に再現されます。
> 私たちは、この冗長なCSTから、プログラムの意味的な構造のみを抽出した、より扱いやすい AST へと変換します。この「CST→AST」というステップを踏むことで、パース処理と意味構造の構築を分離でき、コードの保守性や拡張性が向上します。
>
> **正規化（Normalization）とのつながり:**  
> このパーサーによって生成されたASTは、次のフェーズである**正規化モジュール（docs/design/normalization.md で詳細定義）**の入力となります。正規化モジュールは、このASTをさらに一貫性のあるCIR（Canonical Intermediate Representation）へと変換します。したがって、本セクションで定義するASTの構造は、正規化処理の前提となります。

#### **5.1 変換アプローチ**
CSTからASTへの変換には、**Visitorパターン**を採用します。Chevrotainが提供する `BaseCstVisitor` を継承した `AstBuilderVisitor` クラスを実装し、CSTの各ノードを巡回しながらASTノードを構築します。

#### **5.2 変換マッピングルール**
以下のテーブルは、#4.1で定義した各CSTルールからASTノードへのマッピング定義です。Visitorは、このルールに従ってASTを構築する必要があります。

>注記:  
>ここで言及されるASTノードの具体的なプロパティや型定義については、docs/spec/ast-cir.md を唯一の正しい情報源（Single Source of Truth）としてください。


| CSTルール名 | 生成するASTノード | 主要なマッピングロジック |
| :--- | :--- | :--- |
| `expression` | `Ast.Expression` | 子要素である `orExpression` をvisitし、その結果（ASTノード）をそのまま返します。 |
| `orExpression` | `LogicalExpression` | 左辺を初期ノードとし、複数の`OR`節があれば、左結合で`LogicalExpression`をネストして構築します。`operator`は`'OR'`。 |
| `andExpression` | `LogicalExpression` | `orExpression`と同様に、左結合で`LogicalExpression`を構築します。`operator`は`'AND'`。 |
| `notExpression` | `UnaryExpression` | `NOT`トークンが存在する場合、後続の式を再帰的にvisitし、`argument`プロパティに設定します。`operator`は`'NOT'`。 |
| `atomicExpression` | `Ast.Expression` | 子要素（`groupExpression`, `callExpression`, `pathBasedExpression`など）のいずれか一つをvisitし、その結果を返します。分岐の役割を果たします。分岐順は group → call → literal（String/Number/True/False/Null）→ pathBased。literal を先に評価することで、関数引数の "..." を確実に値として扱う。|
| `pathBasedExpression` | `ComparisonExpression`または `TextShorthandExpression` または `PathNode`| `fieldPath`をvisitした後、後続のトークン（`comparisonOperator`, `Colon`）の有無に応じて、生成するASTノードを動的に決定します。後続がなければ`PathNode`を返します。 |
| `callExpression` | `CallExpression` | 関数名（例: `any`）を`callee`に、引数を`args`配列にマッピングします。引数は children から arg1/arg2 を visit。引数は AST として (`PathNode` | `Expression`) を受ける。 |
| `groupExpression` | `GroupExpression` | 括弧内の`expression`を再帰的にvisitし、`expression`プロパティに設定します。括弧自体のトークンはASTから除去します。 |
| `fieldPath` | `PathNode` |  `Identifier`または`StringLiteral`（＝クオート識別子。実装注記参照）トークンイメージを抽出し、`segments`配列に格納。クオート除去処理もここで実施。先頭は `Identifier` のみ。Dot 以降のセグメントに限り `StringLiteral`（= QuotedIdentifier）も許容し、unquote した文字列を `segments` に格納する。 |
| `literal` | 各種`LiteralNode` | 各リテラルトークンのイメージを、対応するJavaScriptのプリミティブ値に変換し、`value`プロパティに設定します。 |
| `valueList` | `ValueListExpression` | 括弧内の各要素をvisitし、`values`配列に格納します。内部で`AND`/`OR`が使われていれば`operator`に設定します。 |

>（実装注記）:
>フィールドパス中の "..." は、Lexerでは StringLiteralトークンとなりますが、Visitor等で「フィールドパスの一部ならQuoutedIdentifierとして意味的に扱われる」点に注意。
***



#### **5.3 実装サンプル（`orExpression`の例）**
`orExpression` のように、複数の項を左結合で処理するルールの実装イメージを以下に示します。Visitorの他のメソッドも、このパターンに倣って実装します。

```typescript
// in AstBuilderVisitor class

/**
 * OR演算を変換する
 * 例: A OR B OR C -> ((A OR B) OR C)
 */
    orExpression(ctx: any): AstExpression {
      // 左結合の二項演算子を処理する共通パターン
      let astNode = this.visit(ctx.lhs);
      if (ctx.rhs) {
        ctx.rhs.forEach((rhsNode: any) => {
          const right = this.visit(rhsNode);
          astNode = {
            type: 'LogicalExpression',
            operator: 'OR',
            left: astNode,
            right,
          } as AstLogicalExpression;
        });
      }
      return astNode;
    }
```
このサンプルは、CSTコンテキスト(`ctx`)から左右のオペランドを取り出し、再帰的に`LogicalExpression`ノードを組み立てる方法を示しています。
- SUBRULE は CST 上で配列になるため、Visitor 側では常にインデックス`[0]`でアクセスする規約とする（例: `ctx.callExpression[0]`, `ctx.literal[0]`, `ctx.fieldPath[0]`）。
- fieldPath の QuotedIdentifier は、Dot 以降でのみ `StringLiteral` を許可し、Visitor で `unquoteStringToken` を適用して `segments` に push する。

### **6. エラー回復戦略**

`dsl.md`の第12章に基づき、ユーザーフレンドリーなエラー報告を実現します。

-   **エラー回復の有効化**: パーサーのコンフィグで `recoveryEnabled: true` を設定します。
-   **再同期ポイント**: `RULE`内で `OR` を使う際、再同期が期待される場所（例: `AND`, `OR`, `RParen`, `Comma` の前）を考慮して文法を設計します。これにより、エラー後もパースを継続しやすくなります。
-   **カスタムエラーメッセージ**: Chevrotainが投げる例外（`MismatchedTokenException`など）をキャッチし、より分かりやすいメッセージに変換するラッパーを用意します。
- callArguments は現状 (expression, Comma, expression) 固定（2引数必須）であり、引数不足（例: any(items)）は構文エラー（ParseError）となる。将来的に 1 引数許容（正規化層でのエラー化）へ変更する場合は、callArguments を OPTIONAL 第2引数に緩め、normalize の arity チェックに責務を移す。
***

### **7. 実装ディレクトリ**

この設計に基づき、`src/parser/` ディレクトリ配下に以下のファイルを配置して実装を進めます。

-   `src/parser/tokens.ts`: トークン定義
-   `src/parser/parser.ts`: パーサー本体（ルール定義）
-   `src/parser/visitor.ts`: CSTからASTへ変換するVisitor
-   `src/parser/index.ts`: 上記を統合し、`parse(text: string): AstNode` というインターフェースを公開する

***
