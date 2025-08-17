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
      // NOTがない場合はatomicExpressionの結果をそのまま返す
      return this.visit(ctx.atomicExpression);
    }
  
    // ★★★ 新しいルールに対応 ★★★
    atomicExpression(ctx: any): AstExpression {
        // 優先度の高い分岐：グルーピングとコール
        if (ctx.groupExpression) return this.visit(ctx.groupExpression[0]);
        if (ctx.callExpression) return this.visit(ctx.callExpression[0]);

        // パス起点の式（path, path:..., path <op> literal）はここで処理
        if (ctx.pathBasedExpression) return this.visit(ctx.pathBasedExpression[0]);
    
        // 純粋なリテラル（String/Number/true/false/null）はここで直接処理
        // これらはliteralルールを経由せず直接CONSUMEされているため、ここで処理
        if (ctx.StringLiteral) return this.buildLiteralNode(ctx.StringLiteral[0]);
        if (ctx.NumberLiteral) return this.buildLiteralNode(ctx.NumberLiteral[0]);
        // ★★★ 修正点 ★★★
        if (ctx.True) return this.buildLiteralNode(ctx.True[0]);
        if (ctx.False) return this.buildLiteralNode(ctx.False[0]);
        if (ctx.Null) return this.buildLiteralNode(ctx.Null[0]);
    
        throw new Error('Unsupported atomicExpression alternative');
      }
    
    // ★★★ 新しいルールに対応 ★★★
    pathBasedExpression(ctx: any): AstExpression {
        const path = this.visit(ctx.fieldPath[0]) as AstPathNode;
    
        // 1. path > literal (ComparisonExpression)
        if (ctx.comparisonOperator) {
          // ★★★ 最も重要な修正点 ★★★
          // comparisonOperatorのCSTノード配列の「最初の要素」をvisitする
          const operator = this.visit(ctx.comparisonOperator[0]) as AstComparisonExpression['operator'];
          const value = this.visit(ctx.literal[0]) as AstLiteralNode;
          return {
            type: 'ComparisonExpression',
            left: path,
            operator,
            right: value,
          } as AstComparisonExpression;
        }
    
        // 2. path : value (TextShorthandExpression)
        if (ctx.Colon) {
          let value: AstTextShorthandExpression['value'];
          // ★★★ 念のための修正 ★★★
          if (ctx.literal) {
            value = this.visit(ctx.literal[0]) as AstStringLiteralNode;
          } else if (ctx.valueList) {
            value = this.visit(ctx.valueList[0]) as AstValueListExpression;
          } else { // comparisonShorthand
            value = this.visit(ctx.comparisonShorthand[0]) as AstComparisonShorthand;
          }
          return {
            type: 'TextShorthandExpression',
            path,
            value,
          } as AstTextShorthandExpression;
        }
    
        // 3. path のみ (truthy)
        // 何も続かない場合はPathNodeをそのまま返す
        return path;
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
      return this.buildLiteralNode(token);
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
  