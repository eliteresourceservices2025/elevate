import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPORT_EMAIL, topicLabel } from "./constants";
import { supportRequestSchema } from "./validators";

describe("support request validation", () => {
  const ok = { topic: "sign_in", subject: "I cannot sign in", message: "It says my password is wrong but I just reset it." };
  it("accepts a normal request, with or without a page", () => {
    expect(supportRequestSchema.safeParse(ok).success).toBe(true);
    expect(supportRequestSchema.safeParse({ ...ok, page: "/attendance?tab=corrections" }).success).toBe(true);
    expect(supportRequestSchema.safeParse({ ...ok, page: "" }).success).toBe(true);
  });
  it("refuses a short or long text, an unknown topic, and a page outside the app", () => {
    expect(supportRequestSchema.safeParse({ ...ok, subject: "no" }).success).toBe(false);
    expect(supportRequestSchema.safeParse({ ...ok, message: "short" }).success).toBe(false);
    expect(supportRequestSchema.safeParse({ ...ok, message: "x".repeat(2001) }).success).toBe(false);
    expect(supportRequestSchema.safeParse({ ...ok, topic: "billing" }).success).toBe(false);
    for (const page of ["https://evil.example/x", "//evil.example", "javascript:alert(1)"]) expect(supportRequestSchema.safeParse({ ...ok, page }).success).toBe(false);
  });
});

describe("support constants", () => {
  it("names topics and has the agreed address", () => {
    expect(topicLabel("jibble")).toBe("Jibble or screenshots");
    expect(topicLabel("unknown")).toBe("unknown");
    expect(DEFAULT_SUPPORT_EMAIL).toBe("elitehelpdesk@ersva.com");
  });
});
