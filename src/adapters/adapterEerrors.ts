// src/adapters/adapterErrors.ts
import { AdapterError } from '../errors/errors.ts';

export function failUnsupportedFeature(target: string, feature: string, detail?: string): never {
  const msg = detail
    ? `[${target}] Unsupported feature '${feature}': ${detail}`
    : `[${target}] Unsupported feature '${feature}'.`;
  throw new AdapterError(msg, target, feature, 'E_ADAPTER_UNSUPPORTED_FEATURE');
}

export function failAdapter(message: string, target?: string, feature?: string): never {
  throw new AdapterError(message, target, feature, 'E_ADAPTER_GENERIC');
}
