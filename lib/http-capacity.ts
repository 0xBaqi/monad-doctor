/** Process-local admission only; neither a distributed semaphore nor durable state. */
export type CapacityLease = Readonly<{ release(): void }>;
export type ProcessCapacity = Readonly<{ tryAcquire(): CapacityLease | undefined }>;
export function createProcessCapacity(now: () => number = () => Date.now()): ProcessCapacity {
 let active = 0, windowStart = 0, windowCount = 0, readingClock = false;
 return Object.freeze({ tryAcquire() {
  if (readingClock) return undefined;
  let time: number;
  readingClock = true;
  try { time = now(); } finally { readingClock = false; }
  if (!Number.isFinite(time)) return undefined;
  if (time - windowStart >= 60000) { windowStart = time; windowCount = 0; }
  if (active >= 4 || windowCount >= 30) return undefined;
  active++; windowCount++;
  let released = false;
  return Object.freeze({ release() { if (!released) { released = true; active--; } } });
 } });
}
// The legacy handler and future comparison integration must use this same owner.
export const processCapacity = createProcessCapacity();
