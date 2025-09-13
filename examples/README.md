# Examples

このフォルダでは、小さなサンプルデータに対して「DSL → AST → CIR → Evaluator」によるフィルタの流れを試せます。実行用スクリプトと例クエリを用意しています。

## 前提

- Node.js ESM（package.json に "type": "module"）
- 依存インストール済み（npm i）

## データ

- examples/data/cocktails.json  
  例: Gin Tonic, Rum & Coke, Evian, Café Gin Fizz, Tequila Sunrise など。  
  各レコードは以下のような構造です（抜粋）:
  - id: 数値
  - name: 文字列（Café のようなアクセント付きも含む）
  - category: "Spirits" / "Drink" / "Cocktail"
  - year: 数値
  - tags: 文字列配列（例: ["drink","gin"]）
  - ingredients: オブジェクト配列（name, alcohol_content を持つ）

## 実行スクリプト

- examples/scripts/run-example.ts  
  入力（--query または --query-file）を読み、AST/CIRを生成し、Evaluator が作る JS述語を配列.filter に適用して結果を出力します。

使用例:
- クエリをファイルから実行し、結果のみ表示
  - node examples/scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q1_and_or.txt --print result
- クエリを直接与え、CIRを表示
  - node examples/scripts/run-example.ts --data examples/data/cocktails.json --query 'ingredients.alcohol_content > 38' --print cir
- パイプで DSL を与える
  - echo 'any(tags, value: "gin")' | node examples/scripts/run-example.ts --data examples/data/cocktails.json --print result

出力例（--print result のとき）
{
  "count": 2,
  "ids": 【2, 4】,
  "sample": 【{ "id": 2, "name": "Rum & Coke", ... }, { "id": 4, "name": "Café Gin Fizz", ... }】
}

注:
- --ignore-case と --locale を併用すると、テキスト評価で大小無視かつロケール依存の小文字化を行います（例: --ignore-case --locale=tr）。
- このスクリプトは JSON を直接読み込んでフィルタします。バックエンド（SQLite 等）のクエリ言語アダプタ例は adapters/sqlite と test/integration の E2E を参照してください。

### Windows/PowerShell での実行

- 例1: クエリファイルを実行して結果を表示
  npx tsx ./src/cli/cirquery.ts --data ./examples/data/cocktails.json --query-file ./examples/queries/q3_value_reserved.txt --print result

- 例2: 標準入力からDSLを渡して結果を表示
  'any(tags, value: "gin")' | npx tsx ./src/cli/cirquery.ts --data ./examples/data/cocktails.json --print result

- 例3: CIRを表示
  npx tsx ./src/cli/cirquery.ts --data ./examples/data/cocktails.json --query 'ingredients.alcohol_content > 38' --print cir

注:
- 文字列クオートは '...'(単引用符) を推奨します。内部に " を含める場合は \" としてください。


### REPL の起動（PowerShell）

REPL は 1行のDSLを対話評価します。:q で終了、:mode / :ignore / :locale で設定変更できます。

- 一時的に環境変数を設定して起動（現在のセッションのみ）
  $env:CIRQUERY_DATA = (Resolve-Path .\\examples\\data\\cocktails.json); npx tsx ./src/cli/cirquery.ts repl 

REPLコマンド:
- :mode result|ast|cir    出力モードの切替(resultは検索結果、astはクエリの解析結果、cirはクエリの中間表現を出力)
- :ignore on|off          テキストの大文字小文字無視
- :locale <bcp47>         ロケール設定（例: tr, fr。空入力で解除）
- :q                      終了

- 例1:
  name: "Gin" AND  year <2000
---

## クエリ例と意味・期待結果

以下では、examples/queries/*.txt に対応するクエリの意味と、examples/data/cocktails.json に対して実行した場合の期待される結果（id の配列）を示します。

### 1) AND/OR の複合
- ファイル: examples/queries/q1_and_or.txt
- クエリ:
  (category: "Spirits" AND year >= 1965) OR category: "Cocktail"
- 意味:
  - 「カテゴリが Spirits かつ 1965 年以上」または「カテゴリが Cocktail」に該当するものを選びます。
- 期待される結果:
  - 該当する id は【4, 5】（Café Gin Fizz は Cocktail、Tequila Sunrise は Spirits かつ 1970 年）。  
  - Gin Tonic(1954) と Rum & Coke(1963) は年が条件を満たさず除外、Evian は Drink なので除外。

実行例:
node examples/scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q1_and_or.txt --print result

期待出力（ids の部分）:
"ids": 【4, 5】

---

### 2) 配列ショートハンド（ingredients.name）と比較の組み合わせ
- ファイル: examples/queries/q2_quantified.txt
- クエリ:
  ingredients.name: "gin" AND ingredients.alcohol_content > 38
- 意味:
  - ingredients は配列です。配列ショートハンドにより「任意の要素で name が 'gin' を含む」かつ「任意の要素で alcohol_content > 38」を満たすレコードを探します（内部的には any(...) の組み合わせへ正規化）。
- 期待される結果:
  - 該当する id は【1】（Gin Tonic は gin かつ 40%）。  
  - Café Gin Fizz は gin だが 38% で > 38 を満たさないため除外。

実行例:
node examples/scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q2_quantified.txt --print result

期待出力（ids の部分）:
"ids": 【1】

---

### 3) 予約パス value（配列のプリミティブ要素）
- ファイル: examples/queries/q3_value_reserved.txt
- クエリ:
  any(tags, value: "gin") AND NOT any(tags, value: "water")
- 意味:
  - tags は文字列配列です。予約パス value を使い、配列要素そのものに対してテキスト評価を行います。  
  - 「tags に 'gin' を含み」かつ「tags に 'water' を含まない」ものを選びます。
- 期待される結果:
  - 該当する id は【1, 4】（どちらも 'gin' を含み、'water' は含まない）。  
  - Rum & Coke は 'rum'、Evian は 'water'、Tequila Sunrise は 'tequila' のため条件不一致。

実行例:
node examples/scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q3_value_reserved.txt --print result

期待出力（ids の部分）:
"ids": 【1, 4】

---

### 4) all / none（全要素が満たす・どの要素も満たさない）
- ファイル: examples/queries/q4_all_none.txt
- クエリ:
  all(ingredients, alcohol_content >= 0) AND none(ingredients, name: "whisky")
- 意味:
  - ingredients 配列の「すべての要素が alcohol_content >= 0」を満たし、かつ「どの要素も name に 'whisky' を含まない」ものを選びます。  
  - 空配列に対する all は false（全要素が満たすには少なくとも1要素必要）である点に注意。
- 期待される結果:
  - 該当する id は【1, 2, 4, 5】（どれもアルコール度が 0 以上で、whisky は含まない）。  
  - Evian(id:3) は ingredients が空配列のため all(...) が false になり除外。

実行例:
node examples/scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q4_all_none.txt --print result

期待出力（ids の部分）:
"ids": 【1, 2, 4, 5】

---

### 5) 値リスト（暗黙OR）
- ファイル: examples/queries/q5_valuelist.txt
- クエリ:
  name: ("Gin", "Tequila")
- 意味:
  - 値リストの文字列は暗黙ORとして扱われ、「name に 'Gin' を含む」または「name に 'Tequila' を含む」ものを選びます。
- 期待される結果:
  - 該当する id は【1, 4, 5】（Gin Tonic, Café Gin Fizz, Tequila Sunrise）。  
  - Rum & Coke / Evian は含まれません。

実行例:
node examples/scripts/run-example.ts --data examples/data/cocktails.json --query-file examples/queries/q5_valuelist.txt --print result

期待出力（ids の部分）:
"ids": 【1, 4, 5】

注記（将来拡張の方向性）:
- v0.2 では ValueList 内で明示的に OR/AND を記述する構文の導入を検討しています（例: name: ("Gin" OR "Tequila")、price: (> 10 AND < 100)）。その場合、リスト内に演算子が含まれるときはそれを優先し、含まれないときは現行の暗黙規則（文字列=OR、比較=AND）を適用する方針を予定しています。
