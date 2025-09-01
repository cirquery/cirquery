# Adapters Guidelines (CIR → Backend)

本書は、cirquery の中間表現（CIR）を任意のバックエンド（DB/検索エンジン等）のクエリへ写像する「アダプタ」設計の指針を定義します。cirquery本体の責務は DSL→AST→CIR とインメモリ Evaluator までであり、adapters は任意の外部連携層（オプション）です。

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

## lowdb 参照実装（サンプル）

- 位置づけ
  - in-memory の学習用・E2E用。大規模データ・インデックスは想定外。
- 方式
  - CIR → JS述語（evaluate）→ lowdb の filter に適用（低コストで動作確認ができる）。
- サンプルコード（イメージ）
```
import { evaluate, normalize, parse } from 'cirquery';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

type Row = Record<string, unknown>;

export async function runLowdbQuery(dbPath: string, query: string) {
  const adapter = new Low<Row[]>({ file: dbPath, adapter: new JSONFile<Row[]>(dbPath) });
  await adapter.read();
  const rows = adapter.data ?? [];

  const cir = normalize(parse(query).ast);
  const out = rows.filter(r => evaluate(cir, r));
  return out;
}
```

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

