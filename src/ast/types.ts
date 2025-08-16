// src/ast/types.ts
// 定義元: docs/spec/ast-cir.md の「2. AST の型定義」に準拠
// 本ファイルは AST の唯一の正です。変更時は必ず仕様書と同期してください。

export type AstNode =
  | PathNode
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NullLiteralNode
  | LogicalExpression
  | UnaryExpression
  | ComparisonExpression
  | TextShorthandExpression
  | ComparisonShorthand
  | CallExpression
  | GroupExpression
  | ValueListExpression;

export interface BaseNode {
  // 将来的に位置情報を追加する場合はここに統一して拡張する
  // loc?: { start: Position; end: Position };
}

// Path: author.name など
export interface PathNode extends BaseNode {
  type: 'Path';
  segments: string[];
}

// Literals
export type LiteralNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NullLiteralNode;

export interface StringLiteralNode extends BaseNode {
  type: 'StringLiteral';
  value: string;
}
export interface NumberLiteralNode extends BaseNode {
  type: 'NumberLiteral';
  value: number;
}
export interface BooleanLiteralNode extends BaseNode {
  type: 'BooleanLiteral';
  value: boolean;
}
export interface NullLiteralNode extends BaseNode {
  type: 'NullLiteral';
}

// Expressions
export type Expression =
  | LogicalExpression
  | UnaryExpression
  | ComparisonExpression
  | TextShorthandExpression
  | CallExpression
  | GroupExpression
  | ValueListExpression
  | PathNode
  | LiteralNode;

// A AND B, A OR B
export interface LogicalExpression extends BaseNode {
  type: 'LogicalExpression';
  operator: 'AND' | 'OR';
  left: Expression;
  right: Expression;
}

// NOT A
export interface UnaryExpression extends BaseNode {
  type: 'UnaryExpression';
  operator: 'NOT';
  argument: Expression;
}

// path OP literal 例: alcohol_content > 20
// docsでは演算子は文字列リテラルで保持し、CIRで正規化（gt/gte等）します。
export interface ComparisonExpression extends BaseNode {
  type: 'ComparisonExpression';
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
  left: PathNode;
  right: LiteralNode;
}

// path: value / path: (>5, <13) などの省略形
export interface TextShorthandExpression extends BaseNode {
  type: 'TextShorthandExpression';
  path: PathNode;
  value: StringLiteralNode | ComparisonShorthand | ValueListExpression;
}

// 省略比較 > 20 等
export interface ComparisonShorthand extends BaseNode {
  type: 'ComparisonShorthand';
  operator: '>' | '>=' | '<' | '<=';
  value: LiteralNode;
}

// ("A","B") や (>5, <13)
// operator は括弧内で AND/OR を明示した場合に設定（未指定は仕様上のデフォルト解釈に委ねる）
export interface ValueListExpression extends BaseNode {
  type: 'ValueListExpression';
  values: Array<StringLiteralNode | ComparisonShorthand>;
  operator?: 'AND' | 'OR';
}

// contains(), startsWith(), endsWith(), any(), all(), none() など
export interface CallExpression extends BaseNode {
  type: 'CallExpression';
  callee: string;
  arguments: Array<PathNode | Expression>;
}

// (A OR B) など
export interface GroupExpression extends BaseNode {
  type: 'GroupExpression';
  expression: Expression;
}

// 位置情報を導入する場合の参考型（未使用）
// export interface Position {
//   startOffset?: number;
//   endOffset?: number;
//   startLine?: number;
//   endLine?: number;
//   startColumn?: number;
//   endColumn?: number;
// }
