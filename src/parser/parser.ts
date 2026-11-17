// src/parser/parser.ts
// 目的: tokens.ts のトークンを用いてCSTを生成するChevrotainパーサーを提供。
// 参照: docs/design/parser.md #4 文法設計, #3.2 トークン定義コード, #3.3 補足
//
// v0.3 文法変更（docs/design/v030-arithmetic-adapters.md D-2）:
// - 優先順位: OR < AND < NOT < 比較 < 加減 < 乗除剰余 < 単項マイナス/因子
// - 比較の両辺は演算式になれる（例: price * qty >= 1000）
// - path: value のショートハンドは、GATE（前方読み）で判別して専用ルールに分離
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
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
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
        ALT: () => this.SUBRULE(this.comparisonExpression)
      },
    ]);
  });

  // 比較式: operand (比較演算子 operand)? または path: ショートハンド
  // ショートハンドは先頭が fieldPath かつ直後が Colon の場合のみ（GATEで判別）。
  // それ以外は演算式として読み、比較演算子が続けば ComparisonExpression になる。
  public comparisonExpression = this.RULE('comparisonExpression', () => {
    this.OR([
      {
        GATE: () => this.isColonShorthandAhead(),
        ALT: () => this.SUBRULE(this.pathShorthand),
      },
      {
        ALT: () => {
          this.SUBRULE(this.additiveExpression, { LABEL: 'lhs' });
          this.OPTION(() => {
            this.SUBRULE(this.comparisonOperator);
            this.SUBRULE2(this.additiveExpression, { LABEL: 'rhs' });
          });
        },
      },
    ]);
  });

  // path: value / path: (>5, <13) / path: ("A", "B") の省略形
  public pathShorthand = this.RULE('pathShorthand', () => {
    this.SUBRULE(this.fieldPath);
    this.CONSUME(Colon);
    this.OR([
      { ALT: () => this.SUBRULE(this.literal) },
      { ALT: () => this.SUBRULE(this.valueList) },
      { ALT: () => this.SUBRULE(this.comparisonShorthand) },
    ]);
  });

  // 加減: term (('+' | '-') term)*  左結合
  public additiveExpression = this.RULE('additiveExpression', () => {
    this.SUBRULE(this.term, { LABEL: 'lhs' });
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Plus) },
        { ALT: () => this.CONSUME(Minus) },
      ]);
      this.SUBRULE2(this.term, { LABEL: 'rhs' });
    });
  });

  // 乗除剰余: factor (('*' | '/' | '%') factor)*  左結合
  public term = this.RULE('term', () => {
    this.SUBRULE(this.factor, { LABEL: 'lhs' });
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(Star) },
        { ALT: () => this.CONSUME(Slash) },
        { ALT: () => this.CONSUME(Percent) },
      ]);
      this.SUBRULE2(this.factor, { LABEL: 'rhs' });
    });
  });

  // 因子: 括弧 / 関数呼び出し / 単項マイナス / リテラル / パス
  public factor = this.RULE('factor', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.groupExpression) },
      { ALT: () => this.SUBRULE(this.callExpression) },
      {
        // -数値 は literal 側（Minus + NumberLiteral）が受けるため、ここでは除外する。
        // これにより <Minus, NumberLiteral> 接頭辞の曖昧さを解消する。
        GATE: () => this.LA(2).tokenType !== NumberLiteral,
        ALT: () => {
          this.CONSUME(Minus);
          this.SUBRULE(this.factor, { LABEL: 'negated' });
        },
      },
      { ALT: () => this.SUBRULE(this.literal) },
      { ALT: () => this.SUBRULE(this.fieldPath) },
    ]);
  });

  // GATE: 入力が「fieldPath の直後に Colon」かどうかを前方読みで判定する。
  // fieldPath は Identifier (. (Identifier|StringLiteral))* の形。
  private isColonShorthandAhead(): boolean {
    if (this.LA(1).tokenType !== Identifier) return false;
    let i = 2;
    for (;;) {
      const dot = this.LA(i);
      const seg = this.LA(i + 1);
      if (
        dot.tokenType === Dot &&
        (seg.tokenType === Identifier || seg.tokenType === StringLiteral)
      ) {
        i += 2;
        continue;
      }
      break;
    }
    return this.LA(i).tokenType === Colon;
  }

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
  // literal: string | number | true | false | null | -number（v0.3: 符号はMinusトークン）
  public literal = this.RULE('literal', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral) },
      {
        ALT: () => {
          this.OPTION(() => this.CONSUME(Minus));
          this.CONSUME(NumberLiteral);
        },
      },
      { ALT: () => this.CONSUME(True) },
      { ALT: () => this.CONSUME(False) },
      { ALT: () => this.CONSUME(Null) },
    ]);
  });
}
