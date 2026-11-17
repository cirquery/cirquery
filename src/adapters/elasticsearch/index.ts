// src/adapters/elasticsearch/index.ts
//
// CIR を Elasticsearch のクエリ DSL に変換するアダプタ（v0.3）。
//
// 方針（docs/design/v030-arithmetic-adapters.md D-5）:
//   - 関連度（スコア）は扱わない。すべて filter 文脈の bool クエリに落とす。
//     And → bool.filter、Or → should + minimum_should_match: 1 を filter で包む、
//     Not → bool.must_not。
//   - テキストの contains は既定で match_phrase に落とす。これはインデックス側の
//     アナライザ（形態素解析・ステミング等）に一致が依存し、評価器の部分文字列
//     一致とは結果が変わりうる。options.keywordFields に挙げたフィールドは
//     wildcard で部分文字列一致に寄せる（低速だが意味は評価器に近い）。
//   - 量化子は options.nestedPaths に挙げたパスだけ nested クエリで厳密に表す。
//     それ以外は述語のパスに配列パスを前置して平坦化する近似であり、
//     異なる要素の値を組み合わせた誤検出がありうる（例: ある要素の name と
//     別要素の price で条件が成立してしまう）。
//   - 演算を含む比較・パス同士の比較は painless の script クエリに落とす。
//     欠落フィールドで例外にならないよう doc['x'].size() == 0 のガードを入れ、
//     欠落した辺は null として、順序比較では偽になる式にする。
//
// 既知の意味差・制約:
//   - ignoreCase はアナライザ/normalizer 側の設定に依存し、アダプタでは
//     保証できないため AdapterError にする（黙って落とさない）。
//   - endsWith は keyword フィールドの wildcard でしか表せない。
//   - script 内の doc[...] は doc values を参照するため、対象フィールドが
//     doc_values: false の場合は動作しない。

import type { CirNode, CirExpr, ComparisonNode, TextNode, QuantifiedNode, Path, Literal } from '../../cir/types.ts';
import { AdapterError } from '../../errors/errors.ts';

export interface ElasticsearchAdapterOptions {
  /** 大文字小文字を区別しない比較（保証できないため true は AdapterError） */
  ignoreCase?: boolean;
  /** アクセント除去（アナライザ依存のため true は AdapterError） */
  foldDiacritics?: boolean;
  /** keyword 型として扱うフィールド（ドット連結パス）。テキストを wildcard/prefix で表す */
  keywordFields?: string[];
  /** nested 型の配列フィールド（ドット連結パス）。量化子を nested クエリで表す */
  nestedPaths?: string[];
}

export type ElasticsearchQuery = Record<string, unknown>;

interface Ctx {
  keywordFields: ReadonlySet<string>;
  nestedPaths: ReadonlySet<string>;
}

export function toElasticsearchQuery(
  cir: CirNode,
  options: ElasticsearchAdapterOptions = {}
): ElasticsearchQuery {
  if (options.ignoreCase) {
    throw new AdapterError(
      'ignoreCase cannot be guaranteed by the elasticsearch adapter (it depends on the index analyzer/normalizer)',
      'elasticsearch', 'ignoreCase', 'E_ADAPTER_UNSUPPORTED_FEATURE'
    );
  }
  if (options.foldDiacritics) {
    throw new AdapterError(
      'foldDiacritics cannot be guaranteed by the elasticsearch adapter (it depends on the index analyzer)',
      'elasticsearch', 'foldDiacritics', 'E_ADAPTER_UNSUPPORTED_FEATURE'
    );
  }
  const ctx: Ctx = {
    keywordFields: new Set(options.keywordFields ?? []),
    nestedPaths: new Set(options.nestedPaths ?? []),
  };
  // prefix は量化子で前置されたパスセグメント列（述語のパスの解決基準）
  return emitNode(cir, [], ctx);
}

// --- ノードの発行 ---

function emitNode(node: CirNode, prefix: string[], ctx: Ctx): ElasticsearchQuery {
  switch (node.type) {
    case 'And':
      if (node.children.length === 0) return { match_all: {} };
      if (node.children.length === 1) return emitNode(node.children[0]!, prefix, ctx);
      return { bool: { filter: node.children.map((c) => emitNode(c, prefix, ctx)) } };
    case 'Or':
      if (node.children.length === 0) return { match_none: {} };
      if (node.children.length === 1) return emitNode(node.children[0]!, prefix, ctx);
      return {
        bool: {
          filter: [
            {
              bool: {
                should: node.children.map((c) => emitNode(c, prefix, ctx)),
                minimum_should_match: 1,
              },
            },
          ],
        },
      };
    case 'Not':
      return { bool: { must_not: [emitNode(node.child, prefix, ctx)] } };
    case 'Comparison':
      return emitComparison(node, prefix, ctx);
    case 'Text':
      return emitText(node, prefix, ctx);
    case 'Quantified':
      return emitQuantified(node, prefix, ctx);
    default:
      throw new AdapterError(
        `Unsupported CIR node in elasticsearch adapter: ${(node as any).type}`,
        'elasticsearch', (node as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}

// --- 比較 ---

const RANGE_OPS: Partial<Record<ComparisonNode['op'], string>> = {
  gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte',
};
// リテラルが左辺にある場合に反転する演算子（eq/neq は対称）
const FLIPPED_OPS: Record<ComparisonNode['op'], ComparisonNode['op']> = {
  eq: 'eq', neq: 'neq', gt: 'lt', gte: 'lte', lt: 'gt', lte: 'gte',
};

function isLiteral(expr: CirExpr): expr is Literal {
  return expr.type === 'StringLiteral' || expr.type === 'NumberLiteral'
    || expr.type === 'BooleanLiteral' || expr.type === 'NullLiteral';
}

function literalToJs(lit: Literal): unknown {
  return lit.type === 'NullLiteral' ? null : lit.value;
}

function emitComparison(node: ComparisonNode, prefix: string[], ctx: Ctx): ElasticsearchQuery {
  const pathSide = node.left.type === 'Path' ? node.left : node.right.type === 'Path' ? node.right : null;
  const other = pathSide === node.left ? node.right : node.left;
  if (pathSide && isLiteral(other)) {
    const op = pathSide === node.left ? node.op : FLIPPED_OPS[node.op];
    return emitSimpleComparison(op, fullPath(pathSide, prefix), other);
  }
  // 演算を含む比較・パス同士の比較は painless script に落とす
  return {
    script: {
      script: { lang: 'painless', source: emitComparisonScript(node, prefix) },
    },
  };
}

function emitSimpleComparison(
  op: ComparisonNode['op'],
  field: string,
  literal: Literal
): ElasticsearchQuery {
  if (literal.type === 'NullLiteral') {
    // null の eq/neq はフィールドの有無で表す。順序比較は評価器でも偽
    if (op === 'eq') return { bool: { must_not: [{ exists: { field } }] } };
    if (op === 'neq') return { exists: { field } };
    return { match_none: {} };
  }
  const value = literalToJs(literal);
  if (op === 'eq') {
    return { term: { [field]: { value } } };
  }
  if (op === 'neq') {
    return { bool: { must_not: [{ term: { [field]: { value } } }] } };
  }
  return { range: { [field]: { [RANGE_OPS[op]!]: value } } };
}

// --- テキスト ---

function escapeWildcard(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/\?/g, '\\?');
}

function emitText(node: TextNode, prefix: string[], ctx: Ctx): ElasticsearchQuery {
  const field = fullPath(node.path, prefix);
  const needle = node.value.value;
  const isKeyword = ctx.keywordFields.has(field);

  if (node.op === 'contains') {
    if (isKeyword) {
      return { wildcard: { [field]: { value: `*${escapeWildcard(needle)}*` } } };
    }
    // アナライザ依存（冒頭コメント参照）。フレーズとして含むかを近似する
    return { match_phrase: { [field]: { query: needle } } };
  }
  if (node.op === 'startsWith') {
    if (isKeyword) {
      return { wildcard: { [field]: { value: `${escapeWildcard(needle)}*` } } };
    }
    return { prefix: { [field]: { value: needle } } };
  }
  // endsWith は keyword フィールドの wildcard でしか表せない
  if (!isKeyword) {
    throw new AdapterError(
      `endsWith requires field '${field}' to be listed in keywordFields`,
      'elasticsearch', 'endsWith', 'E_ADAPTER_UNSUPPORTED_FEATURE'
    );
  }
  return { wildcard: { [field]: { value: `*${escapeWildcard(needle)}` } } };
}

// --- 量化子 ---

function emitQuantified(node: QuantifiedNode, prefix: string[], ctx: Ctx): ElasticsearchQuery {
  const segments = [...prefix, ...relativeSegments(node.path)];
  const arrayField = segments.join('.');
  const isNested = ctx.nestedPaths.has(arrayField);

  if (node.quantifier === 'any') {
    const query = emitNode(node.predicate, segments, ctx);
    return isNested ? { nested: { path: arrayField, query } } : query;
  }
  if (node.quantifier === 'none') {
    // any の否定。平坦化した場合は「述語を満たす要素が1つでもあれば除外」になる近似
    const query = emitNode(node.predicate, segments, ctx);
    const positive = isNested ? { nested: { path: arrayField, query } } : query;
    return { bool: { must_not: [positive] } };
  }
  // all
  if (!isNested) {
    // 平坦化では「全要素が満たす」を表せない。述語の平坦化そのものを返す近似
    // （空配列でも一致しうる、要素またぎの誤検出がありうる）
    return emitNode(node.predicate, segments, ctx);
  }
  // nested の all: 要素が存在し、かつ述語を満たさない要素が存在しない
  const counterexample: CirNode = { type: 'Not', child: node.predicate };
  return {
    bool: {
      filter: [
        { exists: { field: arrayField } },
        {
          bool: {
            must_not: [
              { nested: { path: arrayField, query: emitNode(counterexample, segments, ctx) } },
            ],
          },
        },
      ],
    },
  };
}

// --- パス解決 ---

/**
 * パスを現在のスコープ（量化子で前置された prefix）に対するフルパスに解決し、
 * ドット連結文字列にする。予約パス 'value' は先頭を取り除く（他アダプタと同じ規則）で、
 * 空になれば prefix 自体（＝要素そのもの）を指す。
 */
function fullPath(path: Path, prefix: string[]): string {
  return [...prefix, ...relativeSegments(path)].join('.');
}

function relativeSegments(path: Path): string[] {
  const segments = path.segments;
  return segments.length > 0 && segments[0] === 'value' ? segments.slice(1) : segments;
}

// --- painless script の発行 ---

const SCRIPT_OPS: Record<ComparisonNode['op'], string> = {
  eq: '==', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

function emitComparisonScript(node: ComparisonNode, prefix: string[]): string {
  const left = emitScriptExpr(node.left, prefix);
  const right = emitScriptExpr(node.right, prefix);
  const op = SCRIPT_OPS[node.op];
  if (node.op === 'eq' || node.op === 'neq') {
    return `${left} ${op} ${right}`;
  }
  // 順序比較: パスを含む辺は欠落すると null になり、そのまま比較すると例外に
  // なるため、null チェックを前置して偽に寄せる（リテラルだけの辺は対象外）
  const guards: string[] = [];
  if (exprMayBeNull(node.left)) guards.push(`${left} != null`);
  if (exprMayBeNull(node.right)) guards.push(`${right} != null`);
  return [...guards, `${left} ${op} ${right}`].join(' && ');
}

// 式がパスを含むか（＝欠落により null になりうるか）
function exprMayBeNull(expr: CirExpr): boolean {
  switch (expr.type) {
    case 'Path':
      return true;
    case 'Neg':
      return exprMayBeNull(expr.arg);
    case 'Arithmetic':
      return exprMayBeNull(expr.left) || exprMayBeNull(expr.right);
    default:
      return false;
  }
}

function emitScriptExpr(expr: CirExpr, prefix: string[]): string {
  switch (expr.type) {
    case 'Path': {
      const field = fullPath(expr, prefix).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      // 欠落フィールドで例外にならないよう size() ガードを入れ、欠落は null とする
      return `(doc['${field}'].size() == 0 ? null : doc['${field}'].value)`;
    }
    case 'NumberLiteral':
      return String(expr.value);
    case 'StringLiteral':
      return `'${expr.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    case 'BooleanLiteral':
      return expr.value ? 'true' : 'false';
    case 'NullLiteral':
      return 'null';
    case 'Neg':
      return `(-${emitScriptExpr(expr.arg, prefix)})`;
    case 'Arithmetic': {
      const left = emitScriptExpr(expr.left, prefix);
      const right = emitScriptExpr(expr.right, prefix);
      switch (expr.op) {
        case 'add': return `(${left} + ${right})`;
        case 'sub': return `(${left} - ${right})`;
        case 'mul': return `(${left} * ${right})`;
        // painless は整数同士で整数除算になるため、1.0 を掛けて実数除算にする
        case 'div': return `(${left} * 1.0 / ${right})`;
        case 'mod': return `(${left} % ${right})`;
        default:
          throw new AdapterError(
            `Unsupported arithmetic op in elasticsearch adapter: ${(expr as any).op}`,
            'elasticsearch', 'arithmetic', 'E_ADAPTER_UNSUPPORTED_FEATURE'
          );
      }
    }
    default:
      throw new AdapterError(
        `Unsupported CIR expr in elasticsearch adapter: ${(expr as any).type}`,
        'elasticsearch', (expr as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}
