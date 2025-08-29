#!/usr/bin/env node
/**
 * examples runner
 *
 * 目的:
 * - JSONデータ（配列）に対して、DSL → AST → CIR → Evaluator でフィルタし結果を出力する。
 * - クエリは --query または --query-file で指定。出力は --print=cir|ast|result を選択可（デフォルト result）。
 *
 * 使い方:
 *   node scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q2_quantified.txt --print result
 *   echo 'ingredients.alcohol_content > 38' | node scripts/run-example.ts --data examples/data/cocktails.json --print result
 *
 * オプション:
 *   --data <path>         データJSONファイル（配列想定）
 *   --query "<dsl>"       DSL文字列を直接指定
 *   --query-file <path>   DSLを含むテキストファイル
 *   --print cir|ast|result 表示内容（既定: result）
 *   --ignore-case         テキスト評価を大小無視
 *   --locale <bcp47>      テキスト評価のロケール（例: tr, fr）
 *
 * 注意:
 * - 本スクリプトは lowdb を使わず、JSONを直接読み込み Array.filter で評価する。
 * - 正規化済みCIRを Evaluator に渡すことが前提。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse } from '../src/parser/index.ts';
import { normalize } from '../src/cir/normalize.ts';
import { buildPredicate } from '../src/cir/evaluator.ts';

type Args = {
  data?: string;
  query?: string;
  queryFile?: string;
  print?: 'cir' | 'ast' | 'result';
  ignoreCase?: boolean;
  locale?: string;
};

function nextValueOrExit(argv: string[], idxRef: { i: number }, flag: string): string {
    idxRef.i++;
    const v = argv[idxRef.i];
    if (typeof v === 'string' && v.length > 0 && !v.startsWith('--')) return v;
    console.error(`Error: ${flag} requires a value`);
    printHelp();
    process.exit(1);
}

function parseArgs(argv: string[]): Args {
    const args: Args = {};
    const ref = { i: 1 }; // i はこの関数内でのみ進める（呼び出し元のループと混ざらないように）
    while (++ref.i < argv.length) {
      const a = argv[ref.i];
      if (a === '--data') {
        args.data = nextValueOrExit(argv, ref, '--data');
      } else if (a === '--query') {
        args.query = nextValueOrExit(argv, ref, '--query');
      } else if (a === '--query-file') {
        args.queryFile = nextValueOrExit(argv, ref, '--query-file');
      } else if (a === '--print') {
        const v = nextValueOrExit(argv, ref, '--print');
        if (v === 'cir' || v === 'ast' || v === 'result') {
          args.print = v;
        } else {
          console.error(`Error: --print must be one of "cir" | "ast" | "result" (got "${v}")`);
          printHelp();
          process.exit(1);
        }
      } else if (a === '--ignore-case') {
        args.ignoreCase = true;
      } else if (a === '--locale') {
        args.locale = nextValueOrExit(argv, ref, '--locale');
      } else if (a === '--help' || a === '-h') {
        printHelp();
        process.exit(0);
      } else {
        // 未知フラグ
        console.error(`Unknown option: ${a}`);
        printHelp();
        process.exit(1);
      }
    }
    return args;
}
  
function printHelp() {
  console.log(`Usage:
  node scripts/run-example.ts --data examples/data/cocktails.json --query "<dsl>" --print result
  node scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q1_and_or.txt --print cir

Options:
  --data <path>           JSON array file
  --query "<dsl>"         DSL string inline
  --query-file <path>     File containing DSL
  --print cir|ast|result  Output mode (default: result)
  --ignore-case           Case-insensitive text evaluation
  --locale <bcp47>        Locale for text ops (e.g., tr, fr)
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.data) {
    console.error('Error: --data <path> is required');
    printHelp();
    process.exit(1);
  }

  // 入力DSL
  let dsl = args.query;
  if (!dsl && args.queryFile) {
    dsl = await fs.readFile(path.resolve(args.queryFile), 'utf8');
  }
  if (!dsl) {
    // STDINから読む（パイプ入力対応）
    if (process.stdin.isTTY) {
      console.error('Error: --query or --query-file or STDIN is required');
      printHelp();
      process.exit(1);
    }
    dsl = await new Promise<string>((resolve) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { buf += chunk; });
      process.stdin.on('end', () => resolve(buf.trim()));
    });
  }

  // データ読み込み
  const raw = await fs.readFile(path.resolve(args.data), 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    console.error('Error: data file must contain a JSON array (got non-array root).');
    process.exit(1);
  }

  // 解析・正規化
  const { ast } = parse(dsl);
  const cir = normalize(ast);

  // 出力モード
  const mode = args.print ?? 'result';
  if (mode === 'ast') {
    console.log(JSON.stringify(ast, null, 2));
    return;
  }
  if (mode === 'cir') {
    console.log(JSON.stringify(cir, null, 2));
    return;
  }

  // 評価
  const options =
  args.locale !== undefined
    ? { ignoreCase: !!args.ignoreCase, locale: args.locale }
    : { ignoreCase: !!args.ignoreCase };

  const pred = buildPredicate(cir, options);

  const out = (data as any[]).filter(pred);

  // 結果出力
  console.log(JSON.stringify({
    count: out.length,
    ids: out.map((r: any) => r.id).filter((x: any) => x !== undefined),
    sample: out.slice(0, 5),
  }, null, 2));
}

main().catch(err => {
  console.error('run-example error:', err);
  process.exit(1);
});
