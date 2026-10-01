import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOBS, cronAuthorized, jobState } from "./registry";

const MIN = 60_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");

describe("how a job is doing", () => {
  const base = { everyMinutes: 10, nowMs: NOW };

  it("is ok when it succeeded within two and a half intervals plus a few minutes", () => {
    expect(jobState({ ...base, lastSuccessMs: NOW - 5 * MIN, lastErrorMs: null })).toBe("ok");
    expect(jobState({ ...base, lastSuccessMs: NOW - 29 * MIN, lastErrorMs: null })).toBe("ok"); // 10 x 2.5 + 5 = 30
  });

  it("is late (stopped) after that, even if nothing ever failed", () => {
    expect(jobState({ ...base, lastSuccessMs: NOW - 31 * MIN, lastErrorMs: null })).toBe("late");
    expect(jobState({ everyMinutes: 1440, nowMs: NOW, lastSuccessMs: NOW - 4 * 24 * 60 * MIN, lastErrorMs: null })).toBe("late"); // a daily job missed for days
    expect(jobState({ everyMinutes: 1440, nowMs: NOW, lastSuccessMs: NOW - 20 * 60 * MIN, lastErrorMs: null })).toBe("ok");
  });

  it("is failing when the last run failed but it has not been too long, and waiting before its first run", () => {
    expect(jobState({ ...base, lastSuccessMs: NOW - 12 * MIN, lastErrorMs: NOW - 2 * MIN })).toBe("failing");
    expect(jobState({ ...base, lastSuccessMs: NOW - 2 * MIN, lastErrorMs: NOW - 12 * MIN })).toBe("ok"); // it recovered
    expect(jobState({ ...base, lastSuccessMs: null, lastErrorMs: null })).toBe("waiting");
    expect(jobState({ ...base, lastSuccessMs: null, lastErrorMs: NOW - MIN })).toBe("failing");
  });
});

describe("the host's scheduler", () => {
  const secret = "a-long-enough-cron-secret";

  it("lets in only the exact secret", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized(`Bearer ${secret.slice(0, -1)}`, secret)).toBe(false);
    expect(cronAuthorized(`Bearer wrong-secret-of-same-len`.padEnd(secret.length + 7, "x"), secret)).toBe(false);
    expect(cronAuthorized(secret, secret)).toBe(false); // no "Bearer"
    expect(cronAuthorized(null, secret)).toBe(false);
  });

  it("lets in nobody when no secret is set, or a weak one", () => {
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(cronAuthorized("Bearer short", "short")).toBe(false);
  });
});

describe("the job list", () => {
  it("has an entry for every scheduled function, and no entry for one that does not exist", () => {
    const source = readFileSync("src/inngest/functions.ts", "utf8");
    const scheduled = [...source.matchAll(/\{ id: "([a-z-]+)"/g)].map((m) => m[1]).sort();
    expect(scheduled.length).toBeGreaterThan(20);
    expect(Object.keys(JOBS).sort()).toEqual(scheduled);
  });

  it("checks in every scheduled function", () => {
    const source = readFileSync("src/inngest/functions.ts", "utf8");
    for (const id of Object.keys(JOBS)) expect(source).toContain(`track("${id}"`);
  });
});
