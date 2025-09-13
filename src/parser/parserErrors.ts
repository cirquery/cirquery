// src/parser/parserErrors.ts
import { ParseError, formatLocation } from '../errors/errors.ts';

// トークン情報の型は実装側の型に合わせて調整
export interface TokenLike {
  image: string;
  startLine?: number;
  startColumn?: number;
}

// 代表ケース: 期待外トークン
export function failUnexpectedToken(token: TokenLike, expected: string): never {
  const loc = formatLocation(token.startLine, token.startColumn);
  const msg = loc
    ? `Unexpected token '${token.image}' at ${loc}. Expected ${expected}.`
    : `Unexpected token '${token.image}'. Expected ${expected}.`;
  throw new ParseError(msg, token.startLine, token.startColumn, token.image, 'E_PARSE_UNEXPECTED_TOKEN');
}

export function failGenericParse(message: string): never {
  throw new ParseError(message, undefined, undefined, undefined, 'E_PARSE_GENERIC');
}
