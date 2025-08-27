// src/cir/evaluator.ts
import type {
    CirNode,
    AndNode,
    OrNode,
    NotNode,
    ComparisonNode,
    TextNode,
    QuantifiedNode,
    Path,
    Literal,
    StringLiteral,
    NumberLiteral,
    BooleanLiteral,
    NullLiteral,
  } from './types.ts';
  
  // EvaluateOptions に foldDiacritics を追加
  export type EvaluateOptions = {
    ignoreCase?: boolean;
    locale?: string;
    // D-5: アクセント除去（diacritics folding）
    // false(既定): 従来通り
    // true: NFD + 結合文字除去でアクセント差を吸収（evalText のみで使用）
    foldDiacritics?: boolean;
  };
  
  type Predicate = (record: any) => boolean;

  // 内部で使う Required 型を明示化（foldDiacritics を含む）
  type InternalOptions = {
    ignoreCase: boolean;
    locale: string | undefined;
    foldDiacritics: boolean;
  };

  export function buildPredicate(cir: CirNode, options: EvaluateOptions = {}): Predicate {
    // デフォルトオプション
    const opts: InternalOptions = {
      ignoreCase: options.ignoreCase ?? false,
      locale: options.locale ?? undefined as any,
      foldDiacritics: options.foldDiacritics ?? false,
    };
  
    return function predicate(record: any): boolean {
      return evalNode(cir, record, opts);
    };
  }
  
// 文字列前処理: foldDiacritics/ignoreCase 両対応（Textノード比較前に適用）
function normalizeTextInput(s: string, opts: InternalOptions): string {
  let out = s;
  // アクセント除去: NFD 分解 → 結合ダイアクリティカルマーク削除
  if (opts.foldDiacritics) {
    // 参考: \u0300-\u036f は結合ダイアクリティカルマークの主要ブロック
    // 必要に応じて他の結合記号拡張は将来検討
    out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  // 大文字小文字の正規化（ロケール依存）
  if (opts.ignoreCase) {
    out = out.toLocaleLowerCase(opts.locale);
  }
  return out;
}

  function evalNode(node: CirNode, record: any, opts: InternalOptions): boolean {
    switch (node.type) {
      case 'And':
        return evalAnd(node as AndNode, record, opts);
      case 'Or':
        return evalOr(node as OrNode, record, opts);
      case 'Not':
        return evalNot(node as NotNode, record, opts);
      case 'Comparison':
        return evalComparison(node as ComparisonNode, record);
      case 'Text':
        return evalText(node as TextNode, record, opts);
      case 'Quantified':
        return evalQuantified(node as QuantifiedNode, record, opts);
      default:
        // 将来ノード追加時の保険
        throw new Error('Unsupported CIR node type in evaluator: ' + (node as any).type);
    }
  }
  
  function evalAnd(node: AndNode, record: any, opts: InternalOptions): boolean {
    for (const child of node.children) {
      if (!evalNode(child as any, record, opts)) return false;
    }
    return true;
  }
  
  function evalOr(node: OrNode, record: any, opts: InternalOptions): boolean {
    for (const child of node.children) {
      if (evalNode(child as any, record, opts)) return true;
    }
    return false;
  }
  
  function evalNot(node: NotNode, record: any, opts: InternalOptions): boolean {
    return !evalNode(node.child as any, record, opts);
  }
  
  function evalComparison(node: ComparisonNode, record: any): boolean {
    const left = getByPath(record, node.path);
    const right = literalToJs(node.value);
  
    switch (node.op) {
      case 'eq':
        return eq(left, right);
      case 'neq':
        return !eq(left, right);
      case 'gt':
        return cmp(left, right, (a, b) => a > b);
      case 'gte':
        return cmp(left, right, (a, b) => a >= b);
      case 'lt':
        return cmp(left, right, (a, b) => a < b);
      case 'lte':
        return cmp(left, right, (a, b) => a <= b);
      default:
        throw new Error('Unknown comparison op: ' + (node as any).op);
    }
  }

  /**
 * Text ノードの評価。
 * - デフォルトは大小区別（ignoreCase=false）。
 * - ignoreCase=true の場合、toLocaleLowerCase(locale) に基づくロケール依存の小文字化で比較する。
 *   多くのロケールでは toLowerCase と同等だが、トルコ語など一部で差異がある。
 * - foldDiacritics=true の場合、NFD + 結合文字除去でアクセント差を吸収する。
 */
  function evalText(node: TextNode, record: any, opts: InternalOptions): boolean {
    const value = getByPath(record, node.path);
    const needle = (node.value as StringLiteral).value;
      if (typeof value !== 'string') return false;
  
    // 共通前処理（foldDiacritics/ignoreCase を順に適用）
    const a = normalizeTextInput(value, opts);
    const b = normalizeTextInput(needle, opts);

    if (node.op === 'contains') return a.includes(b);
    if (node.op === 'startsWith') return a.startsWith(b);
    if (node.op === 'endsWith') return a.endsWith(b);
    throw new Error('Unknown text op: ' + (node as any).op);
  }
  
  function evalQuantified(node: QuantifiedNode, record: any, opts:InternalOptions): boolean {
    // path は配列/単一いずれも許容し、単一は「1要素配列」とみなす
    const coll = getByPath(record, node.path);
    const arr: any[] = Array.isArray(coll) ? coll : (coll == null ? [] : [coll]);
    const pred = (elem: any) => evalNode(node.predicate as any, elem, opts);
  
    if (node.quantifier === 'any') return arr.some(pred);
    if (node.quantifier === 'all') return arr.length > 0 && arr.every(pred);
    if (node.quantifier === 'none') return !arr.some(pred);
  
    throw new Error('Unknown quantifier: ' + (node as any).quantifier);
  }
  
  function getByPath(obj: any, path: Path): any {
    let cur: any = obj;
    for (const seg of path.segments) {
      if (cur == null) return undefined;
      cur = cur[seg as any];
    }
    return cur;
  }
  
  function literalToJs(lit: Literal): any {
    switch (lit.type) {
      case 'StringLiteral': return (lit as StringLiteral).value;
      case 'NumberLiteral': return (lit as NumberLiteral).value;
      case 'BooleanLiteral': return (lit as BooleanLiteral).value;
      case 'NullLiteral': return null;
      default:
        throw new Error('Unknown literal type: ' + (lit as any).type);
    }
  }
  
  // 比較ヘルパ
  function eq(a: any, b: any): boolean {
    // null 同士は等価、型違いは厳密比較準拠
    if (a === null && b === null) return true;
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return a === b;
  }
  
  function cmp(a: any, b: any, f: (x: number|string, y: number|string) => boolean): boolean {
    if ((typeof a === 'number' && typeof b === 'number') ||
        (typeof a === 'string' && typeof b === 'string')) {
      return f(a as any, b as any);
    }
    return false;
  }
  