// src/parser/parser.ts
// 目的: tokens.ts のトークンを用いてCSTを生成するChevrotainパーサーを提供。
// 参照: docs/design/parser.md #4 文法設計, #3.2 トークン定義コード, #3.3 補足

import { CstParser } from 'chevrotain';
import {
  allTokens,
  And,
  Or,
  Not,
  Equals,
  NotEquals,
  GreaterThan,
  GreaterThanOrEqual,
  LessThan,
  LessThanOrEqual,
  Colon,
  LParen,
  RParen,
  Comma,
  Dot,
  Identifier,
  StringLiteral,
  NumberLiteral,
  True,
  False,
  Null,
  Contains,
  StartsWith,
  EndsWith,
  Any,
  All,
  None,
} from './tokens.ts';

// パーサー本体
export class DslParser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: true, // エラー回復を有効化（docs第12章に準拠）
      nodeLocationTracking: 'full',
    });
    this.performSelfAnalysis();
  }

  // トップレベル
  public expression = this.RULE('expression', () => {
    this.SUBRULE(this.orExpression);
  });

  // ORは最も低い優先順位。左結合。
  public orExpression = this.RULE('orExpression', () => {
    this.SUBRULE(this.andExpression, { LABEL: 'lhs' });
    this.MANY(() => {
      this.CONSUME(Or);
      this.SUBRULE2(this.andExpression, { LABEL: 'rhs' });
    });
  });

  // AND は OR より高い。左結合。
  public andExpression = this.RULE('andExpression', () => {
    this.SUBRULE(this.notExpression, { LABEL: 'lhs' });
    this.MANY(() => {
      this.CONSUME(And);
      this.SUBRULE2(this.notExpression, { LABEL: 'rhs' });
    });
  });

  // NOT は単項。NOT > AND > OR の優先順位
  public notExpression = this.RULE('notExpression', () => {
    this.OPTION(() => {
      this.CONSUME(Not);
      this.SUBRULE(this.notExpression, { LABEL: 'argument' });
    });
    this.OPTION2(() => {
      // 上のOPTIONが使われなかった場合はprimaryへ
      this.SUBRULE(this.primaryExpression);
    });
  });

  // ★★★ 最も重要な変更箇所 ★★★
  // 曖昧さを解決するため、アトミックな（＝それ以上分解できない）要素を定義
  // 曖昧性解決戦略:
  // 'path > 10' と 'path' のような共通の接頭辞を持つルールが競合するため、
  // 左共通部分の括りだし（Left Factoring）を適用する。
  // まず共通部分である `fieldPath` を消費し、後続のトークンに応じて
  // `pathBasedExpression` 内で処理を分岐させる。

  public atomicExpression = this.RULE('atomicExpression', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.groupExpression) },
      {
        ALT: () => {
          this.SUBRULE(this.fieldPath);
          this.OR2([
            { ALT: () => this.CONSUME(NumberLiteral) },
            { ALT: () => this.CONSUME(True) },
            { ALT: () => this.CONSUME(False) },
            { ALT: () => this.CONSUME(Null) },
          ]);
        }
      }
    ]);
  });
  


  // pathで始まる式の曖昧さを解決するための専用ルール（GATEで呼び出し元が制御される）
  /**
 * pathで始まる式のCSTノードをASTに変換する。
 * CSTノード内に comparisonOperator や Colon が存在するかどうかで、
 * 生成するASTノード（ComparisonExpression, TextShorthandExpression, PathNode）を決定する
 * ディスパッチャ（分岐役）として機能する。
 */
  public pathBasedExpression = this.RULE('pathBasedExpression', () => {
    // 最初に共通部分であるpathを消費
    // fieldPathルールはIdentifierまたはStringLiteralで始まる
    this.SUBRULE(this.fieldPath); 
    
    // pathの後に続くトークンに応じて処理を分岐
    this.OPTION(() => {
        this.OR([
            // path > literal の形式
            {
              GATE: () => [Equals, NotEquals, GreaterThan, GreaterThanOrEqual, LessThan, LessThanOrEqual].includes(this.LA(1).tokenType),
              ALT: () => {
                this.SUBRULE(this.comparisonOperator);
                this.SUBRULE(this.literal);
              },
            },
            // path : value の形式
            {
              GATE: () => this.LA(1).tokenType === Colon,
              ALT: () => {
                this.CONSUME(Colon);
                this.OR3([
                  { ALT: () => this.SUBRULE(this.literal) },
                  { ALT: () => this.SUBRULE(this.valueList) },
                  { ALT: () => this.SUBRULE(this.comparisonShorthand) }
                ]);
              }
            },
            {
              GATE: () =>
                [
                  Equals,
                  NotEquals,
                  GreaterThanOrEqual,
                  LessThanOrEqual,
                  GreaterThan,
                  LessThan
                ].includes(this.LA(1).tokenType),
              ALT: () => {
                this.OR4([
                  { ALT: () => this.CONSUME(Equals) },
                  { ALT: () => this.CONSUME(NotEquals) },
                  { ALT: () => this.CONSUME(GreaterThanOrEqual) },
                  { ALT: () => this.CONSUME(LessThanOrEqual) },
                  { ALT: () => this.CONSUME(GreaterThan) },
                  { ALT: () => this.CONSUME(LessThan) }
                ]);
                this.SUBRULE2(this.literal);
              }
            },
            {
              GATE: () => this.LA(1).tokenType === LParen,
              ALT: () => {
                this.CONSUME(LParen);
                this.SUBRULE(this.callArguments);
                this.CONSUME(RParen);
              }
            },
            // 最後に「どれでもなければ省略型fieldPath」を許容
            {
              GATE: () =>
                ![
                  Colon,
                  Equals,
                  NotEquals,
                  GreaterThanOrEqual,
                  LessThanOrEqual,
                  GreaterThan,
                  LessThan,
                  LParen
                ].includes(this.LA(1).tokenType),
              ALT: () => {
                // fieldPathだけで評価式を閉じる
                // 何もせず終了              
              }
            }
          ]);
        }
      },
      // literalのみ
      { ALT: () => this.SUBRULE3(this.literal) }
    ]);
  });
    
  
  // ( expr )
  public groupExpression = this.RULE('groupExpression', () => {
    this.CONSUME(LParen);
    this.SUBRULE(this.expression);
    this.CONSUME(RParen);
  });

  // path OP literal
  public comparisonExpression = this.RULE('comparisonExpression', () => {
    this.SUBRULE(this.fieldPath);
    this.OR([
      { ALT: () => this.CONSUME(Equals) },
      { ALT: () => this.CONSUME(NotEquals) },
      { ALT: () => this.CONSUME(GreaterThanOrEqual) },
      { ALT: () => this.CONSUME(LessThanOrEqual) },
      { ALT: () => this.CONSUME(GreaterThan) },
      { ALT: () => this.CONSUME(LessThan) },
    ]);
    this.SUBRULE(this.literal);
  });

  // path : ( literal | valueList | comparisonShorthand )
  public textShorthandExpression = this.RULE('textShorthandExpression', () => {
    this.SUBRULE(this.fieldPath);
    this.CONSUME(Colon);
    this.OR([
      { ALT: () => this.SUBRULE(this.literal) },
      { ALT: () => this.SUBRULE(this.valueList) },
      { ALT: () => this.SUBRULE(this.comparisonShorthand) },
    ]);
  });

  // &gt; 10, &lt;= 5 など（比較記号 + リテラル）
  public comparisonShorthand = this.RULE('comparisonShorthand', () => {
    this.OR([
      { ALT: () => this.CONSUME(GreaterThanOrEqual) },
      { ALT: () => this.CONSUME(LessThanOrEqual) },
      { ALT: () => this.CONSUME(GreaterThan) },
      { ALT: () => this.CONSUME(LessThan) },
    ]);
    this.SUBRULE(this.literal);
  });

  // ("A","B") または (&gt;5, &lt;13) かつ括弧内で AND/OR 明示も将来的拡張で考慮
  public valueList = this.RULE('valueList', () => {
    this.CONSUME(LParen);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          { ALT: () => this.SUBRULE(this.literal) },
          { ALT: () => this.SUBRULE(this.comparisonShorthand) },
        ]);
      },
    });
    this.CONSUME(RParen);
  });

  // 関数呼び出し: contains(path, "x"), any(path, innerExpr) 等
  public callExpression = this.RULE('callExpression', () => {
    this.OR([
      { ALT: () => this.CONSUME(Contains) },
      { ALT: () => this.CONSUME(StartsWith) },
      { ALT: () => this.CONSUME(EndsWith) },
      { ALT: () => this.CONSUME(Any) },
      { ALT: () => this.CONSUME(All) },
      { ALT: () => this.CONSUME(None) },
    ]);
    this.CONSUME(LParen);
    // 引数は path または expression（関数により期待が異なるため柔軟に）
    this.SUBRULE(this.callArguments);
    this.CONSUME(RParen);
  });

  public callArguments = this.RULE('callArguments', () => {
    // 引数リストは最初は fieldPath（any field path）を優先
    this.OPTION(() => {
      this.SUBRULE(this.fieldPath);
      this.MANY(() => {
        this.CONSUME(Comma);
        this.SUBRULE(this.expression); // 2個目以降は表現式なんでも許容
      });
    });
  });
  

  // path: Identifier(.Identifier)* | StringLiteral(.Identifier)*
  public fieldPath = this.RULE('fieldPath', () => {
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(StringLiteral) }, // パス内のクオート識別子はここで受ける
    ]);
    this.MANY(() => {
      this.CONSUME(Dot);
      this.OR2([
        { ALT: () => this.CONSUME2(Identifier) },
        { ALT: () => this.CONSUME2(StringLiteral) },
      ]);
    });
  });

  // literal: string | number | true | false | null
  public literal = this.RULE('literal', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(NumberLiteral) },
      { ALT: () => this.CONSUME(True) },
      { ALT: () => this.CONSUME(False) },
      { ALT: () => this.CONSUME(Null) },
    ]);
  });
}
