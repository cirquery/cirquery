// examples/js-predicate/run.ts
// 目的: DSLからJS述語を生成し、JSON配列を in-memory でフィルタする。
// 実行: ts-node examples/js-predicate/run.ts 'ingredients.name: "Gin" AND alcohol >= 40'

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// プロジェクト内の公開APIに合わせて import を調整
import { parse } from '../../src/parser/index.ts';
import { normalize } from '../../src/cir/normalize.ts';
import { buildPredicate } from '../../src/cir/evaluator.ts';

function loadJson<T>(p: string): T {
  const abs = resolve(p);
  return JSON.parse(readFileSync(abs, 'utf-8')) as T;
}

async function main() {
  const query = process.argv[2] ?? 'ingredients.name: "Gin"';
  const data = loadJson<any[]>('./examples/data/cocktails.json');

  const ast = parse(query).ast;
  const cir = normalize(ast);
  const pred = buildPredicate(cir, { ignoreCase: true });

  const result = data.filter(pred);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
