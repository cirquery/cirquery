-- examples/sqlite/setup.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cocktails (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  year INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY,
  cocktail_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  alcohol_content INTEGER NOT NULL,
  FOREIGN KEY (cocktail_id) REFERENCES cocktails(id) ON DELETE CASCADE
);

-- インデックス（クエリ最適化のため任意で追加）
CREATE INDEX IF NOT EXISTS idx_cocktails_category ON cocktails(category);
CREATE INDEX IF NOT EXISTS idx_cocktails_year ON cocktails(year);
CREATE INDEX IF NOT EXISTS idx_ingredients_cocktail_id ON ingredients(cocktail_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);
