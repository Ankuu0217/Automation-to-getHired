/**
 * Minimal FIFO semaphore: at most `max` tasks run at once; the rest wait in
 * order. A finished task hands its slot straight to the next waiter, so the
 * limit is never exceeded, even briefly.
 */
export function createSemaphore(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  return {
    run,
    /** Tasks currently running. */
    get active(): number {
      return active;
    },
    /** Tasks waiting for a slot. */
    get pending(): number {
      return waiting.length;
    },
  };
}
