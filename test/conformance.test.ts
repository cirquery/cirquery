// 適合テスト（v0.3 の中心的な保証）:
// 同一フィクスチャ・同一クエリコーパスに対し、インメモリ評価器と
// SQLite アダプタ（node:sqlite で実実行）の結果 ID 集合が完全一致することを検証する。
import { describe, it, expect, beforeAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { parse } from "../src/parser/index.ts";
import { normalize } from "../src/cir/normalize.ts";
import { buildPredicate } from "../src/cir/evaluator.ts";
import { toSqliteQuery } from "../src/adapters/sqlite/index.ts";

interface Doc {
  id: number;
  name: string;
  category?: string;
  price?: number;
  qty?: number;
  in_stock?: boolean;
  note?: string | null;
  tags?: string[];
  items?: Array<{
    name: string;
    price: number;
    qty: number;
    options?: Array<{ label: string; add_price: number }>;
  }>;
}

// note は「文字列か null」のどちらかで、欠落させない（欠落とnullの区別は
// SQLite JSON モデルの既知の差異のため、適合コーパスの対象外とする）。
const DOCS: Doc[] = [
  {
    id: 1, name: "Martini", category: "classic", price: 120, qty: 3, in_stock: true, note: "dry",
    tags: ["gin", "stirred"],
    items: [
      { name: "gin", price: 60, qty: 1, options: [{ label: "olive", add_price: 5 }] },
      { name: "vermouth", price: 20, qty: 2 },
    ],
  },
  {
    id: 2, name: "Grasshopper", category: "after_dinner", price: 90, qty: 0, in_stock: false, note: null,
    tags: ["cream", "sweet"],
    items: [{ name: "cream", price: 30, qty: 1 }],
  },
  {
    id: 3, name: "Gimlet", category: "classic", price: 100, qty: 5, in_stock: true, note: "lime",
    tags: ["gin", "citrus"],
    items: [
      { name: "gin", price: 60, qty: 1, options: [{ label: "lime twist", add_price: 0 }] },
      { name: "lime juice", price: 10, qty: 1 },
    ],
  },
  {
    id: 4, name: "Mystery", price: 200, qty: 2, in_stock: true, note: "unknown",
    // category 欠落、items 欠落、tags 空
    tags: [],
  },
  {
    id: 5, name: "Virgin Soda", category: "mocktail", price: 50, qty: 10, in_stock: false, note: null,
    tags: ["soda"],
    items: [],
  },
];

const QUERIES: string[] = [
  // 比較・基本
  'category = "classic"',
  'price > 100',
  'price >= 100 AND qty > 0',
  'in_stock = true',
  'in_stock != true',
  'name > "M"',
  'note = null',
  'note != null',
  'missing_field = 1',
  'NOT (category = "classic")',
  'category = "classic" OR category = "mocktail"',
  // テキスト
  'name: "Gin"',
  'name: "gin"',
  'contains(name, "art")',
  'startsWith(name, "Mar")',
  'endsWith(name, "let")',
  'contains(price, "2")', // 数値フィールドへの contains は両者とも偽
  // ショートハンド・値リスト
  'price: (>50, <150)',
  'category: ("classic", "mocktail")',
  // 量化子
  'items.name: "gin"',
  'any(items, price >= 60)',
  'all(items, price >= 10)',
  'none(items, price > 100)',
  'all(missing_items, price > 1)', // 欠落配列の all は両者とも偽
  'tags: "gin"', // 文字列配列の暗黙 any
  'items.options.add_price > 0', // 二段ネストの量化子
  // 演算
  'price * qty > 300',
  'price * qty = 0',
  'price + 10 >= 110',
  '(price - 20) / 2 = 40',
  'qty % 3 = 0',
  'price / (qty - qty) > 1', // ゼロ除算は両者とも偽
  'missing * 2 > 1', // 欠落を含む演算は両者とも偽
  'price > qty', // パス同士の比較
  '-price < -100',
  'any(items, price * qty >= 60)',
  'items.price * 2 > 100', // 配列パスの演算（暗黙 any ラップ）
];

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE docs (id INTEGER PRIMARY KEY, doc TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO docs (id, doc) VALUES (?, ?)");
  for (const doc of DOCS) {
    insert.run(doc.id, JSON.stringify(doc));
  }
});

function idsByEvaluator(query: string): number[] {
  const { ast } = parse(query);
  const cir = normalize(ast as any);
  const predicate = buildPredicate(cir);
  return DOCS.filter(predicate).map((d) => d.id).sort((a, b) => a - b);
}

function idsBySqlite(query: string): number[] {
  const { ast } = parse(query);
  const cir = normalize(ast as any);
  const { sql, params } = toSqliteQuery(cir, { table: "docs", select: "id" });
  const rows = db.prepare(sql).all(...(params as any[])) as Array<{ id: number }>;
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

describe("conformance: in-memory evaluator vs SQLite adapter", () => {
  for (const query of QUERIES) {
    it(query, () => {
      expect(idsBySqlite(query)).toEqual(idsByEvaluator(query));
    });
  }
});
