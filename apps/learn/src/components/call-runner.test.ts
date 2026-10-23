import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CallOverview, CallView } from "@/lib/queries";
import { CallCard } from "./call-card";
import { CallResult } from "./call-result";
import { CallRunner } from "./call-runner";
import { ListenButton } from "./listen-button";

// The mock-call screens render from data the server already filtered: nothing here can show a key, and these tests pin that.

const scenario = (n: number, answered: CallView["scenarios"][number]["answered"] = []) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Missed update ${n}`,
  intro: "A family member (invented) was promised an update.",
  record: { title: "Customer record", rows: [{ label: "Caller", value: "Maria R. (invented)" }] },
  startMood: 40,
  steps: [
    { kind: "caller" as const, id: "s1", text: "I was promised an update yesterday.", choices: [{ id: "a", text: "I am sorry. Let me look now." }, { id: "b", text: "We were busy." }] },
    { kind: "note" as const, id: "n1", text: "Follow-up", choices: [{ id: "a", text: "Call back by 3 pm tomorrow." }, { id: "b", text: "Will see." }] },
  ],
  answered,
});

const view = (over: Partial<CallView> = {}): CallView => ({
  id: "11111111-1111-4111-8111-111111111111",
  assignmentId: "22222222-2222-4222-8222-222222222222",
  status: "in_progress",
  scenarios: [scenario(1), scenario(2)],
  result: null,
  review: [],
  config: { passPercent: 85, maxTries: 3 },
  ...over,
});

describe("the call runner", () => {
  it("starts at the first unanswered step with the scene, the record, the caller and every choice", () => {
    const html = renderToStaticMarkup(createElement(CallRunner, { view: view() }));
    expect(html).toContain("Call 1 of 2");
    expect(html).toContain("Missed update 1");
    expect(html).toContain("A family member (invented) was promised an update.");
    expect(html).toContain("Customer record");
    expect(html).toContain("I was promised an update yesterday.");
    expect(html).toContain("I am sorry. Let me look now.");
    expect(html).toContain("We were busy.");
    expect(html).toContain("Caller mood");
  });

  it("resumes where the person left off (the first call done, the second one next)", () => {
    const done = scenario(1, [{ stepId: "s1", optionId: "a", moodAfter: 55 }, { stepId: "n1", optionId: "a", moodAfter: 60 }]);
    const html = renderToStaticMarkup(createElement(CallRunner, { view: view({ scenarios: [done, scenario(2)] }) }));
    expect(html).toContain("Call 2 of 2");
    expect(html).toContain("Missed update 2");
  });

  it("offers to finish when every step is answered", () => {
    const all = (n: number) => scenario(n, [{ stepId: "s1", optionId: "a", moodAfter: 55 }, { stepId: "n1", optionId: "a", moodAfter: 60 }]);
    const html = renderToStaticMarkup(createElement(CallRunner, { view: view({ scenarios: [all(1), all(2)] }) }));
    expect(html).toContain("See my result");
  });
});

describe("the Listen button", () => {
  it("renders nothing where the browser cannot read aloud (and on the server)", () => {
    expect(renderToStaticMarkup(createElement(ListenButton, { text: "Hello" }))).toBe("");
  });
});

describe("the call result", () => {
  const categories = { opening: 100, listening: 40, accuracy: 80, resolution: 60, deescalation: 100, documentation: 0 };

  it("shows a failed attempt with the score, the pass mark and the skill percentages, and no review", () => {
    const html = renderToStaticMarkup(createElement(CallResult, { view: view({ status: "submitted", result: { scorePercent: 61.5, passed: false, categories }, review: [] }) }));
    expect(html).toContain("Not yet");
    expect(html).toContain("61.5%");
    expect(html).toContain("85%");
    expect(html).toContain("Listening and empathy");
    expect(html).toContain("40%");
    expect(html).toContain("Documentation");
    expect(html).not.toContain("Best reply");
    expect(html).not.toContain("Because");
  });

  it("shows a passed attempt with the review: the pick, the best reply and the reason", () => {
    const review = [{ scenarioId: scenario(1).id, stepId: "s1", chosen: "b", best: "a", points: 1, maxPoints: 3, why: "Because it owns the problem." }];
    const html = renderToStaticMarkup(createElement(CallResult, { view: view({ status: "submitted", result: { scorePercent: 90, passed: true, categories }, review }) }));
    expect(html).toContain("You passed");
    expect(html).toContain("Because it owns the problem.");
    expect(html).toContain("We were busy."); // what was picked
    expect(html).toContain("I am sorry. Let me look now."); // the best reply
  });
});

describe("the mock call card on the course page", () => {
  const call = (over: Partial<CallOverview> = {}): CallOverview => ({ scenarios: 3, passPercent: 85, triesAllowed: 3, attempts: [], openAttemptId: null, waitUntil: null, waitMinutes: 0, ...over });
  const card = (props: Partial<Parameters<typeof CallCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(CallCard, { assignmentId: "22222222-2222-4222-8222-222222222222", call: call(), allModulesDone: true, finished: false, ...props }));

  it("explains the call and offers to start it once the modules are done", () => {
    const html = card();
    expect(html).toContain("Mock call");
    expect(html).toContain("3 calls");
    expect(html).toContain("85% to pass");
    expect(html).toContain("Start the mock call");
    expect(html).toContain("certificate needs both");
  });

  it("stays locked until the modules are finished, continues an open call, and lists past tries", () => {
    expect(card({ allModulesDone: false })).toContain("Finish all the modules to unlock");
    expect(card({ allModulesDone: false })).not.toContain("Start the mock call");
    const open = card({ call: call({ openAttemptId: "33333333-3333-4333-8333-333333333333" }) });
    expect(open).toContain("Continue the mock call");
    const tried = card({ call: call({ attempts: [{ id: "44444444-4444-4444-8444-444444444444", attemptNo: 1, status: "submitted", submittedAt: "2026-10-23T10:00:00.000Z", scorePercent: 70, passed: false }] }) });
    expect(tried).toContain("Try 1: 70% (not yet)");
    expect(tried).toContain("Try the mock call again");
  });

  it("shows when the call is passed, and when there are no tries left", () => {
    const passed = card({ call: call({ attempts: [{ id: "44444444-4444-4444-8444-444444444444", attemptNo: 1, status: "submitted", submittedAt: "2026-10-23T10:00:00.000Z", scorePercent: 90, passed: true }] }) });
    expect(passed).toContain("You passed the mock call");
    expect(passed).not.toContain("Start the mock call");
    const spent = card({ call: call({ triesAllowed: 1, attempts: [{ id: "44444444-4444-4444-8444-444444444444", attemptNo: 1, status: "submitted", submittedAt: "2026-10-23T10:00:00.000Z", scorePercent: 10, passed: false }] }) });
    expect(spent).toContain("used all your tries");
  });
});
