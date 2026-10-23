import { describe, expect, it } from "vitest";
import { callsLint } from "./calls";
import { CALL_CATEGORIES, callSeedSchema, type CallSeed } from "./schema";

const choice = (id: "a" | "b" | "c" | "d", points: number) => ({ id, text: `Reply ${id}`, points, mood: points * 10 - 10, reply: `Caller answers ${id}`, why: `Because ${id}.` });
const step = (id: string, category: (typeof CALL_CATEGORIES)[number] = "listening") => ({ kind: "caller" as const, id, caller: `Caller line ${id}`, category, choices: [choice("a", 3), choice("b", 1), choice("c", 0)] });
const note = { kind: "note" as const, id: "n1", label: "Follow-up", choices: [choice("a", 3), choice("b", 0)] };

const call = (key: string, medical = false, extra: Partial<CallSeed> = {}): CallSeed => ({
  key,
  title: `Call ${key}`,
  moduleKey: "listening",
  medical,
  intro: "A family member (invented) calls about a request.",
  startMood: 40,
  steps: [step("s1"), step("s2", "resolution"), note],
  ...extra,
});

describe("call content", () => {
  it("has the six rubric categories", () => {
    expect([...CALL_CATEGORIES]).toEqual(["opening", "listening", "accuracy", "resolution", "deescalation", "documentation"]);
  });

  it("accepts a valid call with a record and refuses a note step in a category other than documentation by shape", () => {
    expect(callSeedSchema.safeParse(call("one", true, { record: { title: "Customer record", rows: [{ label: "Caller", value: "Maria R. (invented)" }] } })).success).toBe(true);
    expect(callSeedSchema.safeParse(call("bad", false, { steps: [{ ...step("s1"), choices: [choice("a", 3)] }, step("s2"), note] })).success).toBe(false);
    expect(callSeedSchema.safeParse(call("pts", false, { steps: [{ ...step("s1"), choices: [choice("a", 4), choice("b", 0)] }, step("s2"), note] })).success).toBe(false);
  });

  it("passes a clean pool and reports every kind of problem", () => {
    const pool = ["a", "b", "c", "d", "e"].map((k, i) => call(k, i < 2));
    expect(callsLint(pool, ["listening"])).toEqual([]);

    const noBest = call("nb", true, { steps: [{ ...step("s1"), choices: [choice("a", 2), choice("b", 0)] }, step("s2"), note] });
    const twoBest = call("tb", true, { steps: [{ ...step("s1"), choices: [choice("a", 3), choice("b", 3), choice("c", 0)] }, step("s2"), note] });
    const noZero = call("nz", true, { steps: [{ ...step("s1"), choices: [choice("a", 3), choice("b", 1)] }, step("s2"), note] });
    const problems = callsLint([noBest, twoBest, noZero, call("nb", true)], ["listening"]).join("\n");
    expect(problems).toMatch(/nb.*s1.*exactly one 3-point/);
    expect(problems).toMatch(/tb.*s1.*exactly one 3-point/);
    expect(problems).toMatch(/nz.*s1.*0-point/);
    expect(problems).toMatch(/duplicate call key.*nb/i);
  });

  it("checks the module key, the medical mix and unsafe text", () => {
    expect(callsLint([call("x", true)], ["other_module"]).join("\n")).toMatch(/x.*unknown module/i);
    const five = ["a", "b", "c", "d", "e"].map((k, i) => call(k, i === 0));
    expect(callsLint(five, ["listening"]).join("\n")).toMatch(/at least 2 medical/i);
    expect(callsLint([call("m", false)], ["listening"]).join("\n")).toMatch(/at least 1 medical/i);
    const text = callsLint([call("t", true, { intro: "Call 602-555-1212 or see https://x.example.com <b>now</b>" })], ["listening"]).join("\n");
    expect(text).toMatch(/markup/i);
    expect(text).toMatch(/web address/i);
    expect(text).toMatch(/phone/i);
  });
});
