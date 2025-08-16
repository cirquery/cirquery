// src/parser/index.ts
// 公開API（parse）。DSL文字列→CST→AST の流れを提供。
// 参照: docs/design/parser.md, docs/spec/ast-cir.md

import { Lexer } from 'chevrotain';
import { allTokens } from './tokens.ts';
import { DslParser } from './parser.ts';
import { astBuilderVisitor } from './visitor.ts'; 

// parseの戻り型は実装時に AST型へ差し替え
// import type { Expression as AstExpression } from '../ast/types';

const lexer = new Lexer(allTokens);

export function parse(input: string /*, options?: { ... } */) {
  const lexResult = lexer.tokenize(input);
  const parser = new DslParser();
  parser.input = lexResult.tokens;

  const cst = parser.expression();

  if (parser.errors.length) {
    // ここでChevrotainのエラーをラップして、ParseError(code/location)へ変換する実装を推奨
    const message = parser.errors.map(e => e.message).join('\n');
    const err = new Error(`ParseError: ${message}`);
    throw err;
  }

  // CST→AST（実装時に本実装へ）
  // const ast = astBuilderVisitor.visit(cst) as AstExpression;
  // return { ast, tokens: lexResult.tokens };

  return { cst, tokens: lexResult.tokens };
}
