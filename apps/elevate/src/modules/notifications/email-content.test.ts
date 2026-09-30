import { describe, expect, it } from "vitest";
import { buildAckEmail, buildDigest, digestGroup, renderEmail } from "./email-content";

describe("email content", () => {
  it("groups notification kinds for the digest", () => {
    expect(digestGroup("announcement.posted")).toBe("announcements and policies");
    expect(digestGroup("policy.ack_required")).toBe("announcements and policies");
    expect(digestGroup("document.expiring")).toBe("document reminders");
    expect(digestGroup("anything.else")).toBe("other updates");
  });

  it("builds a digest from counts only", () => {
    const d = buildDigest([
      { kind: "announcement.posted", count: 2 },
      { kind: "policy.ack_required", count: 1 },
      { kind: "document.expiring", count: 1 },
    ]);
    expect(d.total).toBe(4);
    expect(d.subject).toBe("You have 4 unread notifications in ELEVATE");
    expect(d.lines).toEqual(["3 announcements and policies", "1 document reminders"]);
    expect(buildDigest([{ kind: "x", count: 1 }]).subject).toBe("You have 1 unread notification in ELEVATE");
  });

  it("words the acknowledgment email in counts", () => {
    expect(buildAckEmail(1, 0).subject).toBe("1 item needs your acknowledgment in ELEVATE");
    expect(buildAckEmail(3, 2).lines).toEqual(["3 items are waiting for you to read and acknowledge.", "2 are past the due date."]);
    expect(buildAckEmail(2, 1).lines[1]).toBe("1 is past the due date.");
  });

  it("renders text and html with an in-app link, escaping everything", () => {
    const m = renderEmail({ heading: "Hi <b>", lines: ["A & B"], link: "/announcements", appUrl: "https://elevate.example.com/" });
    expect(m.url).toBe("https://elevate.example.com/announcements");
    expect(m.text).toContain("Open ELEVATE: https://elevate.example.com/announcements");
    expect(m.html).toContain("Hi &lt;b&gt;");
    expect(m.html).toContain("A &amp; B");
    expect(m.html).not.toContain("<b>");
  });

  it("never links off-site", () => {
    expect(renderEmail({ heading: "x", lines: [], link: "https://evil.example", appUrl: "https://elevate.example.com" }).url).toBe("https://elevate.example.com/dashboard");
    expect(renderEmail({ heading: "x", lines: [], link: "//evil.example", appUrl: "https://elevate.example.com" }).url).toBe("https://elevate.example.com/dashboard");
  });
});
