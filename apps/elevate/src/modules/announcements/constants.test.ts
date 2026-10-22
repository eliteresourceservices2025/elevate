import { describe, expect, it } from "vitest";
import { hidesVersion } from "./constants";

describe("hidesVersion", () => {
  it("hides the version for the privacy notice and the monitoring policy only", () => {
    expect(hidesVersion("privacy_notice")).toBe(true);
    expect(hidesVersion("monitoring")).toBe(true);
    expect(hidesVersion("general")).toBe(false);
    expect(hidesVersion(null)).toBe(false);
    expect(hidesVersion(undefined)).toBe(false);
  });
});
