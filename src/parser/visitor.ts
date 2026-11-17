// src/parser/visitor.ts (修正版)
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
  
  // パーサーのインスタンスからビジターのベースクラスを取得
  const parser = new DslParser();
  const BaseCstVisitor = parser.getBaseCstVisitorConstructor();
  
  export class AstBuilderVisitor extends BaseCstVisitor {
    constructor() {
      super();
      // 実装されたVisitorメソッドがパーサーの全ルールをカバーしているか検証
      this.validateVisitor();
    }
  
    // 各ルールに対応するvisitメソッドを実装
    
    expression(ctx: any): AstExpression {
      return this.visit(ctx.orExpression);
    }
  
    orExpression(ctx: any): AstExpression {
      // 左結合の二項演算子を処理する共通パターン
      let astNode = this.visit(ctx.lhs);
      if (ctx.rhs) {
        ctx.rhs.forEach((rhsNode: any) => {
          const right = this.visit(rhsNode);
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
  
    andExpression(ctx: any): AstExpression {
      let astNode = this.visit(ctx.lhs);
      if (ctx.rhs) {
        ctx.rhs.forEach((rhsNode: any) => {
          const right = this.visit(rhsNode);
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
  
    notExpression(ctx: any): AstExpression {
      if (ctx.argument) {
        return {
          type: 'UnaryExpression',
          operator: 'NOT',
          argument: this.visit(ctx.argument),
        } as AstUnaryExpression;
      }
      // NOTがない場合はcomparisonExpressionの結果をそのまま返す
      return this.visit(ctx.comparisonExpression);
    }

    // 比較式: ショートハンド / 演算式 (比較演算子 演算式)?
    comparisonExpression(ctx: any): AstExpression {
      if (ctx.pathShorthand) return this.visit(ctx.pathShorthand[0]);

      const left = this.visit(ctx.lhs[0]);
      if (ctx.comparisonOperator) {
        const operator = this.visit(ctx.comparisonOperator[0]) as AstComparisonExpression['operator'];
        const right = this.visit(ctx.rhs[0]);
        return {
          type: 'ComparisonExpression',
          left,
          operator,
          right,
        } as AstComparisonExpression;
      }
      // 比較演算子がなければ、演算式（パス/リテラル/関数/演算）の結果をそのまま返す
      return left;
    }

    // path: value の省略形
    pathShorthand(ctx: any): AstExpression {
      const path = this.visit(ctx.fieldPath[0]) as AstPathNode;
      let value: AstTextShorthandExpression['value'];
      if (ctx.literal) {
        value = this.visit(ctx.literal[0]) as AstStringLiteralNode;
      } else if (ctx.valueList) {
        value = this.visit(ctx.valueList[0]) as AstValueListExpression;
      } else {
        value = this.visit(ctx.comparisonShorthand[0]) as AstComparisonShorthand;
      }
      return {
        type: 'TextShorthandExpression',
        path,
        value,
      } as AstTextShorthandExpression;
    }

    // 加減（左結合の二項木へ畳む）
    additiveExpression(ctx: any): AstExpression {
      return this.foldBinary(ctx, [
        ['Plus', '+'],
        ['Minus', '-'],
      ]);
    }

    // 乗除剰余（左結合の二項木へ畳む）
    term(ctx: any): AstExpression {
      return this.foldBinary(ctx, [
        ['Star', '*'],
        ['Slash', '/'],
        ['Percent', '%'],
      ]);
    }

    // 二項演算子の繰り返し（lhs (op rhs)*）を左結合のASTへ変換する共通処理。
    // 演算子トークンと rhs は出現順（startOffset順）に整列して対応付ける。
    private foldBinary(ctx: any, opTokens: Array<[string, string]>): AstExpression {
      let astNode = this.visit(ctx.lhs[0]);
      if (!ctx.rhs) return astNode;

      const ops = opTokens
        .flatMap(([key, symbol]) => (ctx[key] || []).map((t: IToken) => ({ offset: t.startOffset, symbol })))
        .sort((a: any, b: any) => a.offset - b.offset);
      const rhsNodes = [...ctx.rhs].sort(
        (a: any, b: any) => (a.location?.startOffset ?? 0) - (b.location?.startOffset ?? 0)
      );

      rhsNodes.forEach((rhsCst: any, i: number) => {
        const op = ops[i];
        if (!op) throw new Error('foldBinary: operator not found for rhs');
        astNode = {
          type: 'ArithmeticExpression',
          operator: op.symbol,
          left: astNode,
          right: this.visit(rhsCst),
        } as AstExpression;
      });
      return astNode;
    }

    // 因子: 括弧 / 関数 / 単項マイナス / リテラル / パス
    factor(ctx: any): AstExpression {
      if (ctx.groupExpression) return this.visit(ctx.groupExpression[0]);
      if (ctx.callExpression) return this.visit(ctx.callExpression[0]);
      if (ctx.Minus) {
        const inner = this.visit(ctx.negated[0]);
        // 数値リテラルへの単項マイナスは負数リテラルに畳む
        if (inner.type === 'NumberLiteral') {
          return { type: 'NumberLiteral', value: -inner.value } as AstNumberLiteralNode;
        }
        return { type: 'NegateExpression', argument: inner } as AstExpression;
      }
      if (ctx.literal) return this.visit(ctx.literal[0]);
      if (ctx.fieldPath) return this.visit(ctx.fieldPath[0]);
      throw new Error('Unsupported factor alternative');
    }
  
    groupExpression(ctx: any): AstExpression {
      return this.visit(ctx.expression);
    }
    
    // ★★★ 新しいヘルパーメソッドに対応 ★★★
  // このメソッドは、渡されたCSTノード(ctx)の中から演算子トークンを見つけて、
  // そのイメージ（文字列）を返すだけのシンプルな責務にする
  comparisonOperator(ctx: any): AstComparisonExpression['operator'] {
    const opToken = ctx.operator?.[0];

    if (!opToken) {
      // デバッグ用に、見つけられなかったctxの中身を出力すると原因究明に役立つ
      console.error("Operator token not found in comparisonOperator context:", JSON.stringify(ctx, null, 2));
      throw new Error("Operator token not found in comparisonOperator");
    }
    return opToken.image as AstComparisonExpression['operator'];
  }
  
    comparisonShorthand(ctx: any): AstComparisonShorthand {
      const operator = this.visit(ctx.comparisonOperator) as AstComparisonShorthand['operator'];
      const value = this.visit(ctx.literal) as AstLiteralNode;
      return {
        type: 'ComparisonShorthand',
        operator,
        value,
      };
    }
  
    valueList(ctx: any): AstValueListExpression {
      const values: AstValueListExpression['values'] = [];
      (ctx.literal || []).forEach((litCst: any) => {
        values.push(this.visit(litCst) as AstStringLiteralNode);
      });
      (ctx.comparisonShorthand || []).forEach((csCst: any) => {
        values.push(this.visit(csCst) as AstComparisonShorthand);
      });
      return {
        type: 'ValueListExpression',
        values,
      };
    }
  

callExpression(ctx: any): AstCallExpression {
  // 1. 関数名トークンの取得
  const calleeTok: IToken | undefined = ctx.callee?.[0];
  if (!calleeTok) {
    // このエラーは、parserのOR分岐とvisitorのキーが一致していない場合に発生
    throw new Error('callExpression: callee token not found. Check parser labels.');
  }
  const callee = calleeTok.image; // 小文字化はnormalize層で行うため、ここではそのまま渡す

  // 2. 引数CSTノードの取得
  const args: AstExpression[] = [];
  // `parser.ts`の`SUBRULE(this.callArguments, { LABEL: 'args' })`に対応
  const callArgumentsCst = ctx.args?.[0];

  if (callArgumentsCst) {
    // 3. 各引数の抽出
    // `callArguments`ルール内の`SUBRULE(this.expression, { LABEL: 'arg1' })`などに対応
    const children = callArgumentsCst.children;
    if (children.arg1?.[0]) {
      args.push(this.visit(children.arg1[0]));
    }
    if (children.arg2?.[0]) {
      args.push(this.visit(children.arg2[0]));
    }
  }

  return {
    type: 'CallExpression',
    callee,
    arguments: args,
  };
}

      
    

    // テキスト関数用: arg1 (',' arg2)?
    callArgumentsText(ctx: any): AstExpression[] {
      const result: AstExpression[] = [];
      // arg1 は必須
      if (ctx.arg1?.[0]) {
        result.push(this.visit(ctx.arg1[0]));
      } else {
        // パーサ側で必須のはずだが、堅牢性のためチェック
        throw new Error('callArgumentsText: missing arg1');
      }
      // arg2 はオプション
      if (ctx.arg2?.[0]) {
        result.push(this.visit(ctx.arg2[0]));
      }
      return result;
    }

    // 量化子用: arg1 ',' arg2（従来どおり2引数必須）
    callArgumentsQuantifier(ctx: any): AstExpression[] {
      const result: AstExpression[] = [];
      if (ctx.arg1?.[0]) {
        result.push(this.visit(ctx.arg1[0]));
      } else {
        throw new Error('callArgumentsQuantifier: missing arg1');
      }
      if (ctx.arg2?.[0]) {
        result.push(this.visit(ctx.arg2[0]));
      } else {
        throw new Error('callArgumentsQuantifier: missing arg2');
      }
      return result;
    }

  
    fieldPath(ctx: any): AstPathNode {
      const segments: string[] = [];
      const pushIdentifier = (t: IToken) => segments.push(t.image);
      const pushQuoted = (t: IToken) => segments.push(this.unquoteStringToken(t));
  

      const hasHeadId  = (ctx.Identifier || []).length > 0;
      const hasHeadStr = (ctx.StringLiteral || []).length > 0;
      if (hasHeadId && hasHeadStr) {
        // ログのみ（CSTの異常混在があれば開発時に気づける）
        // console.warn('[fieldPath] both Identifier and StringLiteral appeared at head:', {
        //   id: ctx.Identifier?.map(t => t.image),
        //   str: ctx.StringLiteral?.map(t => t.image),
        // });
      }


      // 先頭セグメント:
      // - Identifier を優先（B案 Phase1 の方針：先頭はIdentifier）
      // - ただし現行のCSTでは StringLiteral が来ることもあるため、存在すれば受ける
      (ctx.Identifier || []).forEach(pushIdentifier);
      (ctx.StringLiteral || []).forEach(pushQuoted);
      
      // 2番目以降のセグメントも同様に処理
      (ctx.Identifier2 || []).forEach(pushIdentifier);
      (ctx.StringLiteral2 || []).forEach(pushQuoted);
  
      return { type: 'Path', segments };
    }
  
    literal(ctx: any): AstLiteralNode {
      const token = ctx.StringLiteral?.[0] || ctx.NumberLiteral?.[0] || ctx.True?.[0] || ctx.False?.[0] || ctx.Null?.[0];
      if (!token) throw new Error("Literal token not found");
      const node = this.buildLiteralNode(token);
      // v0.3: Minus トークン + 数値リテラルは負数リテラルとして組み立てる
      if (ctx.Minus && node.type === 'NumberLiteral') {
        return { type: 'NumberLiteral', value: -node.value };
      }
      return node;
    }
  
    // ---- ユーティリティメソッド ----
    
    // トークンからリテラルASTノードを構築するヘルパー
    private buildLiteralNode(token: IToken): AstLiteralNode {
      switch (token.tokenType.name) {
        case 'StringLiteral':
          return { type: 'StringLiteral', value: this.unquoteStringToken(token) };
        case 'NumberLiteral':
          return { type: 'NumberLiteral', value: parseFloat(token.image) };
        case 'True':
          return { type: 'BooleanLiteral', value: true };
        case 'False':
          return { type: 'BooleanLiteral', value: false };
        case 'Null':
          return { type: 'NullLiteral' };
        default:
          throw new Error(`Unknown literal token type: ${token.tokenType.name}`);
      }
    }


    // ---- utilities ----
  
    // トークンのimage（"..."）から両端のダブルクオートを外し、エスケープを復元
    // 仕様: dsl.md の範囲（\" \\ \n \t \r \b \f \v \uXXXX）

    private unquoteStringToken(token: IToken): string {
      const raw = token.image;
      // ... (既存のunquoteロジックはそのまま)
      const inner = raw.slice(1, -1);
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
  
  // ビジターのシングルトンインスタンスをエクスポート
  export const astBuilderVisitor = new AstBuilderVisitor();
  