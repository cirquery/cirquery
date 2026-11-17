// v0.3: Elasticsearch アダプタの構造テスト（実サーバなし。設計メモ D-6）
// 関連度は扱わず、すべて filter 文脈の bool クエリに落ちることを検証する。
import { describe, it, expect } from "vitest";
import { parse } from "../src/parser/index.ts";
import { normalize } from "../src/cir/normalize.ts";
import {
  toElasticsearchQuery,
  type ElasticsearchAdapterOptions,
} from "../src/adapters/elasticsearch/index.ts";
import { AdapterError } from "../src/errors/errors.ts";
import type { CirNode } from "../src/cir/types.ts";

function conv(q: string, options?: ElasticsearchAdapterOptions) {
  const { ast } = parse(q);
  return toElasticsearchQuery(normalize(ast as any) as CirNode, options);
}

describe("elasticsearch adapter: comparisons", () => {
  it("eq becomes term, order comparisons become range", () => {
    expect(conv('category = "classic"')).toEqual({
      term: { category: { value: "classic" } },
    });
    expect(conv("price > 10")).toEqual({ range: { price: { gt: 10 } } });
  });

  it("null eq/neq become exists presence checks", () => {
    expect(conv("deletedAt = null")).toEqual({
      bool: { must_not: [{ exists: { field: "deletedAt" } }] },
    });
    expect(conv("deletedAt != null")).toEqual({
      exists: { field: "deletedAt" },
    });
  });

  it("And becomes bool.filter; Or is wrapped as should + minimum_should_match in filter", () => {
    expect(conv('price > 10 AND (category = "a" OR category = "b")')).toEqual({
      bool: {
        filter: [
          { range: { price: { gt: 10 } } },
          {
            bool: {
              filter: [
                {
                  bool: {
                    should: [
                      { term: { category: { value: "a" } } },
                      { term: { category: { value: "b" } } },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });
});

describe("elasticsearch adapter: text", () => {
  it("contains defaults to match_phrase (analyzer-dependent)", () => {
    expect(conv('name:"gin"')).toEqual({
      match_phrase: { name: { query: "gin" } },
    });
  });

  it("contains on a keyword field becomes wildcard with escaping", () => {
    expect(conv('name:"a*b"', { keywordFields: ["name"] })).toEqual({
      wildcard: { name: { value: "*a\\*b*" } },
    });
  });

  it("startsWith is prefix, or wildcard on keyword fields", () => {
    expect(conv('startsWith(name, "gi")')).toEqual({
      prefix: { name: { value: "gi" } },
    });
    expect(conv('startsWith(name, "gi")', { keywordFields: ["name"] })).toEqual({
      wildcard: { name: { value: "gi*" } },
    });
  });

  it("endsWith requires a keyword field, otherwise AdapterError", () => {
    expect(conv('endsWith(name, "in")', { keywordFields: ["name"] })).toEqual({
      wildcard: { name: { value: "*in" } },
    });
    expect(() => conv('endsWith(name, "in")')).toThrow(AdapterError);
  });

  it("ignoreCase cannot be guaranteed and is rejected with AdapterError", () => {
    expect(() => conv('name:"x"', { ignoreCase: true })).toThrow(AdapterError);
  });
});

describe("elasticsearch adapter: quantifiers", () => {
  it("any with nestedPaths becomes a nested query with prefixed predicate paths", () => {
    expect(conv("any(items, price > 100)", { nestedPaths: ["items"] })).toEqual({
      nested: { path: "items", query: { range: { "items.price": { gt: 100 } } } },
    });
  });

  it("any without nestedPaths is flattened by prefixing the array path", () => {
    expect(conv("any(items, price > 100)")).toEqual({
      range: { "items.price": { gt: 100 } },
    });
  });

  it("none is the must_not of any (nested form)", () => {
    expect(conv("none(items, price > 100)", { nestedPaths: ["items"] })).toEqual({
      bool: {
        must_not: [
          { nested: { path: "items", query: { range: { "items.price": { gt: 100 } } } } },
        ],
      },
    });
  });

  it("all (nested) is existence plus no counterexample element", () => {
    expect(conv("all(items, price > 0)", { nestedPaths: ["items"] })).toEqual({
      bool: {
        filter: [
          { exists: { field: "items" } },
          {
            bool: {
              must_not: [
                {
                  nested: {
                    path: "items",
                    query: { bool: { must_not: [{ range: { "items.price": { gt: 0 } } }] } },
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("nested quantifiers accumulate the path prefix", () => {
    expect(
      conv("any(orders, any(lines, price > 5))", { nestedPaths: ["orders", "orders.lines"] })
    ).toEqual({
      nested: {
        path: "orders",
        query: {
          nested: {
            path: "orders.lines",
            query: { range: { "orders.lines.price": { gt: 5 } } },
          },
        },
      },
    });
  });
});

describe("elasticsearch adapter: painless scripts", () => {
  it("path-vs-path comparison becomes a script query with missing-field guards", () => {
    expect(conv("price > qty")).toEqual({
      script: {
        script: {
          lang: "painless",
          source:
            "(doc['price'].size() == 0 ? null : doc['price'].value) != null && " +
            "(doc['qty'].size() == 0 ? null : doc['qty'].value) != null && " +
            "(doc['price'].size() == 0 ? null : doc['price'].value) > " +
            "(doc['qty'].size() == 0 ? null : doc['qty'].value)",
        },
      },
    });
  });

  it("arithmetic becomes a script query; div multiplies by 1.0 for real division", () => {
    const result = conv("total / count >= 10");
    expect(result).toMatchObject({ script: { script: { lang: "painless" } } });
    const source = (result as any).script.script.source as string;
    expect(source).toContain("* 1.0 /");
    expect(source).toBe(
      "((doc['total'].size() == 0 ? null : doc['total'].value) * 1.0 / " +
        "(doc['count'].size() == 0 ? null : doc['count'].value)) != null && " +
        "((doc['total'].size() == 0 ? null : doc['total'].value) * 1.0 / " +
        "(doc['count'].size() == 0 ? null : doc['count'].value)) >= 10"
    );
  });
});
