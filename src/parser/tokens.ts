// src/parser/tokens.ts
import { createToken, Lexer } from 'chevrotain';
import { Keyword, Operator, Separator, Literal, Identifier as IdentifierCat } from './categories.ts';

// WhiteSpace は Lexer.SKIPPED とし、パーサーに渡さない。
// これによりCSTがクリーンになり、後工程が単純化します。
export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

// ----- Keywords -----
// 注意: 予約語は Identifier より先に allTokens に並べることで、誤って識別子にマッチするのを防ぎます。
// start_chars_hint は任意です（アルファベット全般のため効果は限定的）。付与する場合は先頭文字を指定します。
export const And = createToken({ name: 'And', pattern: /AND/i, categories: Keyword /*, start_chars_hint: ['A','a']*/ });
export const Or = createToken({ name: 'Or', pattern: /OR/i, categories: Keyword /*, start_chars_hint: ['O','o']*/ });
export const Not = createToken({ name: 'Not', pattern: /NOT/i, categories: Keyword /*, start_chars_hint: ['N','n']*/ });

export const True = createToken({ name: 'True', pattern: /true/i, categories: Keyword });
export const False = createToken({ name: 'False', pattern: /false/i, categories: Keyword });
export const Null = createToken({ name: 'Null', pattern: /null/i, categories: Keyword });

// 関数名（将来的に in / matches などを追加する可能性があります）
export const Contains = createToken({ name: 'Contains', pattern: /contains/i, categories: Keyword });
export const StartsWith = createToken({ name: 'StartsWith', pattern: /startsWith/i, categories: Keyword });
export const EndsWith = createToken({ name: 'EndsWith', pattern: /endsWith/i, categories: Keyword });
export const Any = createToken({ name: 'Any', pattern: /any/i, categories: Keyword });
export const All = createToken({ name: 'All', pattern: /all/i, categories: Keyword });
export const None = createToken({ name: 'None', pattern: /none/i, categories: Keyword });

// ----- Operators & Separators -----
// 複合演算子（2文字以上）を単一演算子より先に並べるのが重要。
// start_chars_hint を付けるとパフォーマンス上の助けになります。
export const GreaterThanOrEqual = createToken({
  name: 'GreaterThanOrEqual',
  pattern: />=/,
  categories: Operator,
  start_chars_hint: ['>'],
});
export const LessThanOrEqual = createToken({
  name: 'LessThanOrEqual',
  pattern: /<=/,
  categories: Operator,
  start_chars_hint: ['<'],
});
export const NotEquals = createToken({
  name: 'NotEquals',
  pattern: /!=/,
  categories: Operator,
  start_chars_hint: ['!'],
});

export const GreaterThan = createToken({
  name: 'GreaterThan',
  pattern: />/,
  categories: Operator,
  start_chars_hint: ['>'],
});
export const LessThan = createToken({
  name: 'LessThan',
  pattern: /</,
  categories: Operator,
  start_chars_hint: ['<'],
});
export const Equals = createToken({
  name: 'Equals',
  pattern: /=/,
  categories: Operator,
  start_chars_hint: ['='],
});
export const Colon = createToken({
  name: 'Colon',
  pattern: /:/,
  categories: Operator,
  start_chars_hint: [':'],
});

export const LParen = createToken({
  name: 'LParen',
  pattern: /\(/,
  categories: Separator,
  start_chars_hint: ['('],
});
export const RParen = createToken({
  name: 'RParen',
  pattern: /\)/,
  categories: Separator,
  start_chars_hint: [')'],
});
export const Comma = createToken({
  name: 'Comma',
  pattern: /,/,
  categories: Separator,
  start_chars_hint: [','],
});
export const Dot = createToken({
  name: 'Dot',
  pattern: /\./,
  categories: Separator,
  start_chars_hint: ['.'],
});

// ----- Literals -----
// StringLiteral はエスケープシーケンスを許容。仕様は dsl-v0.1.1 に準拠。
// \uXXXX のみ対応（\u{...} は将来検討）。
export const StringLiteral = createToken({
  name: 'StringLiteral',
  pattern: /"(:?[^\\"]|\\(:?[bfnrtv"\\/]|u[0-9a-fA-F]{4}))*"/,
  categories: Literal,
});

// NumberLiteral は整数/小数/指数をサポート。
export const NumberLiteral = createToken({
  name: 'NumberLiteral',
  pattern: /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  categories: Literal,
});

// ----- Identifiers -----
// 注意: Identifier は予約語より後に並べること。
// 正規表現ポリシー: 現在は末尾ハイフンを許容（/[a-zA-Z_][a-zA-Z0-9_-]*/）。
// 仕様側で末尾ハイフンを禁止する場合は、/[a-zA-Z_][a-zA-Z0-9_]*(-[a-zA-Z0-9_]+)*/ 等へ変更。
export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_][a-zA-Z0-9_-]*/,
  categories: IdentifierCat,
});

// QuotedIdentifier は Lexer レベルでは StringLiteral と同一パターン。
// Parser の文脈（フィールドパスの位置）で識別子として扱います。
export const QuotedIdentifier = createToken({
  name: 'QuotedIdentifier',
  pattern: StringLiteral.PATTERN!,
  categories: IdentifierCat,
});

// ----- Token order (priority) -----
// 重要: Chevrotain は配列順にマッチを試みます。
// 1) WhiteSpace（SKIPPED）
// 2) Keywords（予約語を Identifier より先に）
// 3) Operators: まず2文字以上（>=, <=, !=）、次に1文字
// 4) Separators
// 5) Literals
// 6) Identifiers（最後）
//
// この順序を変更する場合は、docs/design/parser.md の #3.3 を参照し、意図を確認してください。
export const allTokens = [
  WhiteSpace,

  // Keywords
  And, Or, Not, True, False, Null, Contains, StartsWith, EndsWith, Any, All, None,

  // Operators (multi-char first)
  GreaterThanOrEqual, LessThanOrEqual, NotEquals,

  // Operators (single-char)
  GreaterThan, LessThan, Equals, Colon,

  // Separators
  LParen, RParen, Comma, Dot,

  // Literals
  StringLiteral, NumberLiteral,

  // Identifiers
  QuotedIdentifier, Identifier,
];

// 将来の拡張（TODO）
// - 予約語: in, matches, regex 等を追加する場合は Keyword セクションに追記。
// - 文字列ワイルドカード（例: ドライ*）は Parser/Normalizer 側での糖衣扱いを検討。
// - ロケール依存比較や ignoreCase は Lexer ではなく評価系/実行オプションで扱う。
