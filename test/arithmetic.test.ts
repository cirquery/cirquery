// v0.3: 演算式（DSL → CIR → 評価）のテスト
import { describe, it, expect } from "vitest";
import { parse } from "../src/parser/index.ts";
import { normalize } from "../src/cir/normalize.ts";
import { buildPredicate } from "../src/cir/evaluator.ts";
import type { CirNode } from "../src/cir/types.ts";

function toCir(q: string): CirNode {
  const { ast } = parse(q);
  return normalize(ast as any);
}
function pred(q: string) {
  return buildPredicate(toCir(q));
}
const P = (segments: string[]) => ({ type: "Path", segments });
const N = (value: number) => ({ type: "NumberLiteral", value });

describe("arithmetic: normalize shapes", () => {
  it("multiplication as comparison operand", () => {
    expect(toCir("price * qty > 100")).toEqual({
      type: "Comparison",
      left: { type: "Arithmetic", op: "mul", left: P(["price"]), right: P(["qty"]) },
      op: "gt",
      right: N(100),
    });
  });

  it("precedence: * binds tighter than +", () => {
    expect(toCir("a + b * c > 1")).toEqual({
      type: "Comparison",
      left: {
        type: "Arithmetic", op: "add", left: P(["a"]),
        right: { type: "Arithmetic", op: "mul", left: P(["b"]), right: P(["c"]) },
      },
      op: "gt",
      right: N(1),
    });
  });

  it("parentheses override precedence", () => {
    expect(toCir("(a + b) * c > 1")).toEqual({
      type: "Comparison",
      left: {
        type: "Arithmetic", op: "mul",
        left: { type: "Arithmetic", op: "add", left: P(["a"]), right: P(["b"]) },
        right: P(["c"]),
      },
      op: "gt",
      right: N(1),
    });
  });

  it("subtraction is left-associative", () => {
    expect(toCir("a - b - c > 1")).toEqual({
      type: "Comparison",
      left: {
        type: "Arithmetic", op: "sub",
        left: { type: "Arithmetic", op: "sub", left: P(["a"]), right: P(["b"]) },
        right: P(["c"]),
      },
      op: "gt",
      right: N(1),
    });
  });

  it("unary minus on a path becomes Neg; on a number folds into the literal", () => {
    expect(toCir("-price < 0")).toEqual({
      type: "Comparison",
      left: { type: "Neg", arg: P(["price"]) },
      op: "lt",
      right: N(0),
    });
    expect(toCir("price > -5")).toEqual({
      type: "Comparison",
      left: P(["price"]),
      op: "gt",
      right: N(-5),
    });
  });

  it("div and mod ops", () => {
    expect(toCir("total / count >= 10")).toMatchObject({
      left: { type: "Arithmetic", op: "div" },
    });
    expect(toCir("qty % 3 = 0")).toMatchObject({
      left: { type: "Arithmetic", op: "mod" },
    });
  });

  it("NOT inversion applies to arithmetic comparisons", () => {
    expect(toCir("NOT (price * 2 > 10)")).toEqual({
      type: "Comparison",
      left: { type: "Arithmetic", op: "mul", left: P(["price"]), right: N(2) },
      op: "lte",
      right: N(10),
    });
  });

  it("arithmetic over an array path wraps into Quantified(any) with rebased paths", () => {
    expect(toCir("items.price * 2 > 100")).toEqual({
      type: "Quantified",
      quantifier: "any",
      path: P(["items"]),
      predicate: {
        type: "Comparison",
        left: { type: "Arithmetic", op: "mul", left: P(["price"]), right: N(2) },
        op: "gt",
        right: N(100),
      },
    });
  });

  it("mixed path heads are NOT wrapped", () => {
    const cir = toCir("items.price + tax > 100");
    expect(cir.type).toBe("Comparison");
  });

  it("explicit quantifier predicate can use arithmetic", () => {
    const cir = toCir("any(items, price * qty > 100)");
    expect(cir).toMatchObject({ type: "Quantified", quantifier: "any" });
  });

  it("negative literals still work in shorthand forms", () => {
    expect(toCir("price: -5")).toEqual({
      type: "Comparison", left: P(["price"]), op: "eq", right: N(-5),
    });
    expect(toCir("price: (> -5, < 13)")).toMatchObject({ type: "And" });
    expect(toCir("price < -5")).toEqual({
      type: "Comparison", left: P(["price"]), op: "lt", right: N(-5),
    });
  });

  it("an arithmetic expression alone is not a condition", () => {
    expect(() => toCir("price + 1")).toThrow();
  });

  it("string literal inside arithmetic is rejected at normalize", () => {
    expect(() => toCir('price + "x" > 1')).toThrow();
    expect(() => toCir('"x" + 1 > 2')).toThrow();
  });
});

describe("arithmetic: evaluation", () => {
  const rec = { price: 30, qty: 4, tax: 12, name: "x" };

  it("basic arithmetic comparisons", () => {
    expect(pred("price * qty > 100")(rec)).toBe(true);
    expect(pred("price * qty > 121")(rec)).toBe(false);
    expect(pred("price + tax = 42")(rec)).toBe(true);
    expect(pred("(price + tax) / 2 = 21")(rec)).toBe(true);
    expect(pred("qty % 3 = 1")(rec)).toBe(true);
    expect(pred("-price < 0")(rec)).toBe(true);
    expect(pred("price > qty")(rec)).toBe(true); // path vs path
  });

  it("division by zero makes the comparison false (no Infinity)", () => {
    expect(pred("price / (qty - 4) > 1")(rec)).toBe(false);
    expect(pred("price % (qty - 4) = 0")(rec)).toBe(false);
  });

  it("missing field inside arithmetic makes the comparison false", () => {
    expect(pred("missing * 2 > 1")(rec)).toBe(false);
    expect(pred("price * missing > 1")(rec)).toBe(false);
    expect(pred("missing > 1")(rec)).toBe(false);
  });

  it("non-numeric value in arithmetic throws a type mismatch", () => {
    expect(() => pred("name * 2 > 1")(rec)).toThrow();
  });

  it("arithmetic inside quantified predicates", () => {
    const order = { items: [{ price: 10, qty: 2 }, { price: 50, qty: 3 }] };
    expect(pred("any(items, price * qty > 100)")(order)).toBe(true);
    expect(pred("any(items, price * qty > 1000)")(order)).toBe(false);
    // 先頭が混在する式はラップされず、ルートで評価される（配列へのパス解決は値なし→偽）
    expect(pred("items.price * qty > 100")(order)).toBe(false);
  });
});
