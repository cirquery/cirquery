// src/cir/evaluationErrors.ts
import { EvaluationError } from '../errors/errors.ts';

export function failTypeMismatch(op: string, expected: string, got: string): never {
  const msg = `Type mismatch for '${op}': expected ${expected}, got ${got}.`;
  throw new EvaluationError(msg, op, 'E_EVAL_TYPE_MISMATCH');
}

export function failGenericEval(message: string, op?: string): never {
  throw new EvaluationError(message, op, 'E_EVAL_GENERIC');
}
