# v0.3.0 設計メモ：演算式とアダプタの完成

作成：2026-11-18。前提となる議論（却下意見の検証、先行者調査、差別化）は本メモ末尾の参照を参照。

## 決定事項

### D-1. CIR の Comparison を式ベースに統一する（破壊的変更）

- 変更前：`Comparison { path: Path, op, value: Literal }`
- 変更後：`Comparison { left: CirExpr, op, right: CirExpr }`
- `CirExpr = Path | Literal | Arithmetic | Neg`
  - `Arithmetic { type: 'Arithmetic', op: 'add'|'sub'|'mul'|'div'|'mod', left: CirExpr, right: CirExpr }`
  - `Neg { type: 'Neg', arg: CirExpr }`
- 理由：path/literal 専用の形のまま演算を足すと、比較ノードが2種類に分裂し、消費者（評価器・アダプタ）全てが二重化する。CIR は「正規化された単一の形」が価値なので、0.3.0 で統一する。旧形式との互換は持たない（明示的にエラーにする方針と同様、暗黙の旧形式サポートはしない）。

### D-2. DSL の演算文法

- 優先順位：`* / %` ＞ `+ -` ＞ 比較 ＞ NOT ＞ AND ＞ OR。単項マイナスと括弧を許可。
- 比較の両辺は演算式（パス・数値リテラル・括弧）になれる。文字列/真偽/null リテラルは比較の辺にはなれるが演算には参加しない（意味論で拒否）。
- 演算式単体は条件にならない（normalize でエラー）。`:` ショートハンドは従来どおりパス直後のみ。

### D-3. 演算の意味論（評価器が正）

- 欠落（パスが存在しない、または途中で null/undefined）したオペランドを含む演算は「値なし」になり、その比較は偽になる。
- 数値でない値（文字列・真偽）への演算は `E_EVAL_TYPE_MISMATCH`。
- ゼロ除算・ゼロ剰余は「値なし」（比較は偽）。Infinity/NaN を結果にしない。
- 順序比較はどちらかの辺が「値なし」なら偽。eq/neq は従来の literal 比較規則を維持する。

### D-4. 配列パスのラップ規則の一般化

- 比較の式に現れるパスがすべて同じ先頭セグメントを持ち、長さ2以上なら、その比較を `Quantified(any, [head], 述語)` にラップし、パスを要素相対に付け替える（再帰）。
- 先頭が混在する式（例：`items.price + tax > 100`）はラップしない。要素相対の演算は量化子の明示形 `any(items, price * 2 > 100)` で書く。

### D-5. アダプタの方針（docs/dev/adapters.md の方針を維持）

- アダプタは公開 API に含めない（リポジトリ内の参照実装）。未対応は AdapterError で明示する。
- SQLite： cocktails 固定のデモ実装を廃し、JSON ドキュメント列モデル（json_extract / json_each）の汎用アダプタに書き換える。全リテラルをパラメータ化する。量化子は EXISTS + json_each。all は COALESCE で NULL を偽に寄せて評価器と一致させる。
- MongoDB：単純述語はネイティブ演算子（$elemMatch 等）、演算と比較・量化子の述語は $expr 式に落とす二段構え。
- Elasticsearch：関連度は扱わない（設計上のスコープ外）。全て filter 文脈の bool クエリに落とす。contains は match_phrase（アナライザ依存を明記）、量化子は nested 指定がある場合のみ nested クエリ、演算は painless script。
- 既知の意味差は各アダプタのドキュメントに明記する（例：SQLite JSON モデルでは「欠落」と JSON null を区別できない）。

### D-6. 適合テストを価値の中心に置く

- 同一フィクスチャ・同一クエリコーパスに対し、インメモリ評価器と SQLite（node:sqlite で実実行）の結果 ID 集合が完全一致することをテストで保証する。
- MongoDB / Elasticsearch は生成クエリの構造テスト（実サーバなし）。

## 参照

- 却下意見の検証・先行者調査（OData / Calcite / Substrait）・差別化：開発者ノート `cirquery-review-261118`（リポジトリ外）。
- 記事：Qiita「ネストしたJSONを直感的に検索したくて、クエリ言語を自作した話」（2025-10-06）の §6.2 ロードマップの再開にあたる。
