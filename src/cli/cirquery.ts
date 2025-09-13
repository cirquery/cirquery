/// <reference types="node" />
/**
 * cirquery CLI
 *
 * 目的:
 * - DSL を受け取って AST / CIR / 評価結果（JSON）を出力する最小CLI。
 * - 入力は --query／--query-file／STDIN のいずれか。データは JSON 配列ファイルを --data で指定。
 *
 * 使い方:
 *   echo 'ingredients.alcohol_content > 38' | cirquery --data examples/cocktails.json --print result
 *   cirquery --data examples/cocktails.json --query-file examples/queries/q3_value_reserved.txt --print cir
 *   cirquery repl   // 対話モード（簡易REPL）
 *
 * オプション:
 *   --data <path>            JSON配列のデータファイル（必須）
 *   --query "<dsl>"          DSL文字列
 *   --query-file <path>      DSLを含むテキストファイル
 *   --print cir|ast|result   出力内容（既定: result）
 *   --ignore-case            テキスト評価の大小無視
 *   --locale <bcp47>         ロケール（例: tr, fr）
 *
 * 備考:
 * - ESM前提。内部で src/parser / src/cir を使用。
 */

import fs from 'fs/promises'; //node:fs/promises
import path from 'path'; //node:path
import process from 'process'; //node:process
import { parse } from '../parser/index.ts';
import { normalize } from '../cir/normalize.ts';
import { buildPredicate } from '../cir/evaluator.ts';

type Args = {
  cmd?: 'run' | 'repl';
  data?: string;
  query?: string;
  queryFile?: string;
  print?: 'cir' | 'ast' | 'result';
  ignoreCase?: boolean;
  locale?: string;
};

function printHelp(): void {
  console.log(`cirquery CLI

Usage:
  echo 'name: "Gin"' | cirquery --data examples/cocktails.json --print result
  cirquery --data examples/cocktails.json --query-file examples/queries/q2_quantified.txt --print cir
  cirquery repl

Options:
  --data <path>            JSON array file (required for run)
  --query "<dsl>"          Inline DSL string
  --query-file <path>      File containing DSL
  --print cir|ast|result   Output mode (default: result)
  --ignore-case            Case-insensitive text ops
  --locale <bcp47>         Locale for text ops (e.g., tr, fr)
`);
}

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
  const ref = { i: 1 };
  // サブコマンド風に "repl" を認識
  if (argv[2] === 'repl') {
    args.cmd = 'repl';
    return args;
  }
  while (++ref.i < argv.length) {
    const a = argv[ref.i];
    if (a === '--data') args.data = nextValueOrExit(argv, ref, '--data');
    else if (a === '--query') args.query = nextValueOrExit(argv, ref, '--query');
    else if (a === '--query-file') args.queryFile = nextValueOrExit(argv, ref, '--query-file');
    else if (a === '--print') {
      const v = nextValueOrExit(argv, ref, '--print');
      if (v === 'cir' || v === 'ast' || v === 'result') args.print = v;
      else {
        console.error(`Error: --print must be one of "cir" | "ast" | "result" (got "${v}")`);
        printHelp();
        process.exit(1);
      }
    } else if (a === '--ignore-case') args.ignoreCase = true;
    else if (a === '--locale') args.locale = nextValueOrExit(argv, ref, '--locale');
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

async function readDsl(args: Args): Promise<string> {
  if (args.query) return args.query;
  if (args.queryFile) return fs.readFile(path.resolve(args.queryFile), 'utf8');
  // STDIN
  if (!process.stdin.isTTY) {
    return await new Promise<string>((resolve) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { buf += chunk; });
      process.stdin.on('end', () => resolve(buf.trim()));
    });
  }
  console.error('Error: --query or --query-file or STDIN is required');
  printHelp();
  process.exit(1);
}

async function runOnce(args: Args): Promise<void> {
  if (!args.data) {
    console.error('Error: --data <path> is required');
    printHelp();
    process.exit(1);
  }
  const dsl = await readDsl(args);
  const raw = await fs.readFile(path.resolve(args.data), 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    console.error('Error: data file must contain a JSON array (got non-array root).');
    process.exit(1);
  }

  const { ast } = parse(dsl);
  const cir = normalize(ast);

  const mode = args.print ?? 'result';
  if (mode === 'ast') {
    console.log(JSON.stringify(ast, null, 2));
    return;
  }
  if (mode === 'cir') {
    console.log(JSON.stringify(cir, null, 2));
    return;
  }

  const options = args.locale !== undefined
    ? { ignoreCase: !!args.ignoreCase, locale: args.locale }
    : { ignoreCase: !!args.ignoreCase };

  const pred = buildPredicate(cir, options);
  const out = (data as any[]).filter(pred);

  console.log(JSON.stringify({
    count: out.length,
    ids: out.map((r: any) => r.id).filter((x: any) => x !== undefined),
    sample: out.slice(0, 5),
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.cmd === 'repl') {
    const { startRepl } = await import('../cli/repl.ts');
    await startRepl();
    return;
  }
  await runOnce(args);
}

main().catch(err => {
  console.error('cirquery error:', err);
  process.exit(1);
});
