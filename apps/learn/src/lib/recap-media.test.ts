import { describe, expect, it } from "vitest";
import { handleRecapMedia } from "./recap-media";

describe("the recap media route", () => {
  it("gives nothing to someone who is not signed in, video or subtitles", async () => {
    const deps = { sql: (() => Promise.resolve([])) as never, production: false };
    for (const file of ["hipaa-associates.mp4", "hipaa-associates.vtt", "../../.env"]) {
      const res = await handleRecapMedia(new Request("http://localhost/api/recaps/x"), file, deps);
      expect(res.status, file).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});
