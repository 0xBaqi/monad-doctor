import { validateHealthSnapshot } from './health-reconciliation.ts';
import { immutable, type HealthComparisonRequest } from './health-coordinator-model.ts';
import { ValidationError } from './validation.ts';

export const COMPARISON_OPERATION = 'health-comparison-v1' as const;
export const COMPARISON_HEADER = 'X-Monad-Doctor-Operation' as const;
export function parseHealthComparisonRequest(raw: unknown, runId = 'validation'): HealthComparisonRequest {
 if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new ValidationError('Invalid comparison request.');
 const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
 if (keys.length !== 3 || keys.some(k => typeof k !== 'string' || !['mode', 'providers', 'alignSharedHeight'].includes(k) || !descriptors[k].enumerable || !('value' in descriptors[k]))) throw new ValidationError('Expected comparison data properties.');
 if (descriptors.mode.value !== 'health_comparison' || typeof descriptors.alignSharedHeight.value !== 'boolean') throw new ValidationError('Invalid comparison request.');
 const normalized = validateHealthSnapshot({ runId, provider: 'primary', input: { mode: 'health', providers: descriptors.providers.value }, collections: [], observations: {} });
 return immutable({ mode: 'health_comparison', providers: normalized.input.providers as readonly ['primary', 'secondary'], alignSharedHeight: descriptors.alignSharedHeight.value });
}
