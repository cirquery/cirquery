# Testing Guidelines

本書は cirquery のテスト設計・実装・運用の指針をまとめたものです。層（parser/normalize/evaluator/integration）ごとに「何を・どこで・どう検証するか」を明確にし、最小コストで高い信頼性を得ることを目的とします。

## 目的と原則

- 正しさを分担検証する
  - 構文（parser）、変換（normalize）、評価（evaluator）、通し（integration）を分離し、層ごとの失敗を早期に特定する。
- 小さく速く、決定的に
  - 1ケースは短く・独立させ、並行実行でも不安定にならない（I/Oに依存しない、グローバル状態を持たない）。
- 仕様をテストに反映
  - docs/spec, docs/design の規則をテスト名・コメントに反映し、仕様差分に追随しやすくする。

## ツールと実行

- テストランナー: Vitest
- 実行コマンド:
  - 全体: `npm test`
  - 監視: `npx vitest`
  - 単体ファイル: `npx vitest run test/normalize.test.ts`
- 型検査（推奨）: `npm run typecheck` をCIでテスト前に実行

## テストの配置と粒度

- parser（構文）: `test/parser.test.ts`
  - 目的: 入力 DSL が期待どおりの AST に解析されるか、誤入力を適切に拒否するか
  - 主な観点:
    - 演算子優先順位（NOT > AND > OR）
    - 結合規則（左結合）
    - 値リストの解釈（AND/OR、記法の許容/非許容）
    - テキスト系ショートハンド（contains 等）の受理・拒否
    - エラーメッセージの最小妥当性（例外の種類/位置情報が大きく逸脱しない）
  - 実装注意:
    - ASTは最小限の構造一致で検証（スナップショット過多は避ける）
    - 無効入力は具体的な失敗形を1-2例で抑える

- normalize（正規化）: `test/normalize.test.ts`
  - 目的: AST がルールに従って CIR へ機械的に変換されるか
  - 主な観点:
    - 省略形展開（ショートハンド→詳細表現）
    - 否定の押し下げ（NOT の分配、比較の反転）
    - 構造の平坦化（冗長な入れ子の解消）
    - 複数セグメントパスの取り扱い（量化子の暗黙適用などの構文上の合意点）
  - 実装注意:
    - 変換は純関数であること（入力不変）をテストで担保
    - 期待CIRは最小構造の一致で比較（余計なフィールド比較は避ける）

- evaluator（評価）: `test/evaluator*.test.ts`
  - 目的: CIR がデータに対して正しい真偽値/結果を返すか
  - 主な観点:
    - 真偽/null の三値の扱い（必要な箇所）
    - 比較（eq/ne/gt/lt/ge/le）の境界条件
    - テキスト検索（ケース・ダイアクリティクスの前処理を含む）
    - 量化子（any/all）と空集合ポリシー
  - 実装注意:
    - 小さなデータセットで網羅的に観点を積み上げる
    - 前処理の有無（例: アクセント除去）を明示してテストデータを作る

- integration（通し/E2E）: `test/integration/*.e2e.test.ts`
  - 目的: DSL→AST→CIR→評価/アダプタ までの一貫性
  - 主な観点:
    - 代表シナリオ（複合条件、値リスト、否定、量化子の混在）
    - examples データ/クエリとの整合
  - 実装注意:
    - examples に依存することを README と本ガイドに明記
    - データ/クエリの更新時はE2Eの期待結果を更新

## エラー検証

例外は「型（instanceof）」と「code（E_...）」の両方を検証します。メッセージは第一文で要因が明確か（最低限）を確認し、スナップショット濫用は避けます。

- 検証ポリシー
  - instanceof: ParseError / NormalizeError / EvaluationError / AdapterError の型を厳密に確認
  - code: E_PARSE_*, E_NORMALIZE_*, E_EVAL_*, E_ADAPTER_* のコード値を等価比較
  - message: 第一文が要因を簡潔に示すこと（完全一致は避け、前方一致などで脆性を下げる）

- 代表テスト例
```
import { describe, it, expect } from 'vitest';
import {
  parse, normalize, evaluate,
  ParseError, NormalizeError, EvaluationError, AdapterError
} from 'cirquery';

// parser: 不正トークン
describe('errors: parser', () => {
  it('throws ParseError with code', () => {
    expect(() => parse(')')).toThrowError(ParseError);
    try {
      parse(')');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).code).toBe('E_PARSE_UNEXPECTED_TOKEN');
      expect((e as Error).message.startsWith('Unexpected token')).toBe(true);
    }
  });
});

// normalize: 未対応ノード（例）
describe('errors: normalize', () => {
  it('throws NormalizeError for unsupported node', () => {
    const ast = { type: 'unknown_node' } as any;
    expect(() => normalize(ast)).toThrowError(NormalizeError);
    try {
      normalize(ast);
    } catch (e) {
      expect(e).toBeInstanceOf(NormalizeError);
      expect((e as any).code).toMatch(/^E_NORMALIZE_/);
    }
  });
});

// evaluator: 型不一致
describe('errors: evaluator', () => {
  it('throws EvaluationError on type mismatch', () => {
    const cir = normalize(parse('price > "ten"').ast);
    expect(() => evaluate(cir, { price: 5 })).toThrowError(EvaluationError);
    try {
      evaluate(cir, { price: 5 });
    } catch (e) {
      expect(e).toBeInstanceOf(EvaluationError);
      expect((e as any).code).toBe('E_EVAL_TYPE_MISMATCH');
    }
  });
});

// adapters: 未対応機能（サンプル）
describe('errors: adapters', () => {
  it('throws AdapterError for unsupported feature', () => {
    // 仮の参照実装呼び出し例: mapQuantifierToPredicate('all') など
    const fn = () => { throw new AdapterError('[lowdb] Unsupported feature', 'lowdb', 'quantifier:all', 'E_ADAPTER_UNSUPPORTED_FEATURE'); };
    expect(fn).toThrowError(AdapterError);
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AdapterError);
      expect((e as any).code).toBe('E_ADAPTER_UNSUPPORTED_FEATURE');
      expect((e as Error).message.includes('Unsupported feature')).toBe(true);
    }
  });
});
```

- CIでの推奨
  - `npm run typecheck` → `npm test` の順で実行し、例外型/コードの破壊的変更を早期検知する。


## テストデータの扱い

- 最小セットを原則にする
  - 各層の単体テストは 3〜10件程度の小さな例で十分なカバレッジを狙う。
- examples 依存の方針
  - integration は `examples/data/*.json`, `examples/queries/*` に依存可能
  - 変更時の手順:
    1) examples を更新
    2) E2E 期待値/アサーションを更新
    3) README の「E2E前提」を必要なら更新
- 固定子（fixtures）
  - テストディレクトリ直下に小さな fixtures を置いてもよい
  - 大きなデータは examples に寄せる（配布制御のため）

## スナップショット運用

- 代表ケースに限定し、構造が大きく・安定な出力にのみ使用
- 細粒度検証は toEqual 等の厳密一致で担保
- スナップショット更新時は変更理由をPR本文に必ず記載

## モック/スタブの方針

- コアは純関数が多いため、基本は不要
- 外部I/Oや時刻依存は抽象化し、テスト時に固定できるように設計する
- ランダム性はシード固定または注入可能にする

## 境界条件とプロパティテスト（任意）

- 境界条件（empty/null/0/最大長/未定義フィールド）を各層に 1-2 ケースずつ追加
- プロパティテスト（任意）
  - 同値変換（normalize の二度適用で不変など）
  - 双方向性や冪等性の性質がある場合に活用

## パフォーマンステスト（任意）

- 大きな入力（長文・多数条件）で Lexer/Parser/Evaluator の時間を簡易測定
- 比較は「前後差の方向性」確認に留め、CIの可否は要検討（不安定になりやすい）

## 実行順序（CI推奨）

1) `npm ci`
2) `npm run typecheck`
3) `npm test`
4) 必要に応じて `npm run build`（配布物の検証）

## レビュー時のチェックリスト

- 仕様整合: docs/spec, docs/design と矛盾していないか
- 観点網羅: どの層にどのケースを追加したか明確か
- 再現性: データ依存・時刻/ランダム依存が排除されているか
- 可読性: テスト名（it/describe）が意図を端的に表しているか
- 独立性: 並行実行・順序変更でも結果が安定するか

## よくある落とし穴

- スナップショット濫用
  - 小さな構造差で不要な更新が増える。代表ケースのみ採用する。
- 単体 vs. 統合の境界ぼやけ
  - 単体テストに examples 依存を持ち込むと壊れやすくなる。E2Eに限定。
- グローバル状態・キャッシュ
  - Parser/lexer のシングルトン再利用は可だが、テスト間で副作用が残らないよう初期化を明示する。

## サンプル

- parser（優先順位）
```
it('parses NOT > AND > OR precedence', () => {
  const ast = parse('NOT A AND B OR C').ast;
  expect(structureOf(ast)).toEqual({
    type: 'or',
    children: [
      { type: 'and', children: [{ type: 'not' }, { type: 'id', name: 'A' }, { type: 'id', name: 'B' }] },
      { type: 'id', name: 'C' },
    ],
  });
});
```

- normalize（否定の押し下げ）
```
it('pushes NOT down and inverts comparisons', () => {
  const cir = normalize(parse('NOT price >= 10').ast);
  expect(printCir(cir)).toBe('(price < 10)');
});
```

- evaluator（量化子）
```
it('any quantifier over empty yields false', () => {
  const cir = parseAndNormalize('any(items, value > 0)');
  expect(evaluate(cir, { items: [] })).toBe(false);
});
```

- integration（examples 依存）
```
it('filters example dataset by combined conditions', () => {
  const data = readJson('examples/data/cocktails.json');
  const q = readText('examples/queries/q4_all_none.txt');
  const cir = normalize(parse(q).ast);
  const out = data.filter(x => evaluate(cir, x));
  expect(out.length).toBeGreaterThan(0);
});
```

## 改訂ポリシー

- 本ガイドを更新する場合は、対象層（parser/normalize/evaluator/integration）のテストも同時に見直す。
- examples 依存の変更は README の E2E手順も合わせて更新する。
