// src/adapters/sqlite/index.ts
//
// CIR を SQLite の SQL に変換する汎用アダプタ（v0.3 で全面書き換え）。
//
// ストレージ・モデル: JSON ドキュメント列
//   対象テーブルは JSON テキスト列を持ち、各行が1ドキュメントを表す。
//   パスは json_extract、配列の量化子は json_each + EXISTS で解決する。
//   （旧実装の cocktails/ingredients 固定スキーマのデモは廃止した。）
//
// 安全性: リテラルはすべてパラメータ化し、テーブル名/列名は識別子として検証する。
//
// 評価器との意味の一致（適合テスト test/conformance.test.ts で保証）:
//   - 欠落したパスは json_extract の NULL になり、比較は NULL → 行が落ちる（= 偽）。
//   - NOT と量化子の述語では COALESCE で NULL を偽に寄せ、評価器の真偽意味論に合わせる。
//   - div は実数除算になるよう * 1.0 を挟む（SQLite の整数除算対策）。
//   - ゼロ除算は SQLite でも NULL になり、評価器の「値なし」と一致する。
// 既知の差異（docs/dev/adapters.md に明記）:
//   - 「フィールド欠落」と JSON null を区別できない（どちらも SQL NULL）。
//   - foldDiacritics は未対応（AdapterError）。ignoreCase は lower() で対応。

import type { CirNode, CirExpr, ComparisonNode, TextNode, QuantifiedNode, Path } from '../../cir/types.ts';
import { AdapterError } from '../../errors/errors.ts';

export interface SqliteAdapterOptions {
  /** 対象テーブル名（識別子として検証される） */
  table: string;
  /** JSON ドキュメント列名（既定: 'doc'） */
  column?: string;
  /** SELECT する列（既定: '*'） */
  select?: string;
  /** テキスト比較で大文字小文字を区別しない（評価器の ignoreCase に対応） */
  ignoreCase?: boolean;
  /** アクセント除去（未対応。true を渡すと AdapterError） */
  foldDiacritics?: boolean;
}

export interface SqliteQuery {
  sql: string;
  params: unknown[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Ctx {
  params: unknown[];
  ignoreCase: boolean;
  aliasSeq: number;
}

export function toSqliteQuery(cir: CirNode, options: SqliteAdapterOptions): SqliteQuery {
  if (!IDENTIFIER.test(options.table)) {
    throw new AdapterError(`Invalid table name: ${options.table}`, 'sqlite', 'table', 'E_ADAPTER_GENERIC');
  }
  const column = options.column ?? 'doc';
  if (!IDENTIFIER.test(column)) {
    throw new AdapterError(`Invalid column name: ${column}`, 'sqlite', 'column', 'E_ADAPTER_GENERIC');
  }
  if (options.foldDiacritics) {
    throw new AdapterError(
      'foldDiacritics is not supported by the sqlite adapter',
      'sqlite', 'foldDiacritics', 'E_ADAPTER_UNSUPPORTED_FEATURE'
    );
  }
  const ctx: Ctx = { params: [], ignoreCase: options.ignoreCase ?? false, aliasSeq: 0 };
  const root = `"${column}"`;
  const where = emitNode(cir, root, ctx);
  const select = options.select ?? '*';
  return { sql: `SELECT ${select} FROM "${options.table}" WHERE ${where}`, params: ctx.params };
}

// --- ノードの発行 ---

function emitNode(node: CirNode, root: string, ctx: Ctx): string {
  switch (node.type) {
    case 'And':
      if (node.children.length === 0) return '(1 = 1)';
      return '(' + node.children.map((c) => emitNode(c, root, ctx)).join(' AND ') + ')';
    case 'Or':
      if (node.children.length === 0) return '(1 = 0)';
      return '(' + node.children.map((c) => emitNode(c, root, ctx)).join(' OR ') + ')';
    case 'Not':
      // NULL（欠落フィールドの比較など）を評価器どおり「偽の否定」に寄せる
      return `(NOT COALESCE(${emitNode(node.child, root, ctx)}, 0))`;
    case 'Comparison':
      return emitComparison(node, root, ctx);
    case 'Text':
      return emitText(node, root, ctx);
    case 'Quantified':
      return emitQuantified(node, root, ctx);
    default:
      throw new AdapterError(
        `Unsupported CIR node in sqlite adapter: ${(node as any).type}`,
        'sqlite', (node as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}

const COMPARISON_OPS: Record<ComparisonNode['op'], string> = {
  eq: 'IS', neq: 'IS NOT', gt: '>', gte: '>=', lt: '<', lte: '<=',
};

function emitComparison(node: ComparisonNode, root: string, ctx: Ctx): string {
  // eq/neq は NULL 安全な IS / IS NOT を使う。評価器の規則（欠落と null は
  // 同一の「値なし」、`path != "x"` は欠落時も真）と一致させるため。
  // 順序比較は通常の演算子でよい（NULL が混ざれば結果は NULL → 行が落ちる = 偽）。
  const left = emitExpr(node.left, root, ctx);
  const right = emitExpr(node.right, root, ctx);
  return `(${left} ${COMPARISON_OPS[node.op]} ${right})`;
}

function emitText(node: TextNode, root: string, ctx: Ctx): string {
  // 評価器の規則: 文字列フィールドはそのまま照合し、配列フィールドは
  // 「いずれかの文字列要素が一致」。SQL では2つの分岐を OR でつなぐ。
  // パス式は使用箇所ごとに発行する（プレースホルダとパラメータの出現順を一致させるため）。
  const jsonType = () => {
    ctx.params.push(jsonPathOf(node.path));
    return `json_type(${root}, ?)`;
  };
  const extract = () => emitPath(node.path, root, ctx);
  const needle = () => {
    ctx.params.push(node.value.value);
    return ctx.ignoreCase ? 'lower(?)' : '?';
  };
  const fold = (expr: string) => (ctx.ignoreCase ? `lower(${expr})` : expr);

  // 対象式への照合式を作る。expr はファクトリで受ける:
  // endsWith は対象式を2回使うため、使用箇所ごとに発行しないと
  // プレースホルダとパラメータの数がずれる。
  const matchOn = (expr: () => string): string => {
    if (node.op === 'contains') {
      return `instr(${fold(expr())}, ${needle()}) > 0`;
    }
    if (node.op === 'startsWith') {
      const v = fold(expr());
      const n1 = needle();
      const n2 = needle();
      return `substr(${v}, 1, length(${n1})) = ${n2}`;
    }
    // endsWith
    const v = fold(expr());
    const len = expr();
    const n1 = needle();
    const n2 = needle();
    return `substr(${v}, length(${len}) - length(${n1}) + 1) = ${n2}`;
  };

  // 第1分岐: 文字列フィールドそのもの
  const scalarBranch = `(${jsonType()} = 'text' AND ${matchOn(() => extract())})`;
  // 第2分岐: 配列フィールドの要素（json_each）。要素が文字列のものだけ照合する。
  const alias = `jt${++ctx.aliasSeq}`;
  const arrayBranch =
    `(${jsonType()} = 'array' AND EXISTS (SELECT 1 FROM json_each(${extract()}) AS ${alias} ` +
    `WHERE typeof(${alias}.value) = 'text' AND ${matchOn(() => `${alias}.value`)}))`;
  return `(${scalarBranch} OR ${arrayBranch})`;
}

function emitQuantified(node: QuantifiedNode, root: string, ctx: Ctx): string {
  if (node.quantifier !== 'any' && node.quantifier !== 'all' && node.quantifier !== 'none') {
    throw new AdapterError(
      `Unsupported quantifier in sqlite adapter: ${node.quantifier}`,
      'sqlite', node.quantifier, 'E_ADAPTER_UNSUPPORTED_FEATURE'
    );
  }
  // 配列式は使用箇所ごとに発行する（プレースホルダとパラメータの出現順を一致させるため）
  const newEach = () => {
    const alias = `je${++ctx.aliasSeq}`;
    return { alias, sql: `json_each(${emitPath(node.path, root, ctx)}) AS ${alias}` };
  };
  if (node.quantifier === 'any' || node.quantifier === 'none') {
    const each = newEach();
    const predicate = emitNode(node.predicate, `${each.alias}.value`, ctx);
    const exists = `EXISTS (SELECT 1 FROM ${each.sql} WHERE COALESCE(${predicate}, 0))`;
    return node.quantifier === 'any' ? exists : `NOT ${exists}`;
  }
  // all: 要素が1つ以上あり、かつ述語を満たさない要素が存在しない
  // （評価器の all は空配列では偽。述語が NULL の要素は「満たさない」として数える）
  const eachAny = newEach();
  const eachBad = newEach();
  const predicate = emitNode(node.predicate, `${eachBad.alias}.value`, ctx);
  return `(EXISTS (SELECT 1 FROM ${eachAny.sql}) AND NOT EXISTS (SELECT 1 FROM ${eachBad.sql} WHERE COALESCE(NOT (${predicate}), 1)))`;
}

// --- 式の発行 ---

function emitExpr(expr: CirExpr, root: string, ctx: Ctx): string {
  switch (expr.type) {
    case 'Path':
      return emitPath(expr, root, ctx);
    case 'StringLiteral':
      ctx.params.push(expr.value);
      return '?';
    case 'NumberLiteral':
      ctx.params.push(expr.value);
      return '?';
    case 'BooleanLiteral':
      ctx.params.push(expr.value ? 1 : 0);
      return '?';
    case 'NullLiteral':
      return 'NULL';
    case 'Neg':
      return `(-${emitExpr(expr.arg, root, ctx)})`;
    case 'Arithmetic': {
      const left = emitExpr(expr.left, root, ctx);
      const right = emitExpr(expr.right, root, ctx);
      switch (expr.op) {
        case 'add': return `(${left} + ${right})`;
        case 'sub': return `(${left} - ${right})`;
        case 'mul': return `(${left} * ${right})`;
        // SQLite の / は整数同士で整数除算になるため、実数化して JS の / に合わせる
        case 'div': return `(${left} * 1.0 / ${right})`;
        case 'mod': return `(${left} % ${right})`;
        default:
          throw new AdapterError(
            `Unsupported arithmetic op in sqlite adapter: ${(expr as any).op}`,
            'sqlite', 'arithmetic', 'E_ADAPTER_UNSUPPORTED_FEATURE'
          );
      }
    }
    default:
      throw new AdapterError(
        `Unsupported CIR expr in sqlite adapter: ${(expr as any).type}`,
        'sqlite', (expr as any).type, 'E_ADAPTER_UNSUPPORTED_FEATURE'
      );
  }
}

/**
 * パスを json_extract 式に変換する。
 * - root は現在のドキュメント/要素を表す SQL 式（列名、または json_each の value）。
 * - 予約パス 'value'（要素そのもの）は先頭セグメントを取り除く（評価器の規則と同一）。
 * - パス文字列自体もパラメータ化し、セグメント名経由の注入を防ぐ。
 */
function emitPath(path: Path, root: string, ctx: Ctx): string {
  ctx.params.push(jsonPathOf(path));
  return `json_extract(${root}, ?)`;
}

// Path を SQLite の JSON パス文字列にする（予約パス 'value' は先頭を取り除く）
function jsonPathOf(path: Path): string {
  let segments = path.segments;
  if (segments.length > 0 && segments[0] === 'value') {
    segments = segments.slice(1);
  }
  return segments.length === 0
    ? '$'
    : '$' + segments.map((s) => `."${s.replace(/"/g, '""')}"`).join('');
}
