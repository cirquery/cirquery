// src/cir/types.ts
// 定義元: docs/spec/ast-cir.md の「3. CIR (Canonical Intermediate Representation) の型定義」に準拠
// 本ファイルは CIR 型の唯一の正です。変更時は必ず仕様書と同期してください。

export type CirNode =
  | AndNode
  | OrNode
  | NotNode
  | ComparisonNode
  | TextNode
  | QuantifiedNode;

// Path は常に segments ベースで表現（ASTと同一構造だが依存しない）
export interface Path {
  type: 'Path'
  segments: string[];
}

// Literal はCIR側で独立定義（ASTへ依存しない）
export type Literal = StringLiteral | NumberLiteral | BooleanLiteral | NullLiteral;

export interface StringLiteral {
  type: 'StringLiteral';
  value: string;
}
export interface NumberLiteral {
  type: 'NumberLiteral';
  value: number;
}
export interface BooleanLiteral {
  type: 'BooleanLiteral';
  value: boolean;
}
export interface NullLiteral {
  type: 'NullLiteral';
}

// and/or は複数子要素を持つ（平坦化を推奨: 正規化の最終段でネストをつぶす）
export interface AndNode {
  type: 'And';
  children: CirNode[];
}
export interface OrNode {
  type: 'Or';
  children: CirNode[];
}

// not は末端条件にのみ現れることが望ましい（正規化で押し下げ）
// child は ComparisonNode | TextNode | QuantifiedNode を想定（実装では型ガードで制約）
export interface NotNode {
  type: 'Not';
  child: CirNode;
  // D-6（比較反転最適化）補足:
  // 既定の正規化では、child が ComparisonNode の場合に NOT(Comparison) を
  // 演算子反転（eq⇔neq, gt⇔lte, gte⇔lt）で除去する最適化を適用する。
  // ただし、以下の理由により最終CIRに NotNode が残る構成も運用上許容する:
  // - 段階導入やデバッグ用途のために最適化フラグを無効化できる（診断モード） 
  // - De Morgan／量化子変換など他規則との適用順序・フェイルセーフ分岐を安全側に保つ
  // - 将来の拡張（Text否定の扱い変更など）で正規化順序や適用範囲が見直され得る
  // よって、「NotNodeはComparisonに対して常に消える」とは仕様上断定しない。
  // 基本方針は“消す（反転する）”だが、運用・保守上の選択肢として残存も許容する。
}

// 比較（=, !=, >, >=, <, <=）は正規化済みの op を使用
export interface ComparisonNode {
  type: 'Comparison';
  path: Path;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: Literal;
  // D-6（比較反転最適化）補足:
  // 正規化で NOT(Comparison) は演算子反転により NotNode を除去してこの ComparisonNode に畳み込まれる。
  // 例: NOT (price > 10) → Comparison(op: 'lte', value: 10)
  //     NOT (category = "A") → Comparison(op: 'neq', value: "A")
}

// テキスト演算（contains, startsWith, endsWith）
// v0.1 では否定形の op は導入しない（否定は NotNode で表現）
export interface TextNode {
  type: 'Text';
  path: Path;
  op: 'contains' | 'startsWith' | 'endsWith';
  value: { type: 'StringLiteral'; value: string };
  // 注: v0.1 の仕様では Text の否定は専用opを導入せず、NotNode(Text) で表現する。
  // D-6の最適化は Comparison のみに適用され、Text には適用されない。
}

// 量化子（配列/複数セグメントパスに対する抽象化）
// quantifier: any | all | none
// path: 量化の対象となる配列フィールド（例: ingredients）
// predicate: 配列の各要素に対して適用される述語条件
export interface QuantifiedNode {
    type: 'Quantified';
    quantifier: 'any' | 'all' | 'none';
    path: Path;
    predicate: CirNode;
}
  

// ユーティリティ型（任意）：末端条件の集合（Not の押し下げや型ガードに利用）
export type LeafCondition = ComparisonNode | TextNode | QuantifiedNode;

// 型ガード（任意の補助。必要になったら利用してください）
export function isAnd(node: CirNode): node is AndNode {
  return node.type === 'And';
}
export function isOr(node: CirNode): node is OrNode {
  return node.type === 'Or';
}
export function isNot(node: CirNode): node is NotNode {
  return node.type === 'Not';
}
export function isComparison(node: CirNode): node is ComparisonNode {
  return node.type === 'Comparison';
}
export function isText(node: CirNode): node is TextNode {
  return node.type === 'Text';
}
export function isQuantified(node: CirNode): node is QuantifiedNode {
  return node.type === 'Quantified';
}
