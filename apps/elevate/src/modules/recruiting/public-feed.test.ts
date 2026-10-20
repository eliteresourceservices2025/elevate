import { describe, expect, it } from "vitest";
import { baseUrl, corsHeaders, excerpt, frameAncestors, jobPostingJsonLd, parseOrigins, plainText, safeJsonLd, toFeedJob } from "./public-feed";

const job = { id: "11111111-1111-4111-8111-111111111111", slug: "healthcare-va", title: "Healthcare VA", location: "Remote", payNote: "Paid per client", openedAt: new Date("2026-10-01T00:00:00Z"), description: "# About\n\nSupport **our clients** with *scheduling*.\n\n- Inbox care\n- Calls" };

describe("plain text from a description", () => {
  it("drops the markup and joins paragraphs and list items", () => {
    expect(plainText(job.description)).toBe("About Support our clients with scheduling. Inbox care Calls");
    expect(plainText("")).toBe("");
  });
  it("keeps markup-looking text as text and never produces HTML", () => {
    expect(plainText("Hello <script>alert(1)</script> [link](javascript:alert(1))")).toContain("<script>");
  });
});

describe("the excerpt", () => {
  it("leaves a short text alone and cuts a long one at a word with an ellipsis", () => {
    expect(excerpt("short text")).toBe("short text");
    const long = "word ".repeat(100).trim();
    const out = excerpt(long, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
    expect(out.endsWith(" …")).toBe(false);
  });
});

describe("a job in the feed", () => {
  it("has only the public fields, the address on ELEVATE, and a summary; the description only on request", () => {
    const base = baseUrl("https://elevate.example.com/");
    const item = toFeedJob(job, base);
    expect(Object.keys(item).sort()).toEqual(["id", "location", "payNote", "postedAt", "slug", "summary", "title", "url"]);
    expect(item).toMatchObject({ slug: "healthcare-va", url: "https://elevate.example.com/careers/healthcare-va", postedAt: "2026-10-01T00:00:00.000Z", summary: expect.stringContaining("Support our clients") });
    expect(toFeedJob(job, base, { withDescription: true }).description).toBe(job.description);
  });
  it("uses the id for an old job with no readable address, and passes no internal field through", () => {
    // A row straight from the database also carries internal columns: none of them may reach the feed.
    const row = { ...job, slug: null, teamId: "t", clientId: "c", createdBy: "u", sendAck: true };
    const item = toFeedJob(row, "https://x.example.com");
    expect(item.slug).toBe(job.id);
    expect(item.url).toBe(`https://x.example.com/careers/${job.id}`);
    expect(JSON.stringify(item)).not.toMatch(/teamId|clientId|createdBy|sendAck/);
  });
});

describe("who may read the feed from a browser", () => {
  it("accepts https addresses (and localhost over http), reduces them to the origin, and ignores anything else", () => {
    expect(parseOrigins("https://www.example.com/jobs, http://localhost:3000, http://evil.example.com, javascript:alert(1), nonsense, ")).toEqual(["https://www.example.com", "http://localhost:3000"]);
    expect(parseOrigins(undefined)).toEqual([]);
  });
  it("sends the permission only to a listed origin, and always varies by origin", () => {
    const allowed = ["https://www.example.com"];
    expect(corsHeaders("https://www.example.com", allowed)).toMatchObject({ "Access-Control-Allow-Origin": "https://www.example.com", Vary: "Origin" });
    expect(corsHeaders("https://evil.example.com", allowed)).toEqual({ Vary: "Origin" });
    expect(corsHeaders(null, allowed)).toEqual({ Vary: "Origin" });
    expect(corsHeaders("https://www.example.com", [])).toEqual({ Vary: "Origin" });
  });
});

describe("framing and structured data", () => {
  it("allows this site and the listed sites to frame the careers pages, nothing else", () => {
    expect(frameAncestors([])).toBe("'self'");
    expect(frameAncestors(["https://www.example.com"])).toBe("'self' https://www.example.com");
  });
  it("escapes JSON so a description cannot close the script tag", () => {
    const text = safeJsonLd({ description: "</script><script>alert(1)</script> " });
    expect(text).not.toContain("</script>");
    expect(text).not.toContain("<");
    expect(JSON.parse(text).description).toBe("</script><script>alert(1)</script> ");
  });
  it("describes the job as a contractor posting on ELEVATE", () => {
    const ld = jobPostingJsonLd({ ...job, description: job.description }, "https://elevate.example.com");
    expect(ld).toMatchObject({ "@type": "JobPosting", title: "Healthcare VA", employmentType: "CONTRACTOR", datePosted: "2026-10-01", jobLocationType: "TELECOMMUTE", url: "https://elevate.example.com/careers/healthcare-va" });
  });
});
