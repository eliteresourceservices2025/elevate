import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Pages are server components that need a running app to render, so these read the source: a card that is imported but never
// rendered (the person-facing half of the tracker) must fail here instead of shipping unnoticed.

const SRC = path.join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

describe("tracker pages are wired in", () => {
  it("the Attendance page renders the My day card and passes it the chosen day", () => {
    const page = read("app/(app)/attendance/page.tsx");
    expect(page).toContain("<MyDayCard ");
    expect(page).toContain("params.day");
  });
  it("the person page and the devices page render their bodies", () => {
    expect(read("app/(app)/activity/people/[id]/page.tsx")).toContain("<DayBody ");
    expect(read("app/(app)/activity/devices/page.tsx")).toContain("<DevicesTable ");
  });
  it("the download page renders the buttons, the enrollment dialog and the release notes", () => {
    const page = read("app/(app)/tracker/download/page.tsx");
    expect(page).toContain("<DownloadHero ");
    expect(page).toContain("<EnrollDialog ");
    expect(page).toContain("<ReleaseList ");
  });
});
