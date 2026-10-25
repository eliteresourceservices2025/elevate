import { describe, expect, it } from "vitest";
import { AnswerSaver, type SaveResult } from "./answer-saver";

/** A save function the test controls: each call waits until the test settles it. */
function fakeServer() {
  const calls: { q: string; selected: string[]; settle: (r: SaveResult) => void }[] = [];
  const stored = new Map<string, string[]>();
  const save = (q: string, selected: string[]) =>
    new Promise<SaveResult>((resolve) => {
      calls.push({ q, selected, settle: (r) => { if (r.ok) stored.set(q, selected); resolve(r); } });
    });
  return { calls, stored, save };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("saving exam answers", () => {
  it("does not call it saved when an earlier question failed and a later one went through", async () => {
    const s = fakeServer();
    const saver = new AnswerSaver(s.save, () => {});
    saver.choose("q1", ["a"]);
    saver.choose("q2", ["b"]);
    await tick();
    s.calls[0].settle({ ok: false, offline: true, error: "offline" });
    s.calls[1].settle({ ok: true });
    await tick();
    expect(saver.failedCount).toBe(1);
    expect(saver.unsaved).toEqual(["q1"]);
    expect(saver.isUnsaved("q2")).toBe(false);
    expect(saver.saving).toBe(false);
  });

  it("sends only the newest choice when several come at once, and re-sends if it changes while a request is in flight", async () => {
    const s = fakeServer();
    const saver = new AnswerSaver(s.save, () => {});
    saver.choose("q1", ["a"]);
    saver.choose("q1", ["b"]);
    await tick();
    expect(s.calls.map((c) => c.selected)).toEqual([["b"]]); // two quick clicks, one request, newest choice
    saver.choose("q1", ["c"]); // changed while that request is in flight: nothing else is sent yet
    await tick();
    expect(s.calls).toHaveLength(1);
    s.calls[0].settle({ ok: true });
    await tick();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].selected).toEqual(["c"]); // the older choice never overwrites the newer one
    s.calls[1].settle({ ok: true });
    await tick();
    expect(s.stored.get("q1")).toEqual(["c"]);
    expect(saver.unsaved).toEqual([]);
    expect(saver.saving).toBe(false);
  });

  it("retries a failed answer and clears the failure when it goes through", async () => {
    const s = fakeServer();
    const saver = new AnswerSaver(s.save, () => {});
    saver.choose("q1", ["a"]);
    await tick();
    s.calls[0].settle({ ok: false, error: "x" });
    await tick();
    expect(saver.failedCount).toBe(1);
    const retry = saver.retryFailed();
    await tick();
    s.calls[1].settle({ ok: true });
    await retry;
    expect(saver.failedCount).toBe(0);
    expect(saver.unsaved).toEqual([]);
  });

  it("settle() before submitting says whether every answer is saved", async () => {
    const s = fakeServer();
    const saver = new AnswerSaver(s.save, () => {});
    saver.choose("q1", ["a"]);
    await tick();
    const done = saver.settle();
    s.calls[0].settle({ ok: false, error: "x" }); // fails, then settle retries once
    await tick();
    s.calls[1].settle({ ok: false, error: "x" }); // still failing
    expect(await done).toBe(false);

    const again = saver.settle();
    await tick();
    s.calls[2].settle({ ok: true });
    expect(await again).toBe(true);
  });

  it("treats answers the server already has (an exam picked up again) as saved", () => {
    const saver = new AnswerSaver(async () => ({ ok: true }), () => {});
    saver.seed("q1", ["a", "b"]);
    expect(saver.unsaved).toEqual([]);
    saver.choose("q1", ["b", "a"]); // same choice in another order is not a change
    expect(saver.unsaved).toEqual([]);
    return tick().then(() => expect(saver.saving).toBe(false)); // and nothing is left "saving"
  });
});
