// examples/sqlite/run-cirquery.ts
// 使い方:
//   npx tsx examples/sqlite/run-cirquery.ts 'ingredients.name: "gin" AND ingredients.alcohol_content > 38'
// 前提: examples/sqlite/setup.sql と seed.sql を一度流して DB を作成済み。
//      まだなら run.ts を先に実行してください。

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// プロジェクトの公開APIに合わせて import を調整
import { parse } from '../../src/parser/index.ts';
import { normalize } from '../../src/cir/normalize.ts';
import type { CirNode } from '../../src/cir/types.ts';
import { cirToSql } from '../../src/adapters/sqlite/index.ts';

// 簡易引数パーサ（保守のため最小限）
function readQueryFromArgs(argv: string[]): { query: string, source: string } {
  const i = argv.indexOf('--query-file');
  if (i >= 0 && argv[i + 1]) {
    const file = resolve(argv[i + 1]);
    const text = readFileSync(file, 'utf-8');
    return { query: text.trim(), source: `file:${file}` };
  }
  // 位置引数（最初の非オプション）
  const positional = argv.find(a => !a.startsWith('--'));
  if (positional) return { query: positional, source: 'argv' };
  throw new Error('No query provided. Use --query-file <path> or pass a DSL as the first positional argument.');
}
function ensureDb(): Database.Database {
  const db = new Database(resolve('./examples/sqlite/cocktails.db'));
  return db;
}

function prepareDbIfNeeded(db: any) {
  // 任意: 初回実行時にセットアップ・シードを自動適用したい場合は以下を有効化
  // const setup = readFileSync(resolve('./examples/sqlite/setup.sql'), 'utf-8');
  // const seed  = readFileSync(resolve('./examples/sqlite/seed.sql'), 'utf-8');
  // db.exec(setup);
  // db.exec(seed);
}

/* 入力クエリのパース確認用*/
// 1) まずLexerのトークン列を表示（tokens.ts の Lexer を import して使う想定）
import { allTokens } from '../../src/parser/tokens.ts'; // 実際のエクスポートに合わせて修正
import { Lexer } from 'chevrotain';
const lexer = new Lexer(allTokens);
function dumpTokens(input: string) {
  const res = lexer.tokenize(input);
  console.log('LEX ERRORS:', res.errors);
  console.log('TOKENS:');
  for (const t of res.tokens) {
    console.log(`${(t as any).tokenType.name}\t'${t.image}'`);
  }
}



async function main() {
  //const query = process.argv[2] ?? 'ingredients.name: "gin" AND ingredients.alcohol_content > 38';
  const { query, source } = readQueryFromArgs(process.argv.slice(2));
  console.log(`[run-cirquery] using query from ${source}`);
  dumpTokens(query); // テスト：入力クエリのパース確認用

  // 1) DSL → AST
  const { ast } = parse(query);
  // 2) AST → CIR
  const cir: CirNode = normalize(ast);
  console.log(JSON.stringify(cir, null, 2))
  // 3) CIR → SQL
  const { sql, params } = cirToSql(cir);

  console.log('SQL:', sql);
  console.log('Params:', params);

  // 4) 実行
  
  const db = ensureDb();
  prepareDbIfNeeded(db);
  
  const stmt = db.prepare(sql);
  const rows = stmt.all(params);
  console.log('Rows:', rows);
}

main().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(1);
});
