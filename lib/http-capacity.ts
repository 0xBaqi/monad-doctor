import { ValidationError } from './validation.ts';

/** Process-local admission only; neither a distributed semaphore nor durable state. */
export type CapacityLease = Readonly<{ release(): void }>;
export type ProcessCapacity = Readonly<{ tryAcquire(): CapacityLease | undefined }>;
type LeaseState = { owner: ProcessCapacity; claimed: boolean; released: boolean; release: () => void };
// Identity is the authority. Foreign objects/proxies are never inspected or invoked.
const owners = new WeakMap<ProcessCapacity, () => CapacityLease | undefined>();
const leases = new WeakMap<CapacityLease, LeaseState>();
export function createProcessCapacity(now: () => number = () => Date.now()): ProcessCapacity {
 let active = 0, windowStart = 0, windowCount = 0, readingClock = false;
 const owner: ProcessCapacity = Object.freeze({ tryAcquire() {
  if (readingClock) return undefined;
  let time: number;
  readingClock = true;
  try { time = now(); } finally { readingClock = false; }
  if (!Number.isFinite(time)) return undefined;
  if (time - windowStart >= 60000) { windowStart = time; windowCount = 0; }
  if (active >= 4 || windowCount >= 30) return undefined;
  active++; windowCount++;
  // Legacy holders release directly. A successful comparison claim transfers
  // that authority to a private, receiver-bound capability exactly once.
  const state: LeaseState = { owner, claimed: false, released: false, release: () => {} };
  const token = Object.freeze({ release() { if (!state.claimed) state.release(); } });
  state.release = function(this: CapacityLease) {
   if (this !== token) throw new ValidationError('Invalid capacity release receiver.');
   if (!state.released) { state.released = true; active--; }
  }.bind(token);
  leases.set(token, state);
  return token;
 } });
 owners.set(owner, owner.tryAcquire.bind(owner));
 return owner;
}
// The legacy handler and future comparison integration must use this same owner.
export const processCapacity = createProcessCapacity();

/** Synchronous transfer; no external property access between lookup and claim. */
export function claimProcessCapacity(owner: ProcessCapacity = processCapacity, token?: CapacityLease): (() => void) | undefined {
 const acquire = owners.get(owner);
 if (!acquire) throw new ValidationError('Comparison capacity owner must be factory-issued.');
 // Validate supplied tokens before any allocation. Unsupported wrappers remain
 // caller-owned: their getters cannot safely reveal rollback capabilities.
 if (token !== undefined) {
  const state = leases.get(token);
  if (!state || state.owner !== owner || state.claimed || state.released) throw new ValidationError('Invalid or consumed comparison capacity token.');
  state.claimed = true;
  return state.release;
 }
 const allocated = acquire();
 if (!allocated) return undefined;
 const state = leases.get(allocated)!;
 state.claimed = true;
 return state.release;
}
