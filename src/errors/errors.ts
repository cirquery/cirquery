// src/errors/errors.ts
// cirquery - error types and helpers
// 目的: 層ごとに例外型を分離し、呼び出し側が分類しやすい構造を提供
// ログはライブラリ層では行わず、呼び出し側で処理する方針

export type ErrorCode =
  | 'E_PARSE_UNEXPECTED_TOKEN'
  | 'E_PARSE_GENERIC'
  | 'E_NORMALIZE_UNSUPPORTED_NODE'
  | 'E_NORMALIZE_GENERIC'
  | 'E_EVAL_TYPE_MISMATCH'
  | 'E_EVAL_GENERIC'
  | 'E_ADAPTER_UNSUPPORTED_FEATURE'
  | 'E_ADAPTER_GENERIC';

export abstract class CirqueryError extends Error {
  public abstract readonly code: ErrorCode;
  constructor(message: string) {
    super(message);
    // Errorのプロトタイプ連鎖調整（Babel/TS互換）
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Parser: トークナイズ/構文解析
export class ParseError extends CirqueryError {
  public readonly code: ErrorCode;
  constructor(
    message: string,
    public readonly line?: number,
    public readonly column?: number,
    public readonly snippet?: string,
    code: Extract<ErrorCode, 'E_PARSE_UNEXPECTED_TOKEN' | 'E_PARSE_GENERIC'> = 'E_PARSE_GENERIC',
  ) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }
}

// Normalizer: AST→CIR 変換
export class NormalizeError extends CirqueryError {
  public readonly code: ErrorCode;
  constructor(
    message: string,
    public readonly nodeType?: string,
    code: Extract<ErrorCode, 'E_NORMALIZE_UNSUPPORTED_NODE' | 'E_NORMALIZE_GENERIC'> = 'E_NORMALIZE_GENERIC',
  ) {
    super(message);
    this.name = 'NormalizeError';
    this.code = code;
  }
}

// Evaluator: CIRの評価
// グローバルのEvalErrorと衝突を避ける命名
export class EvaluationError extends CirqueryError {
  public readonly code: ErrorCode;
  constructor(
    message: string,
    public readonly op?: string,
    code: Extract<ErrorCode, 'E_EVAL_TYPE_MISMATCH' | 'E_EVAL_GENERIC'> = 'E_EVAL_GENERIC',
  ) {
    super(message);
    this.name = 'EvaluationError';
    this.code = code;
  }
}

// adapters 用のユーティリティ（任意）
export class AdapterError extends CirqueryError {
    public readonly code: ErrorCode;
    constructor(
        message: string,
        public readonly target?: string, // 例: 'lowdb' / 'mongo' など
        public readonly feature?: string, // 未対応の機能名や演算子
        code: Extract<ErrorCode, 'E_ADAPTER_UNSUPPORTED_FEATURE' | 'E_ADAPTER_GENERIC'> = 'E_ADAPTER_GENERIC',
    ) {
        super(message);
        this.name = 'AdapterError';
        this.code = code;
    }
}


// スニペット整形（必要に応じて使用）
export function formatLocation(line?: number, column?: number): string {
  if (line == null || column == null) return '';
  return `${line}:${column}`;
}
