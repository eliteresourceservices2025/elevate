import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Call actions as each of the six roles and as a client guest, database mocked to throw: every role may use calls (membership is checked
// later, against the data), a guest may join and take part but never start or end one, bad input is refused before anything touches data,
// and nobody who is not signed in gets in.

const current = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => {
    if (current.fail) throw new Error("not signed in");
    return current.value;
  }),
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.stubEnv("CALLS_FAKE", "1");

const actions = await import("@/modules/calls/actions");

const ID = "11111111-1111-4111-8111-111111111111";
const TRACK = "audio-abc123";
const NO_ACCESS = "You do not have access to do that.";
const BAD = "Check the request and try again.";
const as = (role: RoleSlug) => {
  current.fail = false;
  current.value = { id: "44444444-4444-4444-8444-444444444444", email: "actor@example.com", roles: [role] };
};
const asGuest = () => {
  current.fail = false;
  current.value = { id: "55555555-5555-4555-8555-555555555555", email: "guest@client.example", roles: [], isGuest: true };
};

type Result = Promise<{ ok: boolean; error?: string }>;
const calls: { name: string; run: () => Result; guestMay: boolean }[] = [
  { name: "startCall", run: () => actions.startCall({ conversationId: ID }), guestMay: false },
  { name: "endCallForEveryone", run: () => actions.endCallForEveryone({ callId: ID }), guestMay: false },
  { name: "joinCall", run: () => actions.joinCall({ callId: ID }), guestMay: true },
  { name: "sendCallHeartbeat", run: () => actions.sendCallHeartbeat({ callId: ID }), guestMay: true },
  { name: "leaveCall", run: () => actions.leaveCall({ callId: ID }), guestMay: true },
  { name: "publishCallTracks", run: () => actions.publishCallTracks({ callId: ID, offer: { type: "offer", sdp: "v=0" }, tracks: [{ mid: "0", kind: "audio" }] }), guestMay: true },
  { name: "closeCallTracks", run: () => actions.closeCallTracks({ callId: ID, trackNames: [TRACK] }), guestMay: true },
  { name: "subscribeCallTracks", run: () => actions.subscribeCallTracks({ callId: ID, trackNames: [TRACK] }), guestMay: true },
  { name: "answerCallOffer", run: () => actions.answerCallOffer({ callId: ID, answer: { type: "answer", sdp: "v=0" } }), guestMay: true },
  { name: "muteCallParticipant", run: () => actions.muteCallParticipant({ callId: ID, userId: ID }), guestMay: true },
  { name: "removeCallParticipant", run: () => actions.removeCallParticipant({ callId: ID, userId: ID }), guestMay: true },
  { name: "unsubscribeCallTracks", run: () => actions.unsubscribeCallTracks({ callId: ID, mids: ["1"] }), guestMay: true },
  { name: "setCallSpeaker", run: () => actions.setCallSpeaker({ callId: ID, userId: ID, speaker: true }), guestMay: true },
  { name: "stopCallRecording", run: () => actions.stopCallRecording({ callId: ID }), guestMay: true },
  { name: "answerCallRecording", run: () => actions.answerCallRecording({ callId: ID, answer: "allow" }), guestMay: true },
  { name: "getLiveCall", run: () => actions.getLiveCall({ conversationId: ID }), guestMay: true },
  { name: "getIncomingCall", run: () => actions.getIncomingCall({ callId: ID }), guestMay: true },
];
const badInput: { name: string; run: () => Result }[] = [
  { name: "startCall", run: () => actions.startCall({}) },
  { name: "joinCall", run: () => actions.joinCall({ callId: "not-a-uuid" }) },
  { name: "publishCallTracks", run: () => actions.publishCallTracks({ callId: ID, offer: { type: "answer", sdp: "x" }, tracks: [{ mid: "0", kind: "audio" }] }) },
  { name: "publishCallTracks (too many)", run: () => actions.publishCallTracks({ callId: ID, offer: { type: "offer", sdp: "x" }, tracks: Array.from({ length: 5 }, (_, i) => ({ mid: String(i), kind: "audio" })) }) },
  { name: "publishCallTracks (kind)", run: () => actions.publishCallTracks({ callId: ID, offer: { type: "offer", sdp: "x" }, tracks: [{ mid: "0", kind: "microphone" }] }) },
  { name: "closeCallTracks (path-like name)", run: () => actions.closeCallTracks({ callId: ID, trackNames: ["../x"] }) },
  { name: "subscribeCallTracks (empty)", run: () => actions.subscribeCallTracks({ callId: ID, trackNames: [] }) },
  { name: "answerCallOffer (offer instead)", run: () => actions.answerCallOffer({ callId: ID, answer: { type: "offer", sdp: "x" } }) },
  { name: "muteCallParticipant (no user)", run: () => actions.muteCallParticipant({ callId: ID }) },
  { name: "unsubscribeCallTracks (path-like mid)", run: () => actions.unsubscribeCallTracks({ callId: ID, mids: ["../x"] }) },
  { name: "setCallSpeaker (speaker not a boolean)", run: () => actions.setCallSpeaker({ callId: ID, userId: ID, speaker: "yes" }) },
  { name: "answerCallRecording (not yes or no)", run: () => actions.answerCallRecording({ callId: ID, answer: "maybe" }) },
  { name: "startCall (unknown mode)", run: () => actions.startCall({ conversationId: ID, mode: "party" }) },
  { name: "getLiveCall", run: () => actions.getLiveCall({}) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("call actions, every role", () => {
  for (const role of ROLE_SLUGS) {
    for (const { name, run } of calls) {
      it(`${role}: may ${name} (refused only later, by membership, not by role)`, async () => {
        as(role);
        const result = await run();
        expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      });
    }
  }
});

describe("call settings", () => {
  it("only a Super Admin may save them; bad input is refused first", async () => {
    for (const role of ROLE_SLUGS) {
      as(role);
      const result = await actions.saveCallSettings({ monthlyGbWarning: 700, townhallEnabled: true, recordingEnabled: false });
      if (role === "super_admin") expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    }
    as("super_admin");
    for (const bad of [{}, { monthlyGbWarning: 10, townhallEnabled: true, recordingEnabled: false }, { monthlyGbWarning: 700.5, townhallEnabled: true, recordingEnabled: false }, { monthlyGbWarning: 700, townhallEnabled: "yes", recordingEnabled: false }]) {
      expect(await actions.saveCallSettings(bad)).toEqual({ ok: false, error: BAD });
    }
    asGuest();
    expect(await actions.saveCallSettings({ monthlyGbWarning: 700, townhallEnabled: true, recordingEnabled: false })).toMatchObject({ ok: false });
  });
});

describe("all-hands, recording and who may record", () => {
  it("only leadership and HR start an all-hands; everyone else is refused before anything is created", async () => {
    for (const role of ROLE_SLUGS) {
      as(role);
      const result = await actions.startCall({ conversationId: ID, mode: "townhall" });
      if (["super_admin", "hr_admin", "executive"].includes(role)) expect(result.ok === false && result.error).not.toBe("You can't start an all-hands.");
      else expect(result).toEqual({ ok: false, error: "You can't start an all-hands." });
    }
    asGuest();
    expect(await actions.startCall({ conversationId: ID, mode: "townhall" })).toMatchObject({ ok: false });
  });

  it("recording needs the Super Admin's pick: no role has it, only the flag does, and a guest never", async () => {
    const recordActions = [
      () => actions.startCallRecording({ callId: ID }),
      () => actions.requestRecordingUpload({ recordingId: ID, seq: 0 }),
      () => actions.finishRecordingUpload({ recordingId: ID, seq: 0 }),
    ];
    for (const role of ROLE_SLUGS) {
      for (const run of recordActions) {
        as(role);
        expect(await run()).toEqual({ ok: false, error: NO_ACCESS });
        (current.value as { canRecordCalls?: boolean }).canRecordCalls = true;
        const after = await run();
        expect(after.ok === false && after.error).not.toBe(NO_ACCESS);
      }
    }
    asGuest();
    for (const run of recordActions) expect(await run()).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("bad recording input is refused before the database", async () => {
    as("employee");
    (current.value as { canRecordCalls?: boolean }).canRecordCalls = true;
    expect(await actions.requestRecordingUpload({ recordingId: ID, seq: -1 })).toEqual({ ok: false, error: BAD });
    expect(await actions.requestRecordingUpload({ recordingId: "x", seq: 0 })).toEqual({ ok: false, error: BAD });
    expect(await actions.finishRecordingUpload({ recordingId: ID, seq: 1.5 })).toEqual({ ok: false, error: BAD });
  });

  it("only a Super Admin picks who may record", async () => {
    for (const role of ROLE_SLUGS) {
      as(role);
      const result = await actions.setCallRecorder({ userId: ID, enabled: true });
      if (role === "super_admin") expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    }
    as("super_admin");
    expect(await actions.setCallRecorder({ userId: "x", enabled: true })).toEqual({ ok: false, error: BAD });
    expect(await actions.setCallRecorder({ userId: ID, enabled: "yes" })).toEqual({ ok: false, error: BAD });
    asGuest();
    expect(await actions.setCallRecorder({ userId: ID, enabled: true })).toMatchObject({ ok: false });
  });
});

describe("call actions, a client guest", () => {
  for (const { name, run, guestMay } of calls) {
    it(`${guestMay ? "may" : "may not"} ${name}`, async () => {
      asGuest();
      const result = await run();
      if (guestMay) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
  }
});

describe("call actions, input and sign-in", () => {
  for (const { name, run } of badInput) {
    it(`${name}: bad input is refused before the database`, async () => {
      as("employee");
      expect(await run()).toEqual({ ok: false, error: BAD });
    });
  }
  for (const { name, run } of calls) {
    it(`${name}: someone who is not signed in gets nothing`, async () => {
      current.fail = true;
      await expect(run()).rejects.toThrow("not signed in");
    });
  }
  it("without the Cloudflare settings (and no fake switched on) calls say they are not set up, before touching data", async () => {
    vi.stubEnv("CALLS_FAKE", "");
    as("employee");
    expect(await actions.startCall({ conversationId: ID })).toEqual({ ok: false, error: "Calls aren't set up yet. Ask an administrator." });
    vi.stubEnv("CALLS_FAKE", "1");
  });
});
