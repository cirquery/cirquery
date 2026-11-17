// v0.3: MongoDB アダプタの構造テスト（実サーバなし。設計メモ D-6）
// フィルタ形式で表せる述語はネイティブ演算子に、表せないものは $expr に落ちる
// 「二段構え」が生成結果に現れることを検証する。
import { describe, it, expect } from "vitest";
import { parse } from "../src/parser/index.ts";
import { normalize } from "../src/cir/normalize.ts";
import { toMongoFilter, type MongoAdapterOptions } from "../src/adapters/mongodb/index.ts";
import { AdapterError } from "../src/errors/errors.ts";
import type { CirNode } from "../src/cir/types.ts";

function conv(q: string, options?: MongoAdapterOptions) {
  const { ast } = parse(q);
  return toMongoFilter(normalize(ast as any) as CirNode, options);
}

describe("mongodb adapter: filter form", () => {
  it("simple comparison becomes a native operator", () => {
    expect(conv("price > 10")).toEqual({ price: { $gt: 10 } });
    expect(conv('category = "classic"')).toEqual({ category: "classic" });
  });

  it("eq null stays { path: null } (matches missing fields too: known difference)", () => {
    expect(conv("deletedAt = null")).toEqual({ deletedAt: null });
    expect(conv("deletedAt != null")).toEqual({ deletedAt: { $ne: null } });
  });

  it("And/Or/Not map to $and/$or/$nor", () => {
    expect(conv('price > 10 AND category = "classic" OR NOT name:"gin"')).toEqual({
      $or: [
        { $and: [{ price: { $gt: 10 } }, { category: "classic" }] },
        { $nor: [{ name: { $regex: "gin" } }] },
      ],
    });
  });

  it("text becomes $regex with metacharacters escaped; ignoreCase adds $options", () => {
    expect(conv('name:"a.b"')).toEqual({ name: { $regex: "a\\.b" } });
    expect(conv('name:"Gin"', { ignoreCase: true })).toEqual({
      name: { $regex: "Gin", $options: "i" },
    });
    expect(conv('startsWith(name, "gi")')).toEqual({ name: { $regex: "^gi" } });
    expect(conv('endsWith(name, "in")')).toEqual({ name: { $regex: "in$" } });
  });

  it("empty And is {} and empty Or is an always-false $expr", () => {
    expect(toMongoFilter({ type: "And", children: [] })).toEqual({});
    expect(toMongoFilter({ type: "Or", children: [] })).toEqual({ $expr: false });
  });
});

describe("mongodb adapter: quantifiers", () => {
  it("any over an array path becomes $elemMatch with element-relative predicate", () => {
    expect(conv('ingredients.name:"ジン"')).toEqual({
      ingredients: { $elemMatch: { name: { $regex: "ジン" } } },
    });
    expect(conv("any(items, price > 100)")).toEqual({
      items: { $elemMatch: { price: { $gt: 100 } } },
    });
  });

  it("none is the negation of any", () => {
    expect(conv("none(items, price > 100)")).toEqual({
      items: { $not: { $elemMatch: { price: { $gt: 100 } } } },
    });
  });

  it("all falls back to $expr with $size guard and $allElementsTrue over $map", () => {
    expect(conv("all(items, price > 0)")).toMatchObject({
      $expr: {
        $and: [
          { $gt: [{ $size: expect.anything() }, 0] },
          {
            $allElementsTrue: [
              { $map: { as: "elem1", in: { $gt: ["$$elem1.price", 0] } } },
            ],
          },
        ],
      },
    });
  });

  it("a predicate on the element itself ('value') falls back to $expr with $regexMatch", () => {
    expect(conv('any(tags, value: "fantasy")')).toMatchObject({
      $expr: {
        $anyElementTrue: [
          {
            $map: {
              as: "elem1",
              in: { $regexMatch: { input: "$$elem1", regex: "fantasy" } },
            },
          },
        ],
      },
    });
  });

  it("a quantified predicate with arithmetic falls back to $expr", () => {
    expect(conv("any(items, price * qty > 100)")).toMatchObject({
      $expr: {
        $anyElementTrue: [
          {
            $map: {
              as: "elem1",
              in: { $gt: [{ $multiply: ["$$elem1.price", "$$elem1.qty"] }, 100] },
            },
          },
        ],
      },
    });
  });
});

describe("mongodb adapter: $expr form", () => {
  it("arithmetic comparison becomes $expr", () => {
    expect(conv("price * qty > 100")).toEqual({
      $expr: { $gt: [{ $multiply: ["$price", "$qty"] }, 100] },
    });
  });

  it("path-vs-path comparison becomes $expr", () => {
    expect(conv("price > qty")).toEqual({
      $expr: { $gt: ["$price", "$qty"] },
    });
  });

  it("foldDiacritics is rejected with AdapterError", () => {
    expect(() => conv('name:"x"', { foldDiacritics: true })).toThrow(AdapterError);
  });
});
