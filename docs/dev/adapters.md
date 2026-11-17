# Adapters Guidelines (CIR → Backend)

本書は、cirquery の中間表現（CIR）を任意のバックエンド（DB/検索エンジン等）のクエリへ写像する「アダプタ」設計の指針を定義します。cirquery本体の責務は DSL→AST→CIR とインメモリ Evaluator までであり、adapters は任意の外部連携層（オプション）です。

## 実装状況（v0.3）

| アダプタ | 実装 | 検証 |
|---|---|---|
| SQLite（JSONドキュメント列モデル） | `src/adapters/sqlite/`（`toSqliteQuery`） | 適合テストでインメモリ評価器と結果一致を保証（実DB実行） |
| MongoDB | `src/adapters/mongodb/`（`toMongoFilter`） | 生成フィルタの構造テスト |
| Elasticsearch | `src/adapters/elasticsearch/`（`toElasticsearchQuery`） | 生成クエリの構造テスト |

### SQLite アダプタの写像（要点）

- パス → `json_extract(列, $."a"."b")`（パス文字列もパラメータ化）。量化子 → `json_each` + `EXISTS`。`all` は「要素が存在する AND 述語を満たさない要素が存在しない」。
- eq/neq → NULL 安全な `IS` / `IS NOT`（評価器の「欠落と null は同一の値なし」規則と一致させるため）。
- テキスト → 文字列フィールドは `instr` / `substr`、配列フィールドは `json_each` の要素照合との OR（評価器の any 規則に対応）。型判定は `json_type`。
- 演算 → SQL の算術。div は `* 1.0` で実数除算に寄せる。ゼロ除算は NULL になり評価器の「値なし」と一致する。
- NOT と量化子の述語では `COALESCE(..., 0)` で NULL を偽に寄せる。

### 既知の意味差（アダプタ共通の注意）

- **SQLite**: 「フィールド欠落」と JSON `null` はどちらも SQL NULL になり区別できない（比較の等値では評価器も同一視するため実害は小さい）。`foldDiacritics` は未対応（AdapterError）。実数同士の剰余（`%`）は SQLite が整数化するため、評価器と差が出る場合がある。順序比較の右辺が `null` の場合、評価器は型不一致エラーだが SQLite は単に一致しない。
- **MongoDB**: `eq` の `null` は欠落フィールドにも一致する（MongoDB の仕様）。正規表現によるテキスト照合は部分文字列一致と等価だが、アンカーやエスケープの扱いはアダプタの実装に従う。
- **Elasticsearch**: 関連度（スコア）は扱わない（全て filter 文脈）。`match_phrase` の一致はインデックス側のアナライザに依存し、評価器の部分文字列一致と完全には一致しない。量化子は nested 型フィールドの指定がある場合のみ nested クエリになり、それ以外は平坦化されるため要素またぎの誤検出がありうる。

## 目的と方針

- 責務分離
  - コアはCIRの生成と評価を提供。バックエンド固有の最適化・索引・接続はアダプタ側の責務。
- 片方向変換
  - アダプタは「CIR → ターゲットクエリ」への写像に専念し、CIRの拡張は行わない（必要な拡張はCIRの設計議論で扱う）。
- 安全なマッピング
  - 演算子・型・パス表現の対応表を定義し、曖昧な解釈を避ける。
  - 未対応は黙殺せず、AdapterError で明示的に失敗させる。

## パッケージ方針
- 本体からの分離
  - 本リポジトリの adapters/ は学習・E2E用の参照実装です。
  - cirquery の公開API（exports）には adapters を含めない。
  - npm配布時は package.jsonの "files" を "dist" に限定し、サンプル/テスト/スクリプトを除外する（公開前はリポジトリ内に残して問題なし）。
- 将来の切り出し
  - 需要が高まったバックエンドは `cirquery-adapter-<name>` として別パッケージ化を検討可能。  

公開前に `npm pack --dry-run` で配布物を確認してください（dist のみが含まれること）。

## CIR → バックエンドの設計原則

- 比較演算
  - CIRの op（eq/ne/gt/lt/ge/le）を等価なターゲット演算子へ写像。型の比較規則（数値/文字列/日付）を事前に決める。
- 論理演算
  - and/or/not をそのまま写像。NOTの押し下げは normalize 済みを前提に、末端での否定に対応する。
- 値リスト
  - in/not-in の組み合わせへ展開（ターゲットにINがある場合は直接対応、ない場合は OR/AND 展開）。
- テキスト
  - contains/startsWith/endsWith 等はターゲットの全文検索/LIKE/前方一致APIへマップ。大文字小文字/ダイアクリティクスの前処理はアダプタ側の責務とせず、CIRの仕様に従う。
- 量化子
  - any/all の配列・ネスト構造をターゲットの配列/ネストクエリへ変換（例: Mongoの$elemMatch 等に相当）。非対応のバックエンドでは AdapterError とする。
- パス表現
  - Path は `{ segments: string[] }` をドット連結等でターゲットのフィールド名に変換。必要に応じてエスケープ方針を定義。

## エラーと境界

- 例外型
  - adapters 層では AdapterError を使用（実装は `src/errors/errors.ts` を参照し、必要なら追加）。
- 未対応
  - ターゲットがサポートしないCIR機能は黙殺せず、`E_ADAPTER_UNSUPPORTED_*` などで明示的に失敗させる。
- 例外境界
  - アプリ/CLI層で例外を捕捉し、ユーザー向けメッセージへ変換する。


## 実装ガイド

- 変換の入口
  - `adapt(cir: CirNode, ctx: AdapterContext): TargetQuery`
- コンテキスト
  - ロケール/前処理（folding等）、ターゲットの方言（例: LIKEのエスケープ）を持たせる。
- 変換関数の分割
  - 比較/論理/値リスト/テキスト/量化子でモジュール分割し、単体テストを層別に用意。
- マッピング表（例）
  - eq → `==` / `$eq` / `term`
  - contains → `LIKE '%x%'` / `$regex` / `match`
  - any → `$elemMatch` / joinの存在検査 等

## テスト方針（adapters）

- 単体
  - 各演算子・量化子のマッピング結果（ターゲットの中間表現）を検証。
- 統合（E2E）
  - examples のデータ/クエリを使い、出力件数や代表行の一致を検証。
- エラー
  - 未対応演算子/量化子で AdapterError を検証（code/メッセージの最小保証）。

## 運用メモ

- パフォーマンス
  - コアの normalize/evaluate は純粋。アダプタ側でキャッシュ・インデックス・プリコンパイル（プリペアドクエリ）などの最適化を行う。
- セキュリティ
  - 外部DBへ渡す前に、パラメタライズドクエリや適切なエスケープを徹底する。
- 将来拡張
  - 検索バックエンド（Elasticsearch/Lucene系）やRDB（SQL系）など、対象ごとに別パッケージ化を検討可能。

