// src/cir/normalizeErrors.ts
import { NormalizeError } from '../errors/errors.ts';

export function failUnsupportedNode(nodeType: string, detail?: string): never {
  const msg = detail ? `Unsupported node '${nodeType}': ${detail}` : `Unsupported node '${nodeType}'.`;
  throw new NormalizeError(msg, nodeType, 'E_NORMALIZE_UNSUPPORTED_NODE');
}

export function failGenericNormalize(message: string, nodeType?: string): never {
  throw new NormalizeError(message, nodeType, 'E_NORMALIZE_GENERIC');
}
