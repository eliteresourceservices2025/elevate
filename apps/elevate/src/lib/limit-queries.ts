// Keeps the number of queries running at once below the number of database connections, so the driver never has to queue a query
// behind a busy connection.
//
// Why: behind Supabase's transaction pooler (Supavisor), a driver that queues more queries than it has connections can leave the
// pooler waiting for part of a message that never arrives. The server connection then sits "active" in ClientRead until the
// statement timeout (two minutes) cancels it, and every other query waits behind it. A page that asks for 20 or more things at once
// (the dashboard does) freezes. Queueing here instead, in plain JavaScript, avoids it: with this in place 150 queries at once pass
// through the pooler in a fraction of a second, where 30 used to hang it.

type Pending = PromiseLike<unknown> & object;
type UnsafeFn = (...args: never[]) => Pending;

export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    // The slot is handed over by release() without being freed, so the count never dips below the number really running.
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return { acquire, release, stats: () => ({ active, waiting: waiting.length }) };
}

/**
 * Wraps `client.unsafe` (what drizzle calls for every query). The returned query still behaves like the driver's: chained calls such
 * as `.values()` still configure it, and it only starts (waiting for its turn) when it is awaited.
 */
export function limitQueries<C extends { unsafe: UnsafeFn }>(client: C, max: number): C {
  const limiter = createLimiter(max);
  const original = client.unsafe.bind(client) as UnsafeFn;

  client.unsafe = ((...args: never[]) => {
    const target = original(...args);
    let started: Promise<unknown> | null = null;
    const run = () =>
      (started ??= limiter.acquire().then(async () => {
        try {
          return await target;
        } finally {
          limiter.release();
        }
      }));

    const wrapped: Pending = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => run().then(onFulfilled, onRejected);
        if (prop === "catch") return (onRejected?: (e: unknown) => unknown) => run().catch(onRejected);
        if (prop === "finally") return (onFinally?: () => void) => run().finally(onFinally);
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return (...a: unknown[]) => {
          const result = (value as (...x: unknown[]) => unknown).apply(target, a);
          return result === target ? wrapped : result;
        };
      },
    });
    return wrapped;
  }) as UnsafeFn as C["unsafe"];

  return client;
}
