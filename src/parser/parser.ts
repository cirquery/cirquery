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
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Not);
          // 再帰的に呼び出すことで NOT NOT A のような多重否定に対応
          this.SUBRULE(this.notExpression, { LABEL: 'argument' });
        }
      },
      {
        // NOTがない場合は次の優先順位のルールへ
        ALT: () => this.SUBRULE(this.atomicExpression)
      },
    ]);
  });

  // ★★★ 最も重要な変更箇所 ★★★
  // 曖昧さを解決するため、アトミックな（＝それ以上分解できない）要素を定義  // 曖昧性解決戦略:
  // 'path > 10' と 'path' のような共通の接頭辞を持つルールが競合するため、
  // 左共通部分の括りだし（Left Factoring）を適用する。
  // - atomic: group / call / literal / pathBased（この順）
  // - literal に StringLiteral を含める（関数引数の "x" を確実に値として受ける）

  public atomicExpression = this.RULE('atomicExpression', () => {
    this.OR([
      // 1. 括弧や、特定のキーワードで始まるルールは曖昧さがない
      { ALT: () => this.SUBRULE(this.groupExpression) },
      { ALT: () => this.SUBRULE(this.callExpression) },

      {
        ALT: () => {
          this.OR2([
            { ALT: () => this.CONSUME(StringLiteral) },
            { ALT: () => this.CONSUME(NumberLiteral) },
            { ALT: () => this.CONSUME(True) },
            { ALT: () => this.CONSUME(False) },
            { ALT: () => this.CONSUME(Null) },
          ]);
        },
      },
    // ここでのみ GATE を使う: 先頭トークンが Identifier の場合に限り pathBasedExpression を起動
    {
      GATE: () => this.LA(1).tokenType === Identifier,
      ALT: () => this.SUBRULE(this.pathBasedExpression),
    },
  ]);
});



  // pathで始まる式の曖昧さを解決するための専用ルール（GATEで呼び出し元が制御される）
  /**
 * pathで始まる式のCSTノードをASTに変換する。
 * CSTノード内に comparisonOperator や Colon が存在するかどうかで、
 * 生成するASTノード（ComparisonExpression, TextShorthandExpression, PathNode）を決定する
 * ディスパッチャ（分岐役）として機能する。
 */
   // - 先頭が Identifier のときだけ pathBased を起動（GATE）
  // - fieldPath は 先頭Identifier限定、Dot以降は Identifier | StringLiteral を許容
  public pathBasedExpression = this.RULE('pathBasedExpression', () => {

    this.SUBRULE(this.fieldPath);
    this.OPTION(() => {
      this.OR([
        {
          GATE: () =>
            [
              Equals,
              NotEquals,
              GreaterThan,
              GreaterThanOrEqual,
              LessThan,
              LessThanOrEqual,
            ].includes(this.LA(1).tokenType),
          ALT: () => {
            this.SUBRULE(this.comparisonOperator);
            this.SUBRULE(this.literal);
          },
        },
        {
          GATE: () => this.LA(1).tokenType === Colon,
          ALT: () => {
            this.CONSUME(Colon);
            this.OR2([
              { ALT: () => this.SUBRULE2(this.literal) },
              { ALT: () => this.SUBRULE(this.valueList) },
              { ALT: () => this.SUBRULE(this.comparisonShorthand) },
            ]);
          },
        },
      ]);
    });
  });

    // 比較演算子をまとめたヘルパールール
    public comparisonOperator = this.RULE('comparisonOperator', () => {
        this.OR([
            { ALT: () => this.CONSUME(Equals, { LABEL: "operator" }) },
            { ALT: () => this.CONSUME(NotEquals, { LABEL: "operator" }) },
            { ALT: () => this.CONSUME(GreaterThanOrEqual, { LABEL: "operator" }) },
            { ALT: () => this.CONSUME(LessThanOrEqual, { LABEL: "operator" }) },
            { ALT: () => this.CONSUME(GreaterThan, { LABEL: "operator" }) },
            { ALT: () => this.CONSUME(LessThan, { LABEL: "operator" }) },
          ]);
    });


  // ( expr )
  public groupExpression = this.RULE('groupExpression', () => {
    this.CONSUME(LParen);
    this.SUBRULE(this.expression);
    this.CONSUME(RParen);
  });


  // > 10, <= 5 など（比較記号 + リテラル）
  public comparisonShorthand = this.RULE('comparisonShorthand', () => {
    this.SUBRULE(this.comparisonOperator);
    this.SUBRULE(this.literal);
  });


  // ("A","B") または (>5, <13) かつ括弧内で AND/OR 明示も将来的拡張で考慮
  public valueList = this.RULE('valueList', () => {
    this.CONSUME(LParen);
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          // NOTE: chevrotainでは、同じルールを複数回SUBRULEで呼び出す場合、
          // 2回目以降はSUBRULE2, SUBRULE3...とするか、OCCURRENCE IDXを渡す必要がある。
          // ここではliteralとcomparisonShorthandが別ルールなので問題ない。
          { ALT: () => this.SUBRULE(this.literal) },
          { ALT: () => this.SUBRULE(this.comparisonShorthand) },
        ]);
      },
    });
    this.CONSUME(RParen);
  });

public callExpression = this.RULE('callExpression', () => {
  // 先に callee を単独で読む
  let calleeTokenType: any;
  this.OR([
    { ALT: () => { calleeTokenType = Contains;     this.CONSUME(Contains, { LABEL: 'callee' }); } },
    { ALT: () => { calleeTokenType = StartsWith;   this.CONSUME(StartsWith, { LABEL: 'callee' }); } },
    { ALT: () => { calleeTokenType = EndsWith;     this.CONSUME(EndsWith, { LABEL: 'callee' }); } },
    { ALT: () => { calleeTokenType = Any;          this.CONSUME(Any, { LABEL: 'callee' }); } },
    { ALT: () => { calleeTokenType = All;          this.CONSUME(All, { LABEL: 'callee' }); } },
    { ALT: () => { calleeTokenType = None;         this.CONSUME(None, { LABEL: 'callee' }); } },
  ]);

  this.CONSUME(LParen);

  // 直前に消費した callee の種類で分岐（GATE を使わない）
  if (calleeTokenType === Contains || calleeTokenType === StartsWith || calleeTokenType === EndsWith) {
    this.SUBRULE(this.callArgumentsText, { LABEL: 'args' });
  } else {
    this.SUBRULE(this.callArgumentsQuantifier, { LABEL: 'args' });
  }

  this.CONSUME(RParen);
});

  
  
  // テキスト関数: arg1 (',' arg2)?
public callArgumentsText = this.RULE('callArgumentsText', () => {
  // 1個目の引数は「expression」として受ける（StringLiteral も OK）
  this.SUBRULE(this.expression, { LABEL: 'arg1' });
  // 2個めはあれば受ける
  this.OPTION(() => {
    this.CONSUME(Comma);
    this.SUBRULE2(this.expression, { LABEL: 'arg2' });
  });
});

// 量化子: arg1 ',' arg2（従来通り2引数必須）
public callArgumentsQuantifier = this.RULE('callArgumentsQuantifier', () => {
  this.SUBRULE(this.expression, { LABEL: 'arg1' });
  this.CONSUME(Comma);
  this.SUBRULE2(this.expression, { LABEL: 'arg2' });
});
  

  // path: Identifier(.Identifier)* | StringLiteral(.Identifier)*
  public fieldPath = this.RULE('fieldPath', () => {
    // 先頭は Identifierのみ 
    /*
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(StringLiteral) }, // パス内のクオート識別子はここで受ける
    ]);
    */
    this.CONSUME(Identifier);
    // 後続は Dot の後に Identifier か StringLiteral（クォート識別子）を許容
    this.MANY(() => {
      this.CONSUME(Dot);
      this.OR2([
        { ALT: () => this.CONSUME2(Identifier) },
        { ALT: () => this.CONSUME(StringLiteral) },
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
