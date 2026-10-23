import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// The recap videos and read-aloud clips are read from disk at run time, so the deployment must carry them. The keys of
// outputFileTracingIncludes are route globs: an unescaped "[file]" is a character class that matches nothing (it silently shipped no media).
describe("the deployment carries the media folders", () => {
  const includes = nextConfig.outputFileTracingIncludes ?? {};
  it("names the media routes with a glob, not a bracketed segment", () => {
    expect(Object.keys(includes).sort()).toEqual(["/api/recaps/*", "/api/voice/*"]);
    for (const key of Object.keys(includes)) expect(key).not.toMatch(/[[\]]/);
  });
  it("includes each folder", () => {
    expect(includes["/api/recaps/*"]).toEqual(["./media/recaps/**/*"]);
    expect(includes["/api/voice/*"]).toEqual(["./media/voice/**/*"]);
  });
});
