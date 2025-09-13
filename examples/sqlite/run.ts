// examples/sqlite/run.ts
// 目的: setup.sql と seed.sql を流し、単純な LIKE/EXISTS クエリを投げて結果を確認。
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const db = new Database(resolve('./examples/sqlite/cocktails.db'));

function execSql(file: string) {
  const sql = readFileSync(resolve(file), 'utf-8');
  db.exec(sql);
}

function main() {
  execSql('./examples/sqlite/setup.sql');
  execSql('./examples/sqlite/seed.sql');

  // 動作確認（ingredients.name: "gin" AND ingredients.alcohol_content > 38）
  const rows = db.prepare(`
    SELECT c.*
    FROM cocktails c
    WHERE EXISTS (
      SELECT 1 FROM ingredients i
      WHERE i.cocktail_id = c.id
        AND LOWER(i.name) LIKE LOWER('%gin%')
    )
    AND EXISTS (
      SELECT 1 FROM ingredients i2
      WHERE i2.cocktail_id = c.id
        AND i2.alcohol_content > 38
    );
  `).all();

  console.log(rows);
}

main();
