// examples/sqlite/run-cirquery.ts
// 使い方:
//   npx tsx examples/sqlite/run-cirquery.ts 'ingredients.name: "gin" AND ingredients.alcohol_content > 38'
//   npx tsx examples/sqlite/run-cirquery.ts --query-file examples/queries/q2_quantified.txt
//
// v0.3: アダプタは JSON ドキュメント列モデルになったため、DB は実行時に
// examples/data/cocktails.json からメモリ上に構築する（node:sqlite 使用、追加依存なし）。
// 旧来の cocktails/ingredients リレーショナル表（setup.sql / seed.sql / cocktails.db）は
// 旧アダプタのデモ用資産として残してあるが、本スクリプトでは使わない。

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from '../../src/parser/index.ts';
import { normalize } from '../../src/cir/normalize.ts';
import type { CirNode } from '../../src/cir/types.ts';
import { toSqliteQuery } from '../../src/adapters/sqlite/index.ts';

function readQueryFromArgs(argv: string[]): { query: string; source: string } {
  const i = argv.indexOf('--query-file');
  if (i >= 0 && argv[i + 1]) {
    const file = resolve(argv[i + 1]);
    const text = readFileSync(file, 'utf-8');
    return { query: text.trim(), source: `file:${file}` };
  }
  const positional = argv.find((a) => !a.startsWith('--'));
  if (positional) return { query: positional, source: 'argv' };
  throw new Error('No query provided. Use --query-file <path> or pass a DSL as the first positional argument.');
}

function buildDb(): DatabaseSync {
  const data = JSON.parse(readFileSync(resolve('./examples/data/cocktails.json'), 'utf-8'));
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE docs (id INTEGER PRIMARY KEY, doc TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO docs (id, doc) VALUES (?, ?)');
  for (const doc of data) {
    insert.run(doc.id, JSON.stringify(doc));
  }
  return db;
}

function main() {
  const { query, source } = readQueryFromArgs(process.argv.slice(2));
  console.log(`[run-cirquery] using query from ${source}: ${query}`);

  // 1) DSL → AST → CIR
  const { ast } = parse(query);
  const cir: CirNode = normalize(ast);
  console.log('CIR:', JSON.stringify(cir));

  // 2) CIR → SQL（JSON ドキュメント列モデル）
  const { sql, params } = toSqliteQuery(cir, { table: 'docs', select: 'doc' });
  console.log('SQL:', sql);
  console.log('Params:', params);

  // 3) 実行
  const db = buildDb();
  const rows = db.prepare(sql).all(...(params as any[])) as Array<{ doc: string }>;
  const names = rows.map((r) => JSON.parse(r.doc).name);
  console.log(`Rows: ${rows.length}`, names);
}

main();
