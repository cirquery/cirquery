// src/parser/visitor.ts
// 目的: ChevrotainのCSTをASTへ変換するVisitor実装
// 参照:
// - docs/design/parser.md #5. CSTからASTへの変換戦略（Visitor実装）
// - docs/spec/ast-cir.md （AST定義の唯一の正）
// 命名規約: メソッド名はCSTルール名に一致。変数は astXxx / cstXxx を使用。

import type {
    Expression as AstExpression,
    LogicalExpression as AstLogicalExpression,
    UnaryExpression as AstUnaryExpression,
    ComparisonExpression as AstComparisonExpression,
    TextShorthandExpression as AstTextShorthandExpression,
    ComparisonShorthand as AstComparisonShorthand,
    ValueListExpression as AstValueListExpression,
    CallExpression as AstCallExpression,
    PathNode as AstPathNode,
    LiteralNode as AstLiteralNode,
    StringLiteralNode as AstStringLiteralNode,
    NumberLiteralNode as AstNumberLiteralNode,
    BooleanLiteralNode as AstBooleanLiteralNode,
    NullLiteralNode as AstNullLiteralNode,
  } from '../ast/types.ts';
  
  import type { IToken } from 'chevrotain';
  import { DslParser } from './parser.ts';
  
  const BaseCstVisitor = new DslParser().getBaseCstVisitorConstructor();
  
  export class AstBuilderVisitor extends BaseCstVisitor {
    constructor() {
      super();
      this.validateVisitor();
    }
  
    // expression -> orExpression
    expression(ctx: any): AstExpression {
      return this.visit(ctx.orExpression);
    }
  
    // orExpression: andExpression (Or andExpression)*
    orExpression(ctx: any): AstExpression {
      let astNode: AstExpression = this.visit(ctx.lhs);
      if (ctx.Or) {
        ctx.rhs.forEach((cstRight: any) => {
          const right = this.visit(cstRight) as AstExpression;
          astNode = {
            type: 'LogicalExpression',
            operator: 'OR',
            left: astNode,
            right,
          } as AstLogicalExpression;
        });
      }
      return astNode;
    }
  
    // andExpression: notExpression (And notExpression)*
    andExpression(ctx: any): AstExpression {
      let astNode: AstExpression = this.visit(ctx.lhs);
      if (ctx.And) {
        ctx.rhs.forEach((cstRight: any) => {
          const right = this.visit(cstRight) as AstExpression;
          astNode = {
            type: 'LogicalExpression',
            operator: 'AND',
            left: astNode,
            right,
          } as AstLogicalExpression;
        });
      }
      return astNode;
    }
  
    // notExpression: (Not notExpression) | primaryExpression
    notExpression(ctx: any): AstExpression {
      if (ctx.Not) {
        const argument = this.visit(ctx.argument[0]) as AstExpression;
        return {
          type: 'UnaryExpression',
          operator: 'NOT',
          argument,
        } as AstUnaryExpression;
      }
      return this.visit(ctx.primaryExpression[0]);
    }
  
    // primaryExpression: groupExpression | comparisonExpression | textShorthandExpression | callExpression
    primaryExpression(ctx: any): AstExpression {
      if (ctx.groupExpression) return this.visit(ctx.groupExpression[0]);
      if (ctx.comparisonExpression) return this.visit(ctx.comparisonExpression[0]);
      if (ctx.textShorthandExpression) return this.visit(ctx.textShorthandExpression[0]);
      if (ctx.callExpression) return this.visit(ctx.callExpression[0]);
      if (ctx.fieldPath) return this.visit(ctx.fieldPath[0]);
      if (ctx.literal) return this.visit(ctx.literal[0]);
      throw new Error('Unsupported primaryExpression alternative '+ JSON.stringify(ctx));
    }
  
    // groupExpression: LParen expression RParen
    groupExpression(ctx: any): AstExpression {
      // ASTでは括弧は意味を持たないため、中のexpressionをそのまま返す
      return this.visit(ctx.expression[0]);
    }
  
    // comparisonExpression: fieldPath (op) literal
    comparisonExpression(ctx: any): AstComparisonExpression {
      const left = this.visit(ctx.fieldPath[0]) as AstPathNode;
      const opToken: IToken = (ctx.Equals ||
        ctx.NotEquals ||
        ctx.GreaterThanOrEqual ||
        ctx.LessThanOrEqual ||
        ctx.GreaterThan ||
        ctx.LessThan)[0];
  
      const right = this.visit(ctx.literal[0]) as AstLiteralNode;
  
      return {
        type: 'ComparisonExpression',
        operator: opToken.image as AstComparisonExpression['operator'],
        left,
        right,
      };
    }
  
    // textShorthandExpression: fieldPath Colon (literal | valueList | comparisonShorthand)
    textShorthandExpression(ctx: any): AstTextShorthandExpression {
      const path = this.visit(ctx.fieldPath[0]) as AstPathNode;
  
      let value: AstTextShorthandExpression['value'];
      if (ctx.literal) {
        value = this.visit(ctx.literal[0]) as AstStringLiteralNode;
      } else if (ctx.valueList) {
        value = this.visit(ctx.valueList) as AstValueListExpression;
      } else if (ctx.comparisonShorthand) {
        value = this.visit(ctx.comparisonShorthand) as AstComparisonShorthand;
      } else {
        throw new Error('textShorthandExpression: missing right-hand value');
      }
  
      return {
        type: 'TextShorthandExpression',
        path,
        value,
      };
    }
  
    // comparisonShorthand: (>, >=, <, <=) literal
    comparisonShorthand(ctx: any): AstComparisonShorthand {
      const opToken: IToken = (ctx.GreaterThanOrEqual ||
        ctx.LessThanOrEqual ||
        ctx.GreaterThan ||
        ctx.LessThan)[0];
  
      const literal = this.visit(ctx.literal) as AstLiteralNode;
  
      return {
        type: 'ComparisonShorthand',
        operator: opToken.image as AstComparisonShorthand['operator'],
        value: literal,
      };
    }
  
    // valueList: LParen ( literal | comparisonShorthand ) (Comma ...)* RParen
    valueList(ctx: any): AstValueListExpression {
      const values: AstValueListExpression['values'] = [];
  
      // AT_LEAST_ONE_SEPにより、最初の項目は ctx.literal または ctx.comparisonShorthand の配列に順次入る
      if (ctx.literal) {
        ctx.literal.forEach((litCst: any) => {
          values.push(this.visit(litCst) as AstStringLiteralNode);
        });
      }
      if (ctx.comparisonShorthand) {
        ctx.comparisonShorthand.forEach((csCst: any) => {
          values.push(this.visit(csCst) as AstComparisonShorthand);
        });
      }
  
      // 括弧内で AND/OR を明示できる拡張を将来サポートする場合に備え、operatorは任意。
      // 現時点の仕様では未定義（undefined）で保持し、Normalizationでデフォルト規則を適用する。
      const node: AstValueListExpression = {
        type: 'ValueListExpression',
        values,
        // operator?: 'AND' | 'OR'
      };
  
      return node;
    }
  
    // callExpression: callee LParen callArguments RParen
    callExpression(ctx: any): AstCallExpression {
      const calleeToken: IToken = (ctx.Contains ||
        ctx.StartsWith ||
        ctx.EndsWith ||
        ctx.Any ||
        ctx.All ||
        ctx.None)[0];
      const callee = calleeToken.image;
  
      const args = this.visit(ctx.callArguments) as AstCallExpression['arguments'];
  
      return {
        type: 'CallExpression',
        callee,
        arguments: args ?? [],
      };
      // Normalization側で callee に応じた引数の妥当性を検証可能
    }
  
    // callArguments: ( path|expression ) (Comma (path|expression))*
    callArguments(ctx: any): Array<AstPathNode | AstExpression> {
      const result: Array<AstPathNode | AstExpression> = [];
      if (!ctx) return result;
  
      // ChevrotainのORで path/expression を受けているため、両方の配列が存在しうる
      const collect = (arr: any[], mapper: (c: any) => any) => {
        if (Array.isArray(arr)) arr.forEach(c => result.push(mapper(c)));
      };
  
      // 最初の引数と後続の引数の両方で path/expression が現れる可能性がある
      collect(ctx.fieldPath || [], (c: any) => this.visit(c) as AstPathNode);
      collect(ctx.expression || [], (c: any) => this.visit(c) as AstExpression);
  
      // 2個目以降でも同様のOR2の分岐で現れる
      collect(ctx.fieldPath2 || [], (c: any) => this.visit(c) as AstPathNode);
      collect(ctx.expression2 || [], (c: any) => this.visit(c) as AstExpression);
  
      return result;
    }
  
    // fieldPath: (Identifier | StringLiteral) (Dot (Identifier | StringLiteral))*
    fieldPath(ctx: any): AstPathNode {
        const segments: string[] = [];
      
        const pushIdentifier = (t: IToken) => segments.push(t.image);
        const pushQuotedAsSegment = (t: IToken) => segments.push(this.unquoteStringToken(t));
      
        // 先頭（ORでIdentifier or StringLiteral）
        if (ctx.Identifier) ctx.Identifier.forEach(pushIdentifier);
        if (ctx.StringLiteral) ctx.StringLiteral.forEach(pushQuotedAsSegment);
      
        // 後続（Manyで OR2 を使っているため 2シリーズの配列に入る）
        if (ctx.Identifier2) ctx.Identifier2.forEach(pushIdentifier);
        if (ctx.StringLiteral2) ctx.StringLiteral2.forEach(pushQuotedAsSegment);
      
        return { type: 'Path', segments };
      }
          
  
    // literal: StringLiteral | NumberLiteral | True | False | Null
    literal(ctx: any): AstLiteralNode {
      if (ctx.StringLiteral) {
        const token = ctx.StringLiteral[0] as IToken;
        const value = this.unquoteStringToken(token);
        return { type: 'StringLiteral', value } as AstStringLiteralNode;
      }
      if (ctx.NumberLiteral) {
        const token = ctx.NumberLiteral[0] as IToken;
        return { type: 'NumberLiteral', value: parseFloat(token.image) } as AstNumberLiteralNode;
      }
      if (ctx.True) {
        return { type: 'BooleanLiteral', value: true } as AstBooleanLiteralNode;
      }
      if (ctx.False) {
        return { type: 'BooleanLiteral', value: false } as AstBooleanLiteralNode;
      }
      if (ctx.Null) {
        return { type: 'NullLiteral' } as AstNullLiteralNode;
      }
      throw new Error('Unknown literal in CST');
    }
  
    // ---- utilities ----
  
    // トークンのimage（"..."）から両端のダブルクオートを外し、エスケープを復元
    // 仕様: dsl-v0.1.1 の範囲（\" \\ \n \t \r \b \f \v \uXXXX）
    private unquoteStringToken(token: IToken): string {
      const raw = token.image;
      const inner = raw.slice(1, -1);
      // バックスラッシュエスケープを復元
      return inner
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\v/g, '\v')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  
  export const astBuilderVisitor = new AstBuilderVisitor();
  