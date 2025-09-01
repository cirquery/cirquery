# Lexer/Parser 実装・最適化ガイド

この文書は、cirquery における Chevrotain ベースのトークナイズ（Lexer）と構文解析（Parser）の実装規約・最適化方針をまとめたものです。参加フローやセットアップは CONTRIBUTING.md を参照してください。

- 目標
  - 実装の一貫性を保ち、読みやすく保守可能なコードにする
  - トークナイズと構文解析のボトルネックを避け、安定した性能を確保する

- 前提
  - Node.js 22+
  - Chevrotain（Lexer/Parser）

---

## 用語の使い分け

- Lexer（レクサ）: 入力文字列をトークン列へ変換する段階（トークナイズ）
- Token（トークン）: 予約語、記号、識別子、数値、文字列などの最小単位
- Parser（パーサ）: トークン列から構文規則に従って構文木（AST/CST）を構築する段階
- AST（抽象構文木）: 評価・正規化に必要な最小限の情報を保持する木構造（本プロジェクトで主に扱うのはAST）
- CST（具体構文木）: 構文上の全ての情報を保持する木構造（ChevrotainのVisitor経由でASTへ変換する場合に触れることがある）

---

## Lexer（トークナイズ）の指針

1) 最適化を強制して早期検知する
- 目的: 先頭文字ヒントが不足して最適化が無効化される事態をビルド/テストで検知する
- 実装例:
```
import { Lexer } from 'chevrotain';
export const lexer = new Lexer(tokenTypes, { ensureOptimizations: true });
```
- 解説: Chevrotainは「次に消費する文字コード」で候補トークンを絞る最適化を持つ。無効化されると静かにフォールバックするため、ensureOptimizationsで失敗させて原因を特定する。

2) start_chars_hint を適切に付与する
- 狙い: 先頭文字のヒントで候補トークン集合を絞り、トークナイズを高速化する
- 指針:
  - 記号トークンには積極付与（例: > >= < <= = != : ( ) , .）
  - 英字キーワード（AND/OR/NOT 等）は効果が限定的なため任意（保守性優先）
  - カスタムパターン（RegExpや関数）を使うトークンは明示付与を検討
- 例:
```
const GreaterThan  = createToken({ name: 'GreaterThan',  pattern: />/,  start_chars_hint: ['>'] });
const NotEquals    = createToken({ name: 'NotEquals',    pattern: /!=/, start_chars_hint: ['!'] });
const Colon        = createToken({ name: 'Colon',        pattern: /:/,  start_chars_hint: [':'] });
const LParen       = createToken({ name: 'LParen',       pattern: /$$/, start_chars_hint: ['('] });
```
- 参考: Chevrotain Runtime Performance ガイド（start_chars_hint、ensureOptimizations）、Lexerエラーの解決指針

3) 行終端の取り扱いを明示する
- 複数行に渡る可能性があるトークン（複数行文字列/コメントなど）には line_breaks を設定する
- 例:
```
const MultiLineString = createToken({
  name: 'MultiLineString',
  pattern: /`[^`]*`/,
  line_breaks: true,
});
```
- 必要に応じて lineTerminatorsPattern 等の設定も検討する（位置追跡の整合のため）

4) よくある落とし穴
- 正規表現の補集合（[^...]+）は最適化しづらい。可能なら等価な明示列挙へ置換を検討（可読性とトレードオフ）
- 最適化エラーが出る場合は start_chars_hint 追加やパターン見直しで解消する。

---

## Parser（構文解析）の指針

1) シングルトン Parser を再利用する
- 目的: 初期化コストの繰り返しを避け、JITのホット化を促す
- 実装例:
```
// 1つのインスタンスを使い回し、入力ごとに parser.input を差し替える
const parser = new MyParser([]);

export function parseTokens(tokens: IToken[]) {
  parser.input = tokens;          // これでパーサ状態がリセットされる
  const result = parser.entry();  // エントリールールから構文解析
  return { result, errors: parser.errors };
}
```
- 備考: 追加の内部状態を持つ場合は reset() をオーバーライドして明示的に初期化する。

2) 大規模な OR 代替配列のみキャッシュする
- 目的: 呼び出しごとの配列生成を避ける（代替が多い箇所に限定）
- 例（イディオム）:
```
$.RULE('value', () => {
  $.OR($.alts || ($.alts = [
    { ALT: () => $.CONSUME(StringLiteral) },
    { ALT: () => $.CONSUME(NumberLiteral) },
    { ALT: () => $.SUBRULE($.object) },
    { ALT: () => $.SUBRULE($.array) },
  ]));
});
```
- 小規模箇所は可読性を優先し、キャッシュしない。

3) 単一ターミナル専用ルールはインライン化
- 目的: ルール呼び出し固定コストを削減
- 指針: 単に1トークンを CONSUME するだけのルールは呼び出し側へ直接記述する。

4) *_SEP DSL は必要時のみ
- 目的: セパレータトークンの配列生成コストを避ける
- 指針: セパレータの配列が不要なら MANY/AT_LEAST_ONE を使用し、*_SEP は避ける。

---

## 実装規約（Lexer/Parser関連の抜粋）

- Token の image（字面）と AST/CIR の operator（意味）を混同しない。両者の対応関係はコメントで明示する（例: Token.And → AST operator 'AND'）。
- Path は `{ segments: string[] }` に統一し、変数名は常に `path` を用いる。
- 命名規約
  - Token: PascalCase（例: And, Or, Identifier）
  - Parserルール: camelCase（例: orExpression）
  - Visitorメソッド: ルール名に一致（例: orExpression(ctx)）

---

## テストと計測の方針

- 構文テスト（parser.test.ts）
  - 演算子優先順位、左結合、値リストのAND/OR、テキスト系ショートハンドの受理/拒否
- 正規化の前提確認（normalize.test.ts）
  - 構文要素の展開や否定の押し下げなど、後工程で前提とする構造が得られているか
- 計測（任意）
  - 大きめの入力で Lexer/Parser のウォームアップ後性能を観測し、start_chars_hint 追加の効果をスポットで確認する。

---

## トラブルシュート

- 「最適化を有効化できない」エラー
  - ensureOptimizations を有効化して原因を特定し、不足トークンへ start_chars_hint を追加する。
- 行終端関連の警告/意図しない位置情報
  - line_breaks の設定や lineTerminatorsPattern の整合を確認する。



## 参考文献
- Chevtotain Official Site: Runtime Performance[Web](https://chevrotain.io/docs/guide/performance.html)
- Chevtotain Official Site: Resolving Lexer Errors [Web](https://chevrotain.io/docs/guide/resolving_lexer_errors.html)
- Introduction to Lexers, Parsers and Interpreters with Chevrotain: [YouTube](https://www.youtube.com/watch?v=l-jMsoAY64k)