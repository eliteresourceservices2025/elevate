import { describe, expect, it } from "vitest";
import { createLimiter, limitQueries } from "./limit-queries";

/** A stand-in for the driver's lazy query: it only runs when awaited, and `.values()` configures it and returns itself. */
function fakeClient(onStart: () => void, onEnd: () => void, delayMs = 5) {
  return {
    unsafe(text: string, _params?: unknown[]) {
      const q = {
        mode: "objects",
        values() {
          q.mode = "values";
          return q;
        },
        then(resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          onStart();
          return new Promise((res, rej) =>
            setTimeout(() => {
              onEnd();
              if (text.includes("fail")) rej(new Error("boom"));
              else res({ text, mode: q.mode });
            }, delayMs),
          ).then(resolve, reject);
        },
      };
      return q as unknown as PromiseLike<unknown> & { values(): PromiseLike<unknown> };
    },
  };
}

describe("createLimiter", () => {
  it("hands out at most `max` slots and passes each freed slot to the next waiter in order", async () => {
    const limiter = createLimiter(2);
    await limiter.acquire();
    await limiter.acquire();
    const order: number[] = [];
    const third = limiter.acquire().then(() => order.push(3));
    const fourth = limiter.acquire().then(() => order.push(4));
    expect(limiter.stats()).toEqual({ active: 2, waiting: 2 });
    limiter.release();
    await third;
    expect(order).toEqual([3]);
    limiter.release();
    await fourth;
    expect(order).toEqual([3, 4]);
    limiter.release();
    limiter.release();
    expect(limiter.stats()).toEqual({ active: 0, waiting: 0 });
  });
});

describe("limitQueries", () => {
  it("never runs more than the limit at once, however many are asked for", async () => {
    let running = 0;
    let peak = 0;
    const client = limitQueries(
      fakeClient(
        () => peak = Math.max(peak, ++running),
        () => void running--,
      ),
      4,
    );
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => client.unsafe(`select ${i}`)));
    expect(results).toHaveLength(60);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("starts a query only when it is awaited, so chained settings like .values() still apply", async () => {
    let started = 0;
    const client = limitQueries(fakeClient(() => void started++, () => {}), 2);
    const q = client.unsafe("select 1") as unknown as { values(): PromiseLike<{ mode: string }> };
    const chained = q.values();
    expect(started).toBe(0);
    expect((await chained).mode).toBe("values");
    expect(started).toBe(1);
  });

  it("passes errors through and still frees the slot", async () => {
    const client = limitQueries(fakeClient(() => {}, () => {}), 1);
    await expect(Promise.resolve(client.unsafe("fail now"))).rejects.toThrow("boom");
    await expect(Promise.resolve(client.unsafe("select ok"))).resolves.toMatchObject({ text: "select ok" });
  });

  it("works with catch and finally", async () => {
    const client = limitQueries(fakeClient(() => {}, () => {}), 1);
    let finished = false;
    const caught = await (client.unsafe("fail x") as unknown as Promise<unknown>).catch((e: Error) => e.message).finally(() => void (finished = true));
    expect(caught).toBe("boom");
    expect(finished).toBe(true);
  });
});
