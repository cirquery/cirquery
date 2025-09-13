// src/adapters/sqlite/index.ts

// 目的: CIR (Cirquery Intermediate Representation) を SQLite の SQL クエリに変換する、
//       最小限の参照実装を提供します。
//
// ★★★ 重要 ★★★
// このアダプタはデモンストレーション目的であり、'cocktails' と 'ingredients' テーブルから
// 構成される特定のサンプルスキーマに強く結合しています。
// 汎用的で本番利用可能なSQLアダプタではありません。
//
// 主な制約事項:
// - テーブル名 ('ingredients') や結合キー ('cocktail_id') がハードコーディングされている。
// - スキーマ情報を動的に解決する仕組みを持たない。
// - 包括的なセキュリティ対策（SQLインジェクションなど）は施されていない。

import type { CirNode } from '../../cir/types.ts';
import { AdapterError } from '../../errors/errors.ts';

export interface SqliteClient {
  query<T = any>(sql: string, params: any[]): Promise<T[]>;
}

interface Ctx { params: any[]; alias: string; }

export function cirToSql(cir: CirNode): { sql: string; params: any[] } {
  const ctx: Ctx = { params: [], alias: 'c' };
  // デバッグ: 形状確認（必要に応じてコメント解除）
  // console.debug('CIR:', JSON.stringify(cir, null, 2));
  const where = emit(cir, ctx);
  const sql = `SELECT ${ctx.alias}.* FROM cocktails ${ctx.alias} WHERE ${where};`;
  return { sql, params: ctx.params };
}

function emit(node: any, ctx: Ctx): string {
  if (!node) throw new Error('sqlite.emit: node is undefined');
  switch (node.type) {
    case 'And': {
      const xs: any[] = node.children ?? node.operands ?? (node.left && node.right ? [node.left, node.right] : []);
      if (!xs?.length) throw new Error('sqlite.emit: And has no children/operands');
      return '(' + xs.map((n: any) => emit(n, ctx)).join(' AND ') + ')';
    }
    case 'Or': {
      const xs: any[] = node.children ?? node.operands ?? (node.left && node.right ? [node.left, node.right] : []);
      if (!xs?.length) throw new Error('sqlite.emit: Or has no children/operands');
      return '(' + xs.map(n => emit(n, ctx)).join(' OR ') + ')';
    }
    case 'Not': {
      const arg = node.argument ?? node.operand;
      if (!arg) throw new Error('sqlite.emit: Not has no argument/operand');
      return '(NOT ' + emit(arg, ctx) + ')';
    }
    case 'Quantified':
      return emitQuantified(node, ctx);
    case 'Text':
      return emitText(node, ctx);
    case 'Comparison':
      return emitComparison(node, ctx);
    default:
      throw new Error(`sqlite.emit: unsupported node type: ${node.type ?? '(unknown)'}`);
  }
}

function col(pathSegments: string[], ctx: Ctx): string {
  if (!Array.isArray(pathSegments)) throw new Error('sqlite.col: pathSegments is not an array');
  if (pathSegments.length === 1) return `${ctx.alias}.${pathSegments}`;
  // 複合パスは Quantified 側でテーブル別名に切り替えて処理する
  throw new Error(`sqlite.col: nested path outside Quantified: ${pathSegments.join('.')}`);
}

function emitComparison(node: any, ctx: Ctx): string {
  const left = col(node.path?.segments ?? [], ctx);
  const opMap: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  const op = opMap[node.op];
  if (!op) throw new Error(`sqlite.emitComparison: unsupported op ${node.op}`);
  ctx.params.push(literal(node.value));
  return `${left} ${op} ?`;
}

function emitText(node: any, ctx: Ctx): string {
  const left = col(node.path?.segments ?? [], ctx);
  const raw = String(literal(node.value));
  let like = raw;
  if (node.op === 'contains') like = `%${raw}%`;
  if (node.op === 'startsWith') like = `${raw}%`;
  if (node.op === 'endsWith') like = `%${raw}`;
  ctx.params.push(like);
  return `LOWER(${left}) LIKE LOWER(?)`;
}


/**
 * Quantified ノード (any, all, none) のために EXISTS または NOT EXISTS サブクエリを生成します。
 *
 * @notice 【簡易実装の注記】
 * この最小限の参照実装では、クエリが常に 'ingredients' パスを対象とすることを前提とし、
 * テーブル名 ('ingredients') と結合キー ('cocktail_id') がハードコーディングされています。
 *
 * 本番環境向けのアダプタでは、以下のようにスキーマ情報を利用して動的に解決する必要があります。
 * 1. テーブル名の解決: `node.path.segments[0]` (例: 'ingredients') から動的にテーブル名を取得する。
 * 2. 結合キーの解決: 親テーブル (cocktails) と子テーブル (ingredients) の間の
 *    リレーションシップ（例: cocktails.id と ingredients.cocktail_id）をスキーマ情報から解決する。
 */
function emitQuantified(node: any, ctx: Ctx): string {
  const a = { ...ctx, alias: 'i' };
  const inner = emitQuantifiedPredicate(node.predicate, a);
  const joins = `${a.alias}.cocktail_id = ${ctx.alias}.id`;
  if (node.quantifier === 'any') {
    return `EXISTS (SELECT 1 FROM ingredients ${a.alias} WHERE ${joins} AND ${inner})`;
  }
  if (node.quantifier === 'none') {
    return `NOT EXISTS (SELECT 1 FROM ingredients ${a.alias} WHERE ${joins} AND ${inner})`;
  }
  if (node.quantifier === 'all') {
    return `NOT EXISTS (SELECT 1 FROM ingredients ${a.alias} WHERE ${joins} AND NOT (${inner}))`;
  }
  // throw new Error(`sqlite.emitQuantified: unsupported quantifier ${node.quantifier}`);
  throw new AdapterError(
    `Unsupported quantifier in sqlite adapter: ${node.quantifier}`,
    'sqlite', // target
    node.quantifier, // feature
    'E_ADAPTER_UNSUPPORTED_FEATURE'
  );
}

function emitQuantifiedPredicate(node: any, ctx: Ctx): string {
  if (!node) throw new Error('sqlite.emitQuantifiedPredicate: predicate is undefined');
  switch (node.type) {
    case 'Text': return emitText(node, ctx);        // path: ['name']
    case 'Comparison': return emitComparison(node, ctx); // path: ['alcohol_content']
    default: throw new Error(`sqlite.emitQuantifiedPredicate: unsupported node ${node.type}`);
  }
}

function literal(v: any): any {
  if (v?.type === 'StringLiteral') return v.value;
  if (v?.type === 'NumberLiteral') return v.value;
  if (v?.type === 'BooleanLiteral') return v.value;
  if (v?.type === 'NullLiteral') return null;
  return v;
}
