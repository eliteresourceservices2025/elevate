import { describe, expect, it } from "vitest";
import { allowedForRecording, latestAnswers, pickRecordedVideo, recordingRefusal, RECORDING_PART_TARGET_BYTES, shouldCutPart, startsWithEbml } from "./recording-rules";
import { maxParticipants, MAX_MEETING_PARTICIPANTS, MAX_TOWNHALL_PARTICIPANTS, TOWNHALL_KINDS } from "./track-selection";

const ok = { settingOn: true, conversationKind: "group", guestInCall: false, alreadyRecording: false, isGuest: false };

describe("recordingRefusal", () => {
  it("allows a plain staff call when recording is switched on", () => {
    expect(recordingRefusal(ok)).toBeNull();
  });
  it("refuses when the company switch is off", () => {
    expect(recordingRefusal({ ...ok, settingOn: false })).toBe("Recording is switched off.");
  });
  it("never records a client group, and never with a guest present, and never by a guest", () => {
    expect(recordingRefusal({ ...ok, conversationKind: "client" })).toBe("Calls with clients are never recorded.");
    expect(recordingRefusal({ ...ok, guestInCall: true })).toBe("A guest is in this call, so it can't be recorded.");
    expect(recordingRefusal({ ...ok, isGuest: true })).toBe("You can't record a call.");
  });
  it("only one recording at a time", () => {
    expect(recordingRefusal({ ...ok, alreadyRecording: true })).toBe("This call is already being recorded.");
  });
});

describe("consent answers", () => {
  const t = (n: number) => new Date(2026, 10, 18, 10, 0, n);
  it("the latest answer counts, so a changed mind takes effect", () => {
    const answers = latestAnswers([
      { userId: "a", answer: "allow", answeredAt: t(1) },
      { userId: "a", answer: "decline", answeredAt: t(5) },
      { userId: "b", answer: "decline", answeredAt: t(2) },
      { userId: "b", answer: "allow", answeredAt: t(9) },
    ]);
    expect(answers.get("a")).toBe("decline");
    expect(answers.get("b")).toBe("allow");
  });
  it("ignores unknown answers and handles ISO dates", () => {
    const answers = latestAnswers([
      { userId: "a", answer: "maybe", answeredAt: t(1) },
      { userId: "c", answer: "allow", answeredAt: "2026-11-18T10:00:00Z" },
    ]);
    expect(answers.has("a")).toBe(false);
    expect(answers.get("c")).toBe("allow");
  });
  it("only people who are here AND said yes are recorded (no answer is not a yes)", () => {
    const answers = latestAnswers([
      { userId: "a", answer: "allow", answeredAt: t(1) },
      { userId: "b", answer: "decline", answeredAt: t(1) },
      { userId: "gone", answer: "allow", answeredAt: t(1) },
    ]);
    expect(allowedForRecording(answers, ["a", "b", "c"])).toEqual(["a"]);
  });
});

describe("pickRecordedVideo", () => {
  const base = { pinnedUserId: null, activeSpeakerId: null, hasVideo: {}, hasScreen: {} };
  it("a shared screen of an allowed person comes first", () => {
    expect(pickRecordedVideo({ ...base, allowed: ["a", "b"], hasVideo: { a: true }, hasScreen: { b: true } })).toEqual({ userId: "b", slot: "screen" });
  });
  it("then the pinned person, then whoever is speaking, then anyone with video", () => {
    const hasVideo = { a: true, b: true, c: true };
    expect(pickRecordedVideo({ ...base, allowed: ["a", "b", "c"], hasVideo, pinnedUserId: "c", activeSpeakerId: "b" })).toEqual({ userId: "c", slot: "main" });
    expect(pickRecordedVideo({ ...base, allowed: ["a", "b", "c"], hasVideo, activeSpeakerId: "b" })).toEqual({ userId: "b", slot: "main" });
    expect(pickRecordedVideo({ ...base, allowed: ["a", "b", "c"], hasVideo })).toEqual({ userId: "a", slot: "main" });
  });
  it("never picks someone who did not agree, even if they are speaking, pinned or sharing", () => {
    expect(pickRecordedVideo({ ...base, allowed: ["a"], hasVideo: { a: false, x: true }, hasScreen: { x: true }, pinnedUserId: "x", activeSpeakerId: "x" })).toBeNull();
  });
  it("is a plain title card when nobody agreed", () => {
    expect(pickRecordedVideo({ ...base, allowed: [], hasVideo: { a: true } })).toBeNull();
  });
});

describe("recording files and pieces", () => {
  it("recognises the WebM header on the first piece only", () => {
    expect(startsWithEbml(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe(true);
    expect(startsWithEbml(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false);
    expect(startsWithEbml(new Uint8Array([0x1a, 0x45]))).toBe(false);
  });
  it("cuts a piece once enough has built up, or at the end if anything is left", () => {
    expect(shouldCutPart(0, true)).toBe(false);
    expect(shouldCutPart(1000, false)).toBe(false);
    expect(shouldCutPart(RECORDING_PART_TARGET_BYTES, false)).toBe(true);
    expect(shouldCutPart(1000, true)).toBe(true);
  });
});

describe("all-hands limits", () => {
  it("fits the whole company, and a meeting stays at 25", () => {
    expect(maxParticipants("townhall")).toBe(MAX_TOWNHALL_PARTICIPANTS);
    expect(MAX_TOWNHALL_PARTICIPANTS).toBeGreaterThanOrEqual(125);
    expect(maxParticipants("meeting")).toBe(MAX_MEETING_PARTICIPANTS);
  });
  it("is never held in a direct message or a client group", () => {
    expect(TOWNHALL_KINDS).not.toContain("dm");
    expect(TOWNHALL_KINDS).not.toContain("client");
  });
});
