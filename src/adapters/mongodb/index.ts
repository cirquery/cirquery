// src/adapters/mongodb/index.ts
//
// CIR を MongoDB のフィルタオブジェクトに変換するアダプタ（v0.3）。
//
// 二段構えの写像方針（docs/design/v030-arithmetic-adapters.md D-5）:
//   1. フィルタ形式: 単純な述語は MongoDB のネイティブ演算子で表す。
//      インデックスが効き、クエリプランナの最適化対象になるため優先する。
//      - 比較（パス vs リテラル）→ { 'a.b': { $gt: v } }
//      - テキスト → $regex、量化子 any/none → $elemMatch / $not+$elemMatch
//   2. $expr 形式: フィルタ形式で表せないものは集約式（$expr）に落とす。
//      - 演算を含む比較、パス同士の比較、要素そのもの（予約パス 'value'）への述語
//      - 量化子 all（「空でない＋反例なし」は述語の否定構築が要り、
//        述語側に $expr が混ざると壊れるため $expr に統一する）
//      $expr 内の量化子は $map で各要素に述語式を適用し、
//      $anyElementTrue / $allElementsTrue で畳む。対象パスが配列でない場合は
//      評価器の規則に合わせ、単一値を1要素配列・欠落/null を空配列に正規化する。
//
// 既知の意味差（docs/dev/adapters.md の方針で明記）:
//   - eq の null（{ path: null }）は、MongoDB では「フィールドが欠落した
//     ドキュメント」にも一致する（評価器の eq(undefined, null) とは異なる）。
//     逆に neq の null（{ $ne: null }）は欠落ドキュメントに一致しない。
//   - $expr 内では欠落パスは null として扱われる。欠落を含む演算は null に
//     伝播し（$add 等は null を返す）、評価器の「値なし→比較は偽」に近いが、
//     順序比較で null が数値より小さいものとして比較される点は評価器と異なる。
//   - $elemMatch は対象が配列のときのみ一致する。評価器は単一値も1要素配列と
//     みなすため、スカラなフィールドへの any は $expr 側でのみ等価になる
//     （述語が $expr を要する場合は自動的にそちらへ落ちる）。

import type { CirNode, CirExpr, ComparisonNode, TextNode, QuantifiedNode, Path, Literal } from '../../cir/types.ts';
import { AdapterError } from '../../errors/errors.ts';

export interface MongoAdapterOptions {
  /** テキスト比較で大文字小文字を区別しない（$regex の $options: 'i' に対応） */
  ignoreCase?: boolean;
  /** アクセント除去（未対応。true を渡すと AdapterError） */
  foldDiacritics?: boolean;
}

export type MongoFilter = Record<string, unknown>;

interface Ctx {
  ignoreCase: boolean;
  varSeq: number;
}

export function toMongoFilter(cir: CirNode, options: MongoAdapterOptions = {}): MongoFilter {
  if (options.foldDiacritics) {
    throw new AdapterError(
      'foldDiacritics is not supported by the mongodb adapter',
      'mongodb', 'foldDiacritics', 'E_ADAPTER_UNSUPPORTED_FEATURE'
    );
  }
  const ctx: Ctx = { ignoreCase: options.ignoreCase ?? false, varSeq: 0 };
  // base は $expr 化したときのパス解決の基準（'' = ドキュメント、'$$this' = $elemMatch の要素）
  return emitNode(cir, '', ctx);
}

// --- ノードの発行（フィルタ形式） ---

function emitNode(node: CirNode, base: string, ctx: Ctx): MongoFilter {
  switch (node.type) {
    case 'And':
      if (node.children.length === 0) return {};
      if (node.children.length === 1) return emitNode(node.children[0]!, base, ctx);
      return { $and: node.children.map((c) => emitNode(c, base, ctx)) };
    case 'Or':
      // 空の Or は評価器でも偽。常に偽の式で表す
      if (node.children.length === 0) return { $expr: false };
      if (node.children.length === 1) return emitNode(node.children[0]!, base, ctx);
      return { $or: node.children.map((c) => emitNode(c, base, ctx)) };
    case 'Not':
      return { $nor: [emitNode(node.child, base, ctx)] };
    case 'Comparison':
      return isSimpleComparison(node)
        ? emitSimpleComparison(node)
        : { $expr: emitExprNode(node, base, ctx) };
    case 'Text':
      return relativeSegments(node.path).length > 0
        ? emitTextFilter(node, ctx)
        : { $expr: emitExprNode(node, base, ctx) };
    case 'Quantified':
      return emitQuantified(node, base, ctx);
    default:
      throw new AdapterError(
        `Unsupported CIR node in mongodb adapter: ${(node as any).type}`,
        'mongodb', (node as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}

// フィルタ形式で表せる単純比較か: 片辺がパス（要素そのものでない）、他辺がリテラル
function isSimpleComparison(node: ComparisonNode): boolean {
  const pathSide = node.left.type === 'Path' ? node.left : node.right.type === 'Path' ? node.right : null;
  if (!pathSide) return false;
  const other = pathSide === node.left ? node.right : node.left;
  if (!isLiteral(other)) return false;
  return relativeSegments(pathSide).length > 0;
}

function isLiteral(expr: CirExpr): expr is Literal {
  return expr.type === 'StringLiteral' || expr.type === 'NumberLiteral'
    || expr.type === 'BooleanLiteral' || expr.type === 'NullLiteral';
}

function literalToJs(lit: Literal): unknown {
  return lit.type === 'NullLiteral' ? null : lit.value;
}

const COMPARISON_OPS: Record<ComparisonNode['op'], string> = {
  eq: '$eq', neq: '$ne', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte',
};
// リテラルが左辺にある場合に反転する演算子（eq/neq は対称）
const FLIPPED_OPS: Record<ComparisonNode['op'], ComparisonNode['op']> = {
  eq: 'eq', neq: 'neq', gt: 'lt', gte: 'lte', lt: 'gt', lte: 'gte',
};

function emitSimpleComparison(node: ComparisonNode): MongoFilter {
  const pathOnLeft = node.left.type === 'Path';
  const path = (pathOnLeft ? node.left : node.right) as Path;
  const literal = (pathOnLeft ? node.right : node.left) as Literal;
  const op = pathOnLeft ? node.op : FLIPPED_OPS[node.op];
  const key = relativeSegments(path).join('.');
  const value = literalToJs(literal);

  if (op === 'eq') {
    // null の場合は { path: null } になる（欠落にも一致する既知の差異。冒頭コメント参照）
    return { [key]: value };
  }
  if (literal.type === 'NullLiteral' && op !== 'neq') {
    // null との順序比較は評価器でも偽になるため、常に偽の式を返す
    return { $expr: false };
  }
  return { [key]: { [COMPARISON_OPS[op]]: value } };
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_META, '\\$&');
}

// テキスト条件の $regex パターン（contains は部分一致、startsWith は ^、endsWith は $）
function textPattern(node: TextNode): string {
  const needle = escapeRegex(node.value.value);
  if (node.op === 'startsWith') return `^${needle}`;
  if (node.op === 'endsWith') return `${needle}$`;
  return needle;
}

function emitTextFilter(node: TextNode, ctx: Ctx): MongoFilter {
  const key = relativeSegments(node.path).join('.');
  const condition: Record<string, unknown> = { $regex: textPattern(node) };
  if (ctx.ignoreCase) condition.$options = 'i';
  return { [key]: condition };
}

function emitQuantified(node: QuantifiedNode, base: string, ctx: Ctx): MongoFilter {
  const key = relativeSegments(node.path).join('.');
  // 要素そのものが配列（パスが 'value' のみ）の場合はフィルタ形式のキーにできない
  if (key.length > 0 && node.quantifier !== 'all' && isFilterForm(node.predicate)) {
    // 述語は $elemMatch の中では要素相対になる（base は '$$this' に切り替わる）
    const predicate = emitNode(node.predicate, '$$this', ctx);
    if (node.quantifier === 'any') {
      return { [key]: { $elemMatch: predicate } };
    }
    // none は any の否定
    return { [key]: { $not: { $elemMatch: predicate } } };
  }
  return { $expr: emitQuantifiedExpr(node, base, ctx) };
}

// 述語全体がフィルタ形式で表せるか（量化子の $elemMatch 化の判定）
// all は「空でない＋反例なし」の合成が必要なため常に false（$expr に統一）
function isFilterForm(node: CirNode): boolean {
  switch (node.type) {
    case 'And':
    case 'Or':
      return node.children.every(isFilterForm);
    case 'Not':
      return isFilterForm(node.child);
    case 'Comparison':
      return isSimpleComparison(node);
    case 'Text':
      return relativeSegments(node.path).length > 0;
    case 'Quantified':
      return node.quantifier !== 'all' && isFilterForm(node.predicate);
    default:
      return false;
  }
}

/**
 * パスを現在のスコープ相対のセグメント列に変換する。
 * 予約パス 'value'（要素そのもの）は先頭セグメントを取り除く（sqlite アダプタと同じ規則）。
 * 結果が空配列なら「要素そのもの」を指す。
 */
function relativeSegments(path: Path): string[] {
  const segments = path.segments;
  return segments.length > 0 && segments[0] === 'value' ? segments.slice(1) : segments;
}

// --- ノードの発行（$expr 形式） ---

function emitExprNode(node: CirNode, base: string, ctx: Ctx): unknown {
  switch (node.type) {
    case 'And':
      if (node.children.length === 0) return true;
      return { $and: node.children.map((c) => emitExprNode(c, base, ctx)) };
    case 'Or':
      if (node.children.length === 0) return false;
      return { $or: node.children.map((c) => emitExprNode(c, base, ctx)) };
    case 'Not':
      return { $not: [emitExprNode(node.child, base, ctx)] };
    case 'Comparison':
      return { [COMPARISON_OPS[node.op]]: [emitExpr(node.left, base, ctx), emitExpr(node.right, base, ctx)] };
    case 'Text': {
      const match: Record<string, unknown> = {
        input: emitPathExpr(node.path, base),
        regex: textPattern(node),
      };
      if (ctx.ignoreCase) match.options = 'i';
      return { $regexMatch: match };
    }
    case 'Quantified':
      return emitQuantifiedExpr(node, base, ctx);
    default:
      throw new AdapterError(
        `Unsupported CIR node in mongodb adapter ($expr): ${(node as any).type}`,
        'mongodb', (node as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}

function emitQuantifiedExpr(node: QuantifiedNode, base: string, ctx: Ctx): unknown {
  const array = emitArrayExpr(node.path, base);
  const varName = `elem${++ctx.varSeq}`;
  const mapped = {
    $map: { input: array, as: varName, in: emitExprNode(node.predicate, `$$${varName}`, ctx) },
  };
  if (node.quantifier === 'any') {
    return { $anyElementTrue: [mapped] };
  }
  if (node.quantifier === 'none') {
    return { $not: [{ $anyElementTrue: [mapped] }] };
  }
  // all: 要素が1つ以上あり、かつ述語を満たさない要素が存在しない
  return {
    $and: [
      { $gt: [{ $size: array }, 0] },
      { $allElementsTrue: [mapped] },
    ],
  };
}

/**
 * 量化対象のパスを「配列であることが保証された式」に正規化する。
 * 評価器の規則（単一値は1要素配列、欠落/null は空配列）に合わせる。
 */
function emitArrayExpr(path: Path, base: string): unknown {
  const ref = emitPathExpr(path, base);
  const isMissingOrNull = {
    $or: [
      { $eq: [{ $type: ref }, 'missing'] },
      { $eq: [{ $type: ref }, 'null'] },
    ],
  };
  return {
    $cond: [
      { $isArray: ref },
      ref,
      { $cond: [isMissingOrNull, [], [ref]] },
    ],
  };
}

// --- 式の発行（$expr 内） ---

function emitExpr(expr: CirExpr, base: string, ctx: Ctx): unknown {
  switch (expr.type) {
    case 'Path':
      return emitPathExpr(expr, base);
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
      return expr.value;
    case 'NullLiteral':
      return null;
    case 'Neg':
      return { $multiply: [-1, emitExpr(expr.arg, base, ctx)] };
    case 'Arithmetic': {
      const left = emitExpr(expr.left, base, ctx);
      const right = emitExpr(expr.right, base, ctx);
      switch (expr.op) {
        case 'add': return { $add: [left, right] };
        case 'sub': return { $subtract: [left, right] };
        case 'mul': return { $multiply: [left, right] };
        case 'div': return { $divide: [left, right] };
        case 'mod': return { $mod: [left, right] };
        default:
          throw new AdapterError(
            `Unsupported arithmetic op in mongodb adapter: ${(expr as any).op}`,
            'mongodb', 'arithmetic', 'E_ADAPTER_UNSUPPORTED_FEATURE'
          );
      }
    }
    default:
      throw new AdapterError(
        `Unsupported CIR expr in mongodb adapter: ${(expr as any).type}`,
        'mongodb', (expr as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}

/**
 * パスを $expr の参照に変換する。
 * - base が ''（ドキュメントスコープ）なら '$a.b' 形式。
 * - base が '$$this' / '$$elemN'（要素スコープ）なら、その変数相対。
 * - 予約パス 'value' は先頭を取り除き、空になれば要素そのもの（base 自身）を指す。
 */
function emitPathExpr(path: Path, base: string): string {
  const segments = relativeSegments(path);
  if (base === '') {
    if (segments.length === 0) {
      throw new AdapterError(
        'Cannot reference the document itself in a mongodb $expr',
        'mongodb', 'path', 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
    }
    return `$${segments.join('.')}`;
  }
  return segments.length === 0 ? base : `${base}.${segments.join('.')}`;
}
