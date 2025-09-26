// src/parser/index.ts
// 公開API: DSL文字列をASTへ変換します（CSTは内部実装に隠蔽）。
// 参照: docs/design/parser.md, docs/spec/ast-cir.md（AST定義の唯一の正）

import { Lexer } from 'chevrotain';
import type { IRecognitionException } from 'chevrotain'; // エラーの型を明示的にインポート
import { allTokens } from './tokens.ts';
import { DslParser } from './parser.ts';
import { astBuilderVisitor } from './visitor.ts';
import type { Expression as AstExpression } from '../ast/types.ts';

// 共通エラー型を使用（ローカル定義は撤去）
import { ParseError as CirqueryParseError } from '../errors/errors.ts';
const lexer = new Lexer(allTokens);

export function parse(input: string): { ast: AstExpression; tokens: any[] } {
  // 1) Lexing
  // 1) Lexer エラーの標準化（最小正規化）— ライブラリ内ロギングを廃止し、ParseError に正規化
  const lexResult = lexer.tokenize(input);
  if (lexResult.errors.length > 0) {
    const le = lexResult.errors[0];
    // 修正: le が undefined でないことを保証する
    if (!le) {
      // このパスは理論上到達しないが、型安全のためフォールバック
      throw new CirqueryParseError('Unknown lexing error', undefined, undefined, undefined, 'E_PARSE_GENERIC');
    }
    const firstSentence = (le.message ?? 'Lexing error').split('\n')[0] ?? 'Lexing error';
    const line = le.line;
    const column = le.column;
    // “unexpected character” を Unexpected 系として昇格（それ以外は Generic）
    const isUnexpected = firstSentence.toLowerCase().includes('unexpected character');
    const code = isUnexpected ? 'E_PARSE_UNEXPECTED_TOKEN' : 'E_PARSE_GENERIC';
    throw new CirqueryParseError(firstSentence, line, column, undefined, code);
  }



  // 2) Parsing (CST)
  const parser = new DslParser();
  parser.input = lexResult.tokens;
  const cst = parser.expression();

  if (parser.errors.length > 0) {
    // ★修正点2: エラーハンドリング全体を、より安全で明確な形に修正
    const firstError: IRecognitionException | undefined = parser.errors[0];

    // Chevrotainのエラーメッセージを安全に取得
    const message = firstError?.message ?? 'Parse error';

    // Chevrotainのエラーメッセージが複数行にわたる可能性を考慮し、第一文のみ採用
    const firstSentence = message.split('\n')[0] ?? message;

    // エラー位置の情報を安全に取得
    const token = firstError?.token as any;
    const line = token?.startLine;
    const column = token?.startColumn;
    const snippet = token?.image;
    const isUnexpected = firstSentence.toLowerCase().includes('unexpected token');
    const code = isUnexpected ? 'E_PARSE_UNEXPECTED_TOKEN' : 'E_PARSE_GENERIC';
    // 共通のエラー型でラップしてスロー
    throw new CirqueryParseError(
      firstSentence,
      line,
      column,
      snippet,
      code
    );
  }

  // 3) CST -> AST（Visitor）
  const ast = astBuilderVisitor.visit(cst) as AstExpression;

  // デバッグ・ツール連携を考慮し tokens も返す（将来オプション化可）
  return { ast, tokens: lexResult.tokens };
}
