import { describe, expect, it } from "vitest";
import { chooseSubscriptions, mayPublish, type PublishedTrack } from "./track-selection";
import { estimateCallGb, overWarning } from "./usage";
import { isSafeSessionId, isSafeTrackName, newTrackName } from "./sfu-rules";

const sid = (n: number) => n.toString(16).padStart(32, "0");
const user = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const t = (n: number, kind: PublishedTrack["kind"], role: PublishedTrack["role"] = "attendee"): PublishedTrack => ({ userId: user(n), role, cfSessionId: sid(n), trackName: `${kind}-${n}`, kind });

describe("chooseSubscriptions in a meeting", () => {
  const everyone = Array.from({ length: 25 }, (_, i) => i + 1).flatMap((n) => [t(n, "audio"), t(n, "video")]);

  it("pulls everyone else's audio but only one page of video, never the viewer's own tracks", () => {
    const s = chooseSubscriptions({ tracks: everyone, selfUserId: user(1), mode: "meeting" });
    expect(s.pull.filter((x) => x.kind === "audio")).toHaveLength(24);
    expect(s.pull.filter((x) => x.kind === "video")).toHaveLength(9);
    expect(s.pull.some((x) => x.userId === user(1))).toBe(false);
    expect(s.visibleUserIds).toHaveLength(9);
    expect(s.pages).toBe(3); // 24 others in pages of 9
  });

  it("puts the pinned person first, then the active speaker, and keeps the rest in a steady order", () => {
    const s = chooseSubscriptions({ tracks: everyone, selfUserId: user(1), mode: "meeting", pinnedUserId: user(20), activeSpeakerId: user(15) });
    expect(s.visibleUserIds.slice(0, 2)).toEqual([user(20), user(15)]);
    const again = chooseSubscriptions({ tracks: everyone, selfUserId: user(1), mode: "meeting", pinnedUserId: user(20), activeSpeakerId: user(15) });
    expect(again.visibleUserIds).toEqual(s.visibleUserIds);
  });

  it("pages through the rest and clamps a page that is too far", () => {
    const second = chooseSubscriptions({ tracks: everyone, selfUserId: user(1), mode: "meeting", page: 1 });
    const first = chooseSubscriptions({ tracks: everyone, selfUserId: user(1), mode: "meeting", page: 0 });
    expect(second.visibleUserIds.some((id) => first.visibleUserIds.includes(id))).toBe(false);
    const far = chooseSubscriptions({ tracks: everyone, selfUserId: user(1), mode: "meeting", page: 99 });
    expect(far.visibleUserIds.length).toBeGreaterThan(0);
  });

  it("always shows a shared screen", () => {
    const withScreen = [...everyone, t(7, "screen")];
    const s = chooseSubscriptions({ tracks: withScreen, selfUserId: user(1), mode: "meeting" });
    expect(s.pull.some((x) => x.kind === "screen" && x.userId === user(7))).toBe(true);
    expect(s.visibleUserIds).toContain(user(7));
  });

  it("copes with nobody else in the call", () => {
    const s = chooseSubscriptions({ tracks: [t(1, "audio"), t(1, "video")], selfUserId: user(1), mode: "meeting" });
    expect(s).toEqual({ pull: [], visibleUserIds: [], pages: 1 });
  });
});

describe("chooseSubscriptions in an all-hands", () => {
  it("the audience pulls only hosts and speakers", () => {
    const tracks = [t(1, "audio", "host"), t(1, "video", "host"), t(2, "audio", "speaker"), t(2, "video", "speaker"), t(3, "audio"), t(3, "video")];
    const s = chooseSubscriptions({ tracks, selfUserId: user(50), mode: "townhall" });
    expect(new Set(s.pull.map((x) => x.userId))).toEqual(new Set([user(1), user(2)]));
  });
});

describe("mayPublish", () => {
  it("anyone in a meeting; only hosts and speakers in an all-hands", () => {
    for (const role of ["host", "speaker", "attendee"] as const) expect(mayPublish("meeting", role)).toBe(true);
    expect(mayPublish("townhall", "host")).toBe(true);
    expect(mayPublish("townhall", "speaker")).toBe(true);
    expect(mayPublish("townhall", "attendee")).toBe(false);
  });
});

describe("usage estimate", () => {
  it("is proportional to participant-minutes, lower per person for an all-hands, never negative", () => {
    expect(estimateCallGb("meeting", 60)).toBe(1);
    expect(estimateCallGb("meeting", 25 * 60)).toBe(25);
    expect(estimateCallGb("townhall", 125 * 60)).toBe(75);
    expect(estimateCallGb("meeting", -5)).toBe(0);
  });
  it("warns at or above the level", () => {
    expect(overWarning(699, 700)).toBe(false);
    expect(overWarning(700, 700)).toBe(true);
  });
});

describe("sfu id rules", () => {
  it("accepts only 32- or 64-hex session ids and plain track names, so nothing odd reaches a URL", () => {
    expect(isSafeSessionId(sid(255))).toBe(true);
    expect(isSafeSessionId("ab".repeat(32))).toBe(true); // Cloudflare's real ids are 64 characters
    for (const bad of ["", "../x", sid(1) + "a", "a".repeat(63), "a".repeat(65), "g".repeat(32), null, 5]) expect(isSafeSessionId(bad)).toBe(false);
    expect(isSafeTrackName("audio-abc_1")).toBe(true);
    for (const bad of ["", "a/b", "a b", "a?b", "x".repeat(65), "../a", undefined]) expect(isSafeTrackName(bad)).toBe(false);
    expect(newTrackName("video", "Ab-12!x")).toBe("video-Ab12x");
  });
});
