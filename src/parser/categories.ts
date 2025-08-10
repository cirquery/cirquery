// src/parser/categories.ts
import { createToken } from 'chevrotain';

// すべてのトークンの基底カテゴリ。
// Chevrotainのカテゴリはフィルタリング用途であり、実行時に直接消費されるものではありません。
// ここで Token を導入するのは、意味上の上位分類を設け、将来のカテゴリ追加時の一貫性を保つためです。
export const Token = createToken({ name: 'Token', pattern: /NA/ });

// 予約語/関数名など、Identifier より優先されるべきトークン。
// 注意: 優先順位は tokens.ts の allTokens 配列順で最終決定されます。
// ここでのカテゴリ設定は可読性・検索性のためのメタ情報と捉えてください。
export const Keyword = createToken({ name: 'Keyword', categories: Token });

// 算術/比較/論理/コロン等の演算子をまとめるカテゴリ。
// 個別トークンは tokens.ts で定義します。
export const Operator = createToken({ name: 'Operator', categories: Token });

// 括弧、カンマ、ドット等の区切り文字用カテゴリ。
export const Separator = createToken({ name: 'Separator', categories: Token });

// リテラル値（文字列・数値・真偽・null）カテゴリ。
export const Literal = createToken({ name: 'Literal', categories: Token });

// 識別子（パスのセグメント）カテゴリ。
// QuotedIdentifier もこのカテゴリに属します（Lexer段階では StringLiteral と同パターンを共有するため、Parser文脈で区別）。
export const Identifier = createToken({ name: 'Identifier', categories: Token });
