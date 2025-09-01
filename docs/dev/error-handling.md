# Error Handling Guidelines

本書は cirquery のエラーハンドリング方針を定義します。層（parser / normalize / evaluator / adapters）ごとに「何を例外にし、どこで扱い、どう伝えるか」を明確にし、堅牢性と可読性・保守性の両立を目指します。

## 目的と原則

- 例外境界を設計する
  - 例外は「発生源に近い層」で意味のある単位にまとめ、必要なら再スローする。
  - 上位層で握りつぶさない（ログや再スロー、結果化のいずれかに必ず接続する）。
- 役割別の例外型を使う
  - ParseError / NormalizeError / EvaluationError など層ごとに例外型を分離し、呼び出し側が分類しやすくする。
- メッセージは簡潔・一貫・再現可能
  - 何が失敗したか、どの入力/位置か、次の行動（修正・報告）が分かる内容にする。

## 例外型と責務

- ParseError
  - 対象: トークナイズ/構文解析に失敗した入力
  - 含める情報: message, code, range(開始/終了), token周辺のスニペット（可能なら）
  - 発生レイヤ: parser
- NormalizeError
  - 対象: AST→CIR 変換時の仕様不整合・未対応構造
  - 含める情報: message, code, ノード種別, 断片の文字列表現
  - 発生レイヤ: normalize
- EvaluationError
  - 対象: CIRの評価時に発生する実行上の不整合（型不一致・不正な演算子適用など）
  - 含める情報: message, code, 演算子/オペランド概要
  - 発生レイヤ: evaluator
- AdapterError（サンプル/外部）
  - 対象: アダプタ側の生成・実行失敗
  - 含める情報: message, code, 変換対象の要約
  - 発生レイヤ: adapters

いずれも `class XxxError extends Error { code: string; /* … */ }` の形で実装し、`name` を型名で上書きする。

## エラーコード命名

- 形式: `E_<LAYER>_<KIND>`
  - 例: `E_PARSE_UNEXPECTED_TOKEN`, `E_NORMALIZE_UNSUPPORTED_NODE`, `E_EVAL_TYPE_MISMATCH`, `E_ADAPTER_UNSUPPORTED_FEATURE`
- 命名指針
  - LAYER: PARSE / NORMALIZE / EVAL / ADAPTER
  - KIND: 失敗原因の一般名（UNEXPECTED_TOKEN, INVALID_RANGE, UNSUPPORTED_OPERATOR など）
- 安定性
  - コードは後方互換を重視し、リネームが必要な場合は旧コードをエイリアスとして一定期間併存させる。
  

## 例外か戻り値か（方針）

- 例外にするケース
  - 仕様違反・解析不能（parser）
  - 仕様で禁止された構造・未対応のノード（normalize）
  - 実行時に結果が定義できない状態（evaluatorの型不一致など）
- 戻り値（Result）的に扱う候補
  - 非致命・回復可能で、呼び出し側が分岐したいケース
  - cirqueryコアでは基本的に例外を採用し、呼び出し側（アプリ/CLI）で例外境界を設けてユーザー通知等に変換する

## メッセージ方針

- 簡潔で具体的（第一文で要因を示す）
  - 例: `Unexpected token ')' at 1:12. Expected Identifier or String.`
- 位置/文脈
  - 可能なら `line:column` とエラー周辺のスニペットを示す
- 内部情報を漏らさない
  - デバッグ向け詳細はログへ。外部公開メッセージは簡潔に。

## ログと通知の分離

- ライブラリ（コア）はログ出力を行わない
  - 例外に必要情報を載せ、利用側（アプリ/CLI/テスト）がログ・通知を担う
- CLIやアダプタの例（参考）
  - 例外→ユーザー向け短文 + 詳細はデバッグフラグで出力

## 具体例

- 例外型
```
export class ParseError extends Error {
  code = 'E_PARSE_UNEXPECTED_TOKEN' as const;
  constructor(
    message: string,
    public readonly line?: number,
    public readonly column?: number,
    public readonly snippet?: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export class NormalizeError extends Error {
  code = 'E_NORMALIZE_UNSUPPORTED_NODE' as const;
  constructor(message: string, public readonly nodeType?: string) {
    super(message);
    this.name = 'NormalizeError';
  }
}

export class EvaluationError extends Error {
  code = 'E_EVAL_TYPE_MISMATCH' as const;
  constructor(message: string, public readonly op?: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}
```

- 例外の投げ方（parser）
```
function failUnexpected(token: Token, expected: string) {
  const { line, column } = token;
  const msg = `Unexpected token '${token.image}' at ${line}:${column}. Expected ${expected}.`;
  throw new ParseError(msg, line, column, token.image);
}
```

- 例外境界（呼び出し側の一例）
```
try {
  const { ast } = parse(input);
  const cir = normalize(ast);
  const ok = evaluate(cir, data);
  // …
} catch (e) {
  if (e instanceof ParseError) {
    // 解析失敗。入力修正を促す
  } else if (e instanceof NormalizeError) {
    // 仕様未対応。バージョン/仕様差分を案内
  } else if (e instanceof EvaluationError) {
    // 実行時不整合。データ/演算の型を見直す
  } else {
    // 想定外。再スローまたは一般エラーとして扱う
    throw e;
  }
}
```

## テスト方針（エラー編）

- parser
  - 不正トークン/未閉括弧/未知の演算子で ParseError を投げる
  - 位置情報（line/column）が概ね正しい（厳密一致にこだわり過ぎない）
- normalize
  - 未対応ノード/不整合構造で NormalizeError を投げる
- evaluator
  - 型不一致や不正演算で EvaluationError を投げる
- メッセージ最小保証
  - コード（code）と型（instanceof）が一致
  - 第一文が要因を明示
  - 回帰防止のため代表ケースはスナップショットを避け、フィールド一致で検証

## 非機能要件

- パフォーマンス
  - 例外発生は例外的な経路である前提。通常経路に不要な try/catch を多用しない
- i18n
  - ライブラリレイヤでは英語メッセージを基本とする（アプリ側で翻訳/変換可能にする）

## 変更ポリシー

- 例外型の追加
  - 既存の型との責務重複がないか確認。紛らわしい場合は既存型を拡張（フィールド追加）を検討
- エラーコードの追加/変更
  - 追加は自由。変更は非推奨。やむを得ない場合はリリースノート記載と移行期のエイリアス化を検討
- 破壊的変更
  - 例外の型名/フィールド名を変更する場合はメジャーバージョンで対応

## FAQ（よくある判断基準）

- Q: normalize で「仕様上は組み立て可能だが未実装」のケースは？
  - A: NormalizeError（`E_NORMALIZE_UNSUPPORTED_NODE`）にする。仕様差分の明記と合わせ、今後の拡張可否を判断しやすくする。
- Q: evaluator で null/undefined は例外か？
  - A: 仕様で定まっていない型不一致は EvaluationError。仕様で定義された三値論理がある箇所は例外ではなく規則に従って返す。
- Q: 例外を握りつぶして既定値を返してよいか？
  - A: ライブラリ内では不可。呼び出し側が明示的に try/catch し、必要なら既定値を採用する。

