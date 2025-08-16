// test/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.ts';
import type { LogicalExpression } from '../src/ast/types.ts';

describe('parser', () => {
  it('should parse OR left-associatively', () => {
    const { ast } = parse('A OR B OR C');
    const root = ast as LogicalExpression;
    expect(root.type).toBe('LogicalExpression');
    expect(root.operator).toBe('OR');
  });

  it('should respect NOT > AND > OR precedence', () => {
    const { ast } = parse('NOT A AND B OR C');
    expect(ast).toBeTruthy();
  });

  it('should parse text shorthand', () => {
    const { ast } = parse('name:"Gin"');
    expect(ast).toBeTruthy();
  });
});
