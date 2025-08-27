// test/evaluator.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.ts';
import { normalize } from '../src/cir/normalize.ts';
import { buildPredicate } from '../src/cir/evaluator.ts';

const data = [
  { id: 1, name: 'gin',   brand: 'Boodles',  category: 'Spirits', year: 1954, ingredients: [{ name: 'juniper', alcohol_content: 40 }] },
  { id: 2, name: 'rum',   brand: 'Bacardi',  category: 'Spirits', year: 2000, ingredients: [{ name: 'sugar',   alcohol_content: 37 }] },
  { id: 3, name: 'water', brand: 'Evian',    category: 'Drink',   year: 2020, ingredients: [] },
];

describe('evaluator E2E', () => {
  it('Text contains', () => {
    const { ast } = parse('category: "Spirits"');
    const cir = normalize(ast);
    const pred = buildPredicate(cir);
    const out = data.filter(pred).map(r => r.id);
    expect(out).toEqual([1, 2]);
  });

  it('Comparison gt', () => {
    const { ast } = parse('year > 1990');
    const cir = normalize(ast);
    const pred = buildPredicate(cir);
    const out = data.filter(pred).map(r => r.id);
    expect(out).toEqual([2, 3]);
  });

  it('Quantified any with array shorthand', () => {
    const { ast } = parse('ingredients.alcohol_content > 38');
    const cir = normalize(ast);
    const pred = buildPredicate(cir);
    const out = data.filter(pred).map(r => r.id);
    expect(out).toEqual([1]);
  });

  it('Logical AND/OR/NOT mix', () => {
    const { ast } = parse('(category: "Spirits" AND year > 1990) OR NOT (name: "water")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir);
    const out = data.filter(pred).map(r => r.id);
    // 左辺 [2], 右辺 NOT name:"water" → [1,2]
    expect(out).toEqual([1,2]);
  });

  it('Quantified negation via NOT any -> none', () => {
    const { ast } = parse('NOT any(ingredients, name: "juniper")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir);
    const out = data.filter(pred).map(r => r.id);
    expect(out).toEqual([2,3]); // id:1 は juniper を含むので除外
  });
});
