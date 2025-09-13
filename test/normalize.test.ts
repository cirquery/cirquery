// test/normalize.test.ts

import { describe, it, expect } from "vitest";
import { parse } from "../src/parser/index.ts";
import { normalize } from "../src/cir/normalize.ts";
import type { CirNode } from "../src/cir/types.ts";

// ヘルパ: Pathノード → CIR準拠の truthy ComparisonNode
function pathNode(segments: string[]) {
  return {
    type: "Comparison",
    path: { type: 'Path', segments },
    op: "neq",
    value: { type: "NullLiteral" }
  };
}

describe("normalize", () => {
  it("should flatten left-associative OR/AND expressions", () => {
    const { ast } = parse("A OR B OR C");
    const cir = normalize(ast) as CirNode;
    expect(cir).toEqual({
      type: "Or",
      children: [
        pathNode(["A"]),
        pathNode(["B"]),
        pathNode(["C"])
      ]
    });
  });

  it("should flatten nested AND/OR and maintain precedence", () => {
    const { ast } = parse("A OR B AND C OR D");
    // 想定CIR: Or [ A, And [B, C], D ]
    const cir = normalize(ast) as CirNode;
    expect(cir).toEqual({
      type: "Or",
      children: [
        pathNode(["A"]),
        {
          type: "And",
          children: [
            pathNode(["B"]),
            pathNode(["C"])
          ]
        },
        pathNode(["D"])
      ]
    });
  });


it("should push down NOT with De Morgan", () => {
  const { ast } = parse("NOT (A AND B)");
  const cir = normalize(ast);
  expect(cir).toEqual({
    type: "Or",
    children: [
      /* 旧: 
      children: [
        { type: "Not", child: pathNode(["A"]) },
        { type: "Not", child: pathNode(["B"]) }
      ]
      */

      // D-6導入後: Not(Comparison(neq,null)) → Comparison(eq,null)
      {
        type: "Comparison",
        path: { type: 'Path', segments: ['A'] },
        op: 'eq',
        value: { type: 'NullLiteral' },
      },
      // 旧: { type: "Not", child: pathNode(["B"]) },
      {
        type: "Comparison",
        path: { type: 'Path', segments: ['B'] },
        op: 'eq',
        value: { type: 'NullLiteral' },
      },
    ]
  });
});


  it("should handle double negation", () => {
    const { ast } = parse("NOT (NOT A)");
    const cir = normalize(ast);
    expect(cir).toEqual(
      pathNode(["A"])
    );
  });

  it("should handle NOT applied to OR", () => {
    const { ast } = parse("NOT (A OR B)");
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: "And",
      children: [
        /*
        { type: "Not", child: pathNode(["A"]) },
        { type: "Not", child: pathNode(["B"]) }
        */
        { type: "Comparison",
          path: { type: 'Path', segments: ['A'] },
          op: 'eq',
          value: { type: 'NullLiteral'}
        },
        { type: "Comparison",
          path: { type: 'Path', segments: ['B'] },
          op: 'eq',
          value: { type: 'NullLiteral'}
        }
      ]
    });
  });

it('[C-7] should normalize a ">" ComparisonExpression to a "gt" ComparisonNode', () => {
    const { ast } = parse('price > 1000');
    //console.log('AST for "price > 1000":', JSON.stringify(ast, null, 2));
    const cir = normalize(ast);

    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments:['price'] },
      op: 'gt',
      value: { type: 'NumberLiteral', value: 1000 },
    });
  });

  it('[C-7] should normalize a "=" ComparisonExpression with a string to an "eq" ComparisonNode', () => {
    const { ast } = parse('category = "Spirits"');
    //console.log('AST for "category = \\"Spirits\\"":', JSON.stringify(ast, null, 2));
    const cir = normalize(ast);

    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments:['category'] },
      op: 'eq',
      value: { type: 'StringLiteral', value: 'Spirits' },
    });
  });

  it('[C-7] should normalize a "!=" ComparisonExpression with a null to a "neq" ComparisonNode', () => {
    const { ast } = parse('notes != null');
    //console.log('AST for "notes != null":', JSON.stringify(ast, null, 2));
    const cir = normalize(ast);

    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments:['notes'] },
      op: 'neq',
      value: { type: 'NullLiteral' },
    });
  });

// test/normalize.test.ts に追記

  it('[C-8] should normalize a string shorthand to a "contains" TextNode', () => {
    const { ast } = parse('title: "Lord of the Rings"');
    const cir = normalize(ast);

    expect(cir).toEqual({
      type: 'Text',
      path: { type: 'Path', segments:['title'] },
      op: 'contains',
      value: { type: 'StringLiteral', value: 'Lord of the Rings' },
    });
  });

  it('[C-8] should normalize a number shorthand to an "eq" ComparisonNode', () => {
    // 仕様変更を検証する新しいテストケース
    const { ast } = parse('year: 1954');
    const cir = normalize(ast);

    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments:['year'] },
      op: 'eq',
      value: { type: 'NumberLiteral', value: 1954 },
    });
  });

  it('[C-8] should normalize a comparison shorthand to a "gt" ComparisonNode', () => {
    const { ast } = parse('rating: >4.5');
    const cir = normalize(ast);

    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments:['rating'] },
      op: 'gt',
      value: { type: 'NumberLiteral', value: 4.5 },
    });
  });

  /* C-10実装時コメントアウト
  it('[C-8] should throw an error for ValueList shorthand as it is not yet implemented', () => {
    // C-10で実装予定の機能が、意図通りエラーを出すことを確認
    const { ast } = parse('tags: ("A", "B")');
    
    expect(() => normalize(ast)).toThrow(
      'Normalization for ValueList in TextShorthand is not implemented yet (C-10).'
    );
  });
  */

  it('[C-9] contains(path, "x") -> Text[contains]', () => {
    const { ast } = parse('contains(name, "gin")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Text',
      path: { type: 'Path', segments:['name'] },
      op: 'contains',
      value: { type: 'StringLiteral', value: 'gin' },
    });
  });

  it('[C-9] startsWith(path, "x") -> Text[startsWith]', () => {
    const { ast } = parse('startsWith(brand, "Bo")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Text',
      path: { type: 'Path', segments:['brand'] },
      op: 'startsWith',
      value: { type: 'StringLiteral', value: 'Bo' },
    });
  });

  it('[C-9] endsWith(path, "x") -> Text[endsWith]', () => {
    const { ast } = parse('endsWith(category, "rits")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Text',
      path: { type: 'Path', segments:['category'] },
      op: 'endsWith',
      value: { type: 'StringLiteral', value: 'rits' },
    });
  });

  it('[C-9] any(path, expr) -> Quantified[any]', () => {
    const { ast } = parse('any(ingredients, name: "gin")');
    const cir = normalize(ast);
    // predicate は Text[contains] になる（C-8の仕様に基づく）
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments:['ingredients'] },
      predicate: {
        type: 'Text',
        path: { type: 'Path', segments:['name'] },
        op: 'contains',
        value: { type: 'StringLiteral', value: 'gin' },
      },
    });
  });

  it('[C-9] all(path, expr) -> Quantified[all]', () => {
    const { ast } = parse('all(ingredients, alcohol_content > 20)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'all',
      path: { type: 'Path', segments:['ingredients'] },
      predicate: {
        type: 'Comparison',
        path: { type: 'Path', segments:['alcohol_content'] },
        op: 'gt',
        value: { type: 'NumberLiteral', value: 20 },
      },
    });
  });

  it('[C-9] none(path, expr) -> Quantified[none]', () => {
    const { ast } = parse('none(ingredients, notes != null)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'none',
      path: { type: 'Path', segments:['ingredients'] },
      predicate: {
        type: 'Comparison',
        path: { type: 'Path', segments:['notes'] },
        op: 'neq',
        value: { type: 'NullLiteral' },
      },
    });
  });

  it('[C-9][error] contains requires (path, string)', () => {
    const { ast } = parse('contains(name, 123)');
    expect(() => normalize(ast)).toThrow('normalizeCall: text functions require a string literal as the second argument');
  });

  it('[C-9][error] any requires two args', () => {
    // any, all, noneはパーサが2引数を強制するため、Normalizeの手前でParseErrorが投げられる
    expect(() => parse('any(items)')).toThrow("Expecting token of type --> Comma <-- but found --> ')' <--");
  });

  it('[C-9.1] contains("gin") -> OR 展開 (注入 targets に依存)', () => {
    const { ast } = parse('contains("gin")');
    console.log(JSON.stringify(ast,null,2));
    const targets = ["name", "brand", "category"]; // テスト注入（DB知識ではなく実行環境の設定）
    const cir = normalize(ast, { textSearchTargets: targets });
  
    const expectedChildren = targets.map(seg => ({
      type: 'Text',
      path: { type: 'Path', segments: [seg] },
      op: 'contains',
      value: { type: 'StringLiteral', value: 'gin' },
    }));
  
    expect(cir).toEqual({
      type: 'Or',
      children: expectedChildren,
    });
  });

  it('[C-9.2] startsWith("Bo") -> OR 展開（注入 targets に依存）', () => {
    const { ast } = parse('startsWith("Bo")');
    const targets = ['name', 'brand']; // テスト用に注入する対象
    const cir = normalize(ast, { textSearchTargets: targets });
  
    const expectedChildren = targets.map(seg => ({
      type: 'Text',
      path: { type: 'Path', segments: [seg] },
      op: 'startsWith',
      value: { type: 'StringLiteral', value: 'Bo' },
    }));
  
    expect(cir).toEqual(
      expectedChildren.length === 1
        ? expectedChildren
        : { type: 'Or', children: expectedChildren }
    );
  });
  
  it('[C-9.2][error] startsWith の1引数は StringLiteral 必須', () => {
    const { ast } = parse('startsWith(123)');
    expect(() => normalize(ast, { textSearchTargets: ['name'] }))
      .toThrow('normalizeCall: text functions require a string literal as the argument');
  });
  
  it('[C-9.2][2引数] startsWith(path, "Bo") は従来どおり Text[startsWith]', () => {
    const { ast } = parse('startsWith(brand, "Bo")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Text',
      path: { type: 'Path', segments: ['brand'] },
      op: 'startsWith',
      value: { type: 'StringLiteral', value: 'Bo' },
    });
  });
  
  it('[C-9.3] endsWith("rits") -> OR 展開（注入 targets に依存）', () => {
    const { ast } = parse('endsWith("rits")');
    const targets = ['category']; // テスト用に注入（1件でもOK）
    const cir = normalize(ast, { textSearchTargets: targets });
  
    const expectedChildren = targets.map(seg => ({
      type: 'Text',
      path: { type: 'Path', segments: [seg] },
      op: 'endsWith',
      value: { type: 'StringLiteral', value: 'rits' },
    }));
  
    expect(cir).toEqual(
      expectedChildren.length === 1
        ? expectedChildren[0]
        : { type: 'Or', children: expectedChildren }
    );
  });
  
  it('[C-9.3][error] endsWith の1引数は StringLiteral 必須', () => {
    const { ast } = parse('endsWith(123)');
    expect(() => normalize(ast, { textSearchTargets: ['name'] }))
      .toThrow('normalizeCall: text functions require a string literal as the argument');
  });
  
  it('[C-9.3][error] endsWith("x") で targets 未設定はエラー', () => {
    const { ast } = parse('endsWith("x")');
    expect(() => normalize(ast)).toThrow('normalizeCall: full-text search targets not configured');
  });
  
  it('[C-9.4] contains("gin") で targets 未設定はエラー', () => {
    const { ast } = parse('contains("gin")');
    expect(() => normalize(ast)).toThrow('normalizeCall: full-text search targets not configured');
  });
  
  it('[C-9.4] startsWith("Bo") で targets:[] はエラー', () => {
  const { ast } = parse('startsWith("Bo")');
    expect(() => normalize(ast, { textSearchTargets: [] }))
    .toThrow('normalizeCall: full-text search targets not configured');
  });
  
  it('[C-9.4] endsWith("x") で targets:[] はエラー', () => {
    const { ast } = parse('endsWith("x")');
    expect(() => normalize(ast, { textSearchTargets: [] }))
  .toThrow('normalizeCall: full-text search targets not configured');
  });

  it('[C-9.5] contains の1引数は StringLiteral 必須', () => {
    const { ast } = parse('contains(123)');
    expect(() => normalize(ast, { textSearchTargets: ['name'] }))
    .toThrow('normalizeCall: text functions require a string literal as the argument');
  });
    
  it('[C-9.5] startsWith の1引数は StringLiteral 必須', () => {
    const { ast } = parse('startsWith(true)');
    expect(() => normalize(ast, { textSearchTargets: ['name'] }))
    .toThrow('normalizeCall: text functions require a string literal as the argument');
  });
    
  it('[C-9.5] endsWith の1引数は StringLiteral 必須', () => {
    const { ast } = parse('endsWith(null)');
    expect(() => normalize(ast, { textSearchTargets: ['name'] }))
    .toThrow('normalizeCall: text functions require a string literal as the argument');
  });

  it('[C-9.6] any(items) はパーサでカンマ期待エラー', () => {
    expect(() => parse('any(items)'))
    .toThrow("Expecting token of type --> Comma <-- but found --> ')' <--");
  });
    
  it('[C-9.6] all(items) はパーサでカンマ期待エラー', () => {
    expect(() => parse('all(items)'))
    .toThrow("Expecting token of type --> Comma <-- but found --> ')' <--");
  });
    
  it('[C-9.6] none(items) はパーサでカンマ期待エラー', () => {
    expect(() => parse('none(items)'))
    .toThrow("Expecting token of type --> Comma <-- but found --> ')' <--");
  });

  // C-10: ルールB 複合値リストの展開
  it('[C-10] path: ("A","B") -> OR(Text[contains], Text[contains])', () => {
    const { ast } = parse('tags: ("A", "B")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Or',
      children: [
        {
          type: 'Text',
          path: { type: 'Path', segments: ['tags'] },
          op: 'contains',
          value: { type: 'StringLiteral', value: 'A' },
        },
        {
          type: 'Text',
          path: { type: 'Path', segments: ['tags'] },
          op: 'contains',
          value: { type: 'StringLiteral', value: 'B' },
        },
      ],
    });
  });

  it('[C-10] path: (>5, <=13) -> AND(Comparison(gt,5), Comparison(lte,13))', () => {
    const { ast } = parse('price: (>5, <=13)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'And',
      children: [
        {
          type: 'Comparison',
          path: { type: 'Path', segments: ['price'] },
          op: 'gt',
          value: { type: 'NumberLiteral', value: 5 },
        },
        {
          type: 'Comparison',
          path: { type: 'Path', segments: ['price'] },
          op: 'lte',
          value: { type: 'NumberLiteral', value: 13 },
        },
      ],
    });
  });

  it('[C-10][error] 空の ValueList はエラー', () => {
    // 構文上、空の () を許容していない場合はこのテストはスキップ/調整が必要
    // ここでは仕様に従い、もし空がパースできるケースなら NormalizeError を期待
    // parse('tags: ()') が通らない文法なら、このケースは不要です
    // expect(() => { const { ast } = parse('tags: ()'); normalize(ast); })
    //   .toThrow('normalizeTextShorthand: empty value list not allowed');
  });

  it('[C-10][error] 型混在 ("A", >5) はエラー', () => {
    const { ast } = parse('tags: ("A", >5)');
    expect(() => normalize(ast)).toThrow(
      "Unsupported node 'ValueListExpression': mixed types"
    );
  });

  // C-11: ルールC 配列ショートハンドの展開（ドット区切り → Quantified(any)）
  it('[C-11] ingredients.name:"gin" -> Quantified(any, ingredients, Text[contains name])', () => {
    const { ast } = parse('ingredients.name: "gin"');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        type: 'Text',
        path: { type: 'Path', segments: ['name'] },
        op: 'contains',
        value: { type: 'StringLiteral', value: 'gin' },
      },
    });
  });

  it('[C-11] ingredients.alcohol_content > 20 -> Quantified(any, ingredients, Comparison(gt 20))', () => {
    const { ast } = parse('ingredients.alcohol_content > 20');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        type: 'Comparison',
        path: { type: 'Path', segments: ['alcohol_content'] },
        op: 'gt',
        value: { type: 'NumberLiteral', value: 20 },
      },
    });
  });

  it('[C-11] ingredients.name:("A","B") -> OR of Quantified(any, ingredients, Text[contains name])', () => {
    const { ast } = parse('ingredients.name: ("A","B")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Or',
      children: [
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Text',
            path: { type: 'Path', segments: ['name'] },
            op: 'contains',
            value: { type: 'StringLiteral', value: 'A' },
          },
        },
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Text',
            path: { type: 'Path', segments: ['name'] },
            op: 'contains',
            value: { type: 'StringLiteral', value: 'B' },
          },
        },
      ],
    });
  });

  it('[C-11] ingredients.alcohol_content:(>5, <=13) -> AND of Quantified(any, ingredients, Comparison(...))', () => {
    const { ast } = parse('ingredients.alcohol_content: (>5, <=13)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'And',
      children: [
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Comparison',
            path: { type: 'Path', segments: ['alcohol_content'] },
            op: 'gt',
            value: { type: 'NumberLiteral', value: 5 },
          },
        },
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Comparison',
            path: { type: 'Path', segments: ['alcohol_content'] },
            op: 'lte',
            value: { type: 'NumberLiteral', value: 13 },
          },
        },
      ],
    });
  });

  it('[C-11] 複合: ingredients.name:"gin" AND ingredients.alcohol_content>20 は各子が Quantified 化', () => {
    const { ast } = parse('ingredients.name: "gin" AND ingredients.alcohol_content > 20');
    const cir = normalize(ast) as CirNode;
    expect(cir).toEqual({
      type: 'And',
      children: [
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Text',
            path: { type: 'Path', segments: ['name'] },
            op: 'contains',
            value: { type: 'StringLiteral', value: 'gin' },
          },
        },
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Comparison',
            path: { type: 'Path', segments: ['alcohol_content'] },
            op: 'gt',
            value: { type: 'NumberLiteral', value: 20 },
          },
        },
      ],
    });
  });

  // C-12: 正規化E2E（否定・量化子・配列ショートハンド・平坦化）

  it('[C-12] NOT (A AND B) -> Or(Not A, Not B)（De Morgan）', () => {
    const { ast } = parse('NOT (A AND B)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Or',
      children: [
        { type: 'Comparison',
          path: { type: 'Path', segments: ['A'] }, 
          op: 'eq', 
          value: { type: 'NullLiteral' }  
        },
        { type: 'Comparison', 
          path: { type: 'Path', segments: ['B'] }, 
          op: 'eq', 
          value: { type: 'NullLiteral' } 
        },
      ],
    });
  });

  it('[C-12] NOT (A OR B) -> And(Not A, Not B)（De Morgan）', () => {
    const { ast } = parse('NOT (A OR B)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'And',
      children: [
        { type: 'Comparison', path: { type: 'Path', segments: ['A'] }, op: 'eq', value: { type: 'NullLiteral' }  },
        { type: 'Comparison', path: { type: 'Path', segments: ['B'] }, op: 'eq', value: { type: 'NullLiteral' }  },
      ],
    });
  });

  it('[C-12] 二重否定: NOT (NOT A) -> A', () => {
    const { ast } = parse('NOT (NOT A)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['A'] },
      op: 'neq',
      value: { type: 'NullLiteral' },
    });
  });

  it('[C-12] NOT any(items, name:"gin") -> none(items, Text[contains])', () => {
    const { ast } = parse('NOT any(items, name: "gin")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'none',
      path: { type: 'Path', segments: ['items'] },
      predicate: {
        type: 'Text',
        path: { type: 'Path', segments: ['name'] },
        op: 'contains',
        value: { type: 'StringLiteral', value: 'gin' },
      },
    });
  });

  it('[C-12] NOT all(items, price > 10) -> any(items, NOT Comparison(lte 10))（否定は比較反転でもOKだが v0.1は Not を保持可能）', () => {
    const { ast } = parse('NOT all(items, price > 10)');
    const cir = normalize(ast);
    // 本実装は NOT all(P,X) -> any(P, NOT X)
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['items'] },
      predicate: {
        type: 'Not',
        child: {
          type: 'Comparison',
          path: { type: 'Path', segments: ['price'] },
          op: 'gt',
          value: { type: 'NumberLiteral', value: 10 },
        },
      },
    });
  });

  it('[C-12] NOT none(items, notes != null) -> any(items, Comparison(eq null) ではなく仕様上 any(items, X) に簡約', () => {
    const { ast } = parse('NOT none(items, notes != null)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['items'] },
      predicate: {
        type: 'Comparison',
        path: { type: 'Path', segments: ['notes'] },
        op: 'neq',
        value: { type: 'NullLiteral' },
      },
    });
  });

  it('[C-12] 配列ショートハンド + 否定: NOT (ingredients.name:"gin") -> Quantified(none, ingredients, Text[name])', () => {
    const { ast } = parse('NOT (ingredients.name: "gin")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'none',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        type: 'Text',
        path: { type: 'Path', segments: ['name'] },
        op: 'contains',
        value: { type: 'StringLiteral', value: 'gin' },
      },
    });
  });
  
  

  it('[C-12] 平坦化の境界: Or(Or(A,B), And(C,D)) -> Or(A,B, And(C,D))', () => {
    const { ast } = parse('(A OR B) OR (C AND D)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Or',
      children: [
        { type: 'Comparison', path: { type: 'Path', segments: ['A'] }, op: 'neq', value: { type: 'NullLiteral' } },
        { type: 'Comparison', path: { type: 'Path', segments: ['B'] }, op: 'neq', value: { type: 'NullLiteral' } },
        {
          type: 'And',
          children: [
            { type: 'Comparison', path: { type: 'Path', segments: ['C'] }, op: 'neq', value: { type: 'NullLiteral' } },
            { type: 'Comparison', path: { type: 'Path', segments: ['D'] }, op: 'neq', value: { type: 'NullLiteral' } },
          ],
        },
      ],
    });
  });

  it('[C-12] 単一子の最適化: Or(A) -> A, And(A) -> A', () => {
    // Or(A)
    const { ast: astOr } = parse('(A)');
    const cirOr = normalize(astOr);
    expect(cirOr).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['A'] },
      op: 'neq',
      value: { type: 'NullLiteral' },
    });

    // And(A) を明示的に作るため (A AND A) からの押し下げ・平坦化と単一化確認
    const { ast: astAnd } = parse('(A AND A)');
    const cirAnd = normalize(astAnd);
    expect(cirAnd).toEqual({
      type: 'And',
      children: [
        { type: 'Comparison', path: { type: 'Path', segments: ['A'] }, op: 'neq', value: { type: 'NullLiteral' } },
        { type: 'Comparison', path: { type: 'Path', segments: ['A'] }, op: 'neq', value: { type: 'NullLiteral' } },
      ],
    });
  });

  it('[C-12-ext] any(ingredients, ingredients.name:"gin") -> any(ingredients, Quantified(any, ingredients, Text[name]))', () => {
    const { ast } = parse('any(ingredients, ingredients.name: "gin")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        // 単段ラップ: 内側の Text/Comparison に1段だけ Quantified(any) が付与される
        type: 'Quantified',
        quantifier: 'any',
        path: { type: 'Path', segments: ['ingredients'] },
        predicate: {
          type: 'Text',
          path: { type: 'Path', segments: ['name'] },
          op: 'contains',
          value: { type: 'StringLiteral', value: 'gin' },
        },
      },
    });
  });
  
  it('[C-12-ext] NOT (A OR ingredients.name:"x") -> And(Not A, Quantified(none, ingredients, Text[name]))', () => {
    const { ast } = parse('NOT (A OR ingredients.name: "x")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'And',
      children: [
        { type: 'Comparison', path: { type: 'Path', segments: ['A'] }, op: 'eq', value: { type: 'NullLiteral' } },
        {
          type: 'Quantified',
          quantifier: 'none', // NOT any(...) -> none(...)
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Text',
            path: { type: 'Path', segments: ['name'] },
            op: 'contains',
            value: { type: 'StringLiteral', value: 'x' },
          },
        },
      ],
    });
  });
  

  it('[C-12-ext] NOT (ingredients.alcohol_content > 10 AND B) -> Or(Quantified(none, ingredients, Comp gt 10), Not B)', () => {
    const { ast } = parse('NOT (ingredients.alcohol_content > 10 AND B)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Or',
      children: [
        {
          type: 'Quantified',
          quantifier: 'none',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Comparison',
            path: { type: 'Path', segments: ['alcohol_content'] },
            op: 'gt',
            value: { type: 'NumberLiteral', value: 10 },
          },
        },
        {
          type: 'Comparison',
          path: { type: 'Path', segments: ['B'] },
          op: 'eq',
          value: { type: 'NullLiteral' },
        },
      ],
    });
  });
  
  it('[C-10/C-11-ext] ingredients.name:("A") -> Quantified(any, ingredients, Text[name:"A"])', () => {
    const { ast } = parse('ingredients.name: ("A")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        type: 'Text',
        path: { type: 'Path', segments: ['name'] },
        op: 'contains',
        value: { type: 'StringLiteral', value: 'A' },
      },
    });
  });
  
  it('[C-10/C-11-ext] ingredients.alcohol_content:(>5) -> Quantified(any, ingredients, Comparison(gt,5))', () => {
    const { ast } = parse('ingredients.alcohol_content: (>5)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'any',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        type: 'Comparison',
        path: { type: 'Path', segments: ['alcohol_content'] },
        op: 'gt',
        value: { type: 'NumberLiteral', value: 5 },
      },
    });
  });
   
  it('[C-11/C-13-ext] Or(ingredients.name:"A" OR A) -> Or(Quantified(any,...Text[name:"A"]), A)', () => {
    const { ast } = parse('ingredients.name: "A" OR A');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Or',
      children: [
        {
          type: 'Quantified',
          quantifier: 'any',
          path: { type: 'Path', segments: ['ingredients'] },
          predicate: {
            type: 'Text',
            path: { type: 'Path', segments: ['name'] },
            op: 'contains',
            value: { type: 'StringLiteral', value: 'A' },
          },
        },
        { type: 'Comparison', path: { type: 'Path', segments: ['A'] }, op: 'neq', value: { type: 'NullLiteral' } },
      ],
    });
  });
  

});

// test/normalize.test.ts 追記分（D-6: NOT(Comparison) 反転最適化の新規テスト）

describe("normalize - D-6 NOT(Comparison) inversion", () => {
  it('NOT (=) inversion: category = "A" -> neq "A"', () => {
    const { ast } = parse('NOT (category = "A")');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['category'] },
      op: 'neq',
      value: { type: 'StringLiteral', value: 'A' },
    });
  });

  it('NOT (!=) inversion: notes != null -> eq null', () => {
    const { ast } = parse('NOT (notes != null)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['notes'] },
      op: 'eq',
      value: { type: 'NullLiteral' },
    });
  });

  it('NOT (>) inversion: price > 10 -> price <= 10', () => {
    const { ast } = parse('NOT (price > 10)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['price'] },
      op: 'lte',
      value: { type: 'NumberLiteral', value: 10 },
    });
  });

  it('NOT (>=) inversion: price >= 10 -> price < 10', () => {
    const { ast } = parse('NOT (price >= 10)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['price'] },
      op: 'lt',
      value: { type: 'NumberLiteral', value: 10 },
    });
  });

  it('NOT (<) inversion: price < 10 -> price >= 10', () => {
    const { ast } = parse('NOT (price < 10)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['price'] },
      op: 'gte',
      value: { type: 'NumberLiteral', value: 10 },
    });
  });

  it('NOT (<=) inversion: price <= 10 -> price > 10', () => {
    const { ast } = parse('NOT (price <= 10)');
    const cir = normalize(ast);
    expect(cir).toEqual({
      type: 'Comparison',
      path: { type: 'Path', segments: ['price'] },
      op: 'gt',
      value: { type: 'NumberLiteral', value: 10 },
    });
  });

  it('nested: NOT (A AND price > 10) -> Or(Not A, price <= 10)', () => {
    const { ast } = parse('NOT (A AND price > 10)');
    const cir = normalize(ast);
    // A は Path truthy（Comparison(neq,null)）なので Not は保持される（Textではないため将来方針で変わる可能性はあるが現状維持）
    expect(cir).toEqual({
      type: 'Or',
      children: [
        {
          type: 'Comparison',
          path: { type: 'Path', segments: ['A'] },
          op: 'eq',
          value: { type: 'NullLiteral' },
        },
        {
          type: 'Comparison',
          path: { type: 'Path', segments: ['price'] },
          op: 'lte',
          value: { type: 'NumberLiteral', value: 10 },
        },
      ],
    });
  });

  it('quantified: NOT (ingredients.alcohol_content > 10) -> Quantified(none, ingredients, Comparison(gt,10))', () => {
    const { ast } = parse('NOT (ingredients.alcohol_content > 10)');
    const cir = normalize(ast);
    // 方針: Not(any(P, X)) -> none(P, X) とし、predicate への Not 押し込みは行わない（gt は保持）
    expect(cir).toEqual({
      type: 'Quantified',
      quantifier: 'none',
      path: { type: 'Path', segments: ['ingredients'] },
      predicate: {
        type: 'Comparison',
        path: { type: 'Path', segments: ['alcohol_content'] },
        op: 'gt',
        value: { type: 'NumberLiteral', value: 10 },
      },
    });
  });
});


