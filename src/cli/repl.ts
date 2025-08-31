/**
 * cirquery REPL (簡易)
 *
 * 目的:
 * - 1行のDSLを入力し、CIRと該当件数/idsを即時表示する。:q で終了。
 * - データは --data に相当する環境変数 CIRQUERY_DATA から読み込む（JSON配列）。
 *
 * 使い方:
 *   CIRQUERY_DATA=examples/cocktails.json node bin/cirquery repl
 *
 * コマンド:
 *   :q            終了
 *   :mode cir     出力モードを CIR に変更
 *   :mode ast     出力モードを AST に変更
 *   :mode result  出力モードを 結果（デフォルト）に変更
 *   :ignore on|off  テキスト大小無視の切替
 *   :locale <bcp47> ロケール設定（例: tr, fr, 空でクリア）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parse } from '../parser/index.ts';
import { normalize } from '../cir/normalize.ts';
import { buildPredicate } from '../cir/evaluator.ts';

type Mode = 'result' | 'ast' | 'cir';

export async function startRepl(): Promise<void> {
  const dataPath = process.env.CIRQUERY_DATA;
  if (!dataPath) {
    console.error('REPL error: CIRQUERY_DATA environment variable is required (path to JSON array).');
    process.exit(1);
  }
  const raw = await fs.readFile(path.resolve(dataPath), 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    console.error('REPL error: data must be a JSON array root.');
    process.exit(1);
  }

  let mode: Mode = 'result';
  let ignoreCase = false;
  let locale: string | undefined = undefined;

  const rl = readline.createInterface({ input, output, prompt: 'cirquery> ' });
  rl.prompt();

  for await (const line of rl) {
    const text = line.trim();
    if (text === '') { rl.prompt(); continue; }
    if (text === ':q') { break; }

    // 設定コマンド
    if (text.startsWith(':mode ')) {
      const m = text.slice(6).trim();
      if (m === 'result' || m === 'ast' || m === 'cir') {
        mode = m;
        console.log(`mode = ${mode}`);
      } else {
        console.log('usage: :mode result|ast|cir');
      }
      rl.prompt();
      continue;
    }
    if (text.startsWith(':ignore ')) {
      const v = text.slice(8).trim();
      if (v === 'on') ignoreCase = true;
      else if (v === 'off') ignoreCase = false;
      else console.log('usage: :ignore on|off');
      console.log(`ignoreCase = ${ignoreCase}`);
      rl.prompt();
      continue;
    }
    if (text.startsWith(':locale ')) {
      const v = text.slice(8).trim();
      locale = v || undefined;
      console.log(`locale = ${locale ?? '(unset)'}`);
      rl.prompt();
      continue;
    }

    try {
      const { ast } = parse(text);
      const cir = normalize(ast);

      if (mode === 'ast') {
        console.log(JSON.stringify(ast, null, 2));
      } else if (mode === 'cir') {
        console.log(JSON.stringify(cir, null, 2));
      } else {
        const options = locale !== undefined ? { ignoreCase, locale } : { ignoreCase };
        const pred = buildPredicate(cir, options);
        const out = (data as any[]).filter(pred);
        console.log(JSON.stringify({
          count: out.length,
          ids: out.map((r: any) => r.id).filter((x: any) => x !== undefined),
          sample: out.slice(0, 5),
        }, null, 2));
      }
    } catch (err: any) {
      console.error('REPL parse/eval error:', err?.message ?? err);
    }

    rl.prompt();
  }

  rl.close();
}
