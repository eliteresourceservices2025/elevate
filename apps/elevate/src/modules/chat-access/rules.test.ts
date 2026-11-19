import { describe, expect, it } from "vitest";
import { requestAccessSchema } from "./validators";
import { accessStateOf, addDays, startOfDay } from "./rules";

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

describe("accessStateOf", () => {
  it("is waiting until a week has passed, then lapsed", () => {
    expect(accessStateOf({ status: "pending", requestedAt: ago(1), accessExpiresAt: null })).toBe("pending");
    expect(accessStateOf({ status: "pending", requestedAt: ago(24 * 7 + 1), accessExpiresAt: null })).toBe("lapsed");
  });
  it("an approval is open for its 72 hours, then ended", () => {
    expect(accessStateOf({ status: "approved", requestedAt: ago(100), accessExpiresAt: new Date(Date.now() + 3_600_000) })).toBe("approved");
    expect(accessStateOf({ status: "approved", requestedAt: ago(100), accessExpiresAt: ago(1) })).toBe("expired");
    expect(accessStateOf({ status: "approved", requestedAt: ago(100), accessExpiresAt: null })).toBe("expired");
  });
  it("denied and cancelled stay as they are", () => {
    expect(accessStateOf({ status: "denied", requestedAt: ago(1), accessExpiresAt: null })).toBe("denied");
    expect(accessStateOf({ status: "cancelled", requestedAt: ago(1), accessExpiresAt: null })).toBe("cancelled");
  });
});

describe("dates", () => {
  it("a day starts at midnight in the company zone (Phoenix, UTC-7, no daylight saving)", () => {
    expect(startOfDay("2026-11-10").toISOString()).toBe("2026-11-10T07:00:00.000Z");
    expect(startOfDay("2026-07-10").toISOString()).toBe("2026-07-10T07:00:00.000Z");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("requestAccessSchema", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const reason = "A complaint about conduct in this chat.";
  it("takes a chat with dates and a real reason, or a recording with a reason", () => {
    expect(requestAccessSchema.safeParse({ kind: "chat", conversationId: id, from: "2026-11-01", to: "2026-11-05", reason }).success).toBe(true);
    expect(requestAccessSchema.safeParse({ kind: "recording", recordingId: id, reason }).success).toBe(true);
  });
  it("refuses a short or missing reason, bad dates, a bad id and unknown kinds", () => {
    expect(requestAccessSchema.safeParse({ kind: "chat", conversationId: id, from: "2026-11-01", to: "2026-11-05", reason: "short" }).success).toBe(false);
    expect(requestAccessSchema.safeParse({ kind: "chat", conversationId: id, from: "yesterday", to: "2026-11-05", reason }).success).toBe(false);
    expect(requestAccessSchema.safeParse({ kind: "chat", conversationId: "x", from: "2026-11-01", to: "2026-11-05", reason }).success).toBe(false);
    expect(requestAccessSchema.safeParse({ kind: "dm", conversationId: id, reason }).success).toBe(false);
    expect(requestAccessSchema.safeParse({ kind: "recording", recordingId: id, reason: "x".repeat(1001) }).success).toBe(false);
  });
});
