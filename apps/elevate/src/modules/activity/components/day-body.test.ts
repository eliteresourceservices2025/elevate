import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DayBody } from "./day-body";
import type { ActivityDay } from "../queries";

// Midnight on 10 Nov in Manila (UTC+8) is 15:00 on 9 Nov in Phoenix (UTC-7)... no: 16:00 UTC on the 9th is 09:00 in Phoenix.
const dayStart = Date.UTC(2026, 10, 9, 16, 0);
const day: ActivityDay = {
  date: "2026-11-10",
  segments: [{ start: new Date(dayStart + 3_600_000).toISOString(), end: new Date(dayStart + 2 * 3_600_000).toISOString(), app: "Chrome", state: "active" }],
  minutes: { active: 60, idle: 0, work: 60, nonWork: 0 },
  topApps: [{ app: "Chrome", minutes: 60 }],
  shots: [],
  trackerOnline: true,
  working: [],
  workLog: [],
  zone: "Asia/Manila",
  dayStart,
  dayEnd: dayStart + 24 * 3_600_000,
};

describe("DayBody time zones", () => {
  it("labels the axis in the viewer's zone, so the axis agrees with the hover times", () => {
    const html = renderToStaticMarkup(createElement(DayBody, { day, viewerZone: "America/Phoenix" }));
    expect(html).toContain("9am"); // the start of the Manila day, seen from Phoenix
    expect(html).not.toContain(">12am<"); // the Manila midnight label must not appear on a Phoenix viewer's axis
    expect(html).toContain("10:00 AM"); // hover text for the block, also Phoenix time
  });
  it("says there is nothing recorded without claiming the viewer is the person", () => {
    const empty = { ...day, segments: [], minutes: { active: 0, idle: 0, work: 0, nonWork: 0 }, topApps: [] };
    expect(renderToStaticMarkup(createElement(DayBody, { day: empty, viewerZone: "America/Phoenix" }))).toContain("Nothing recorded for this day");
  });

  it("says which client and project the time was for, with the day and times in the viewer's zone", () => {
    const withLog = { ...day, workLog: [{ start: new Date(dayStart + 3_600_000).toISOString(), end: new Date(dayStart + 2 * 3_600_000).toISOString(), client: "Acme Dental", project: "Intake" }] };
    const html = renderToStaticMarkup(createElement(DayBody, { day: withLog, viewerZone: "America/Phoenix" }));
    expect(html).toContain("Who the time was for");
    expect(html).toContain("Acme Dental");
    expect(html).toContain("Intake");
    expect(html).toContain("Mon Nov 9, 10:00 AM to 11:00 AM");
  });
  it("shows no such list for a person with no clients, and still lists it when only the clock has data", () => {
    expect(renderToStaticMarkup(createElement(DayBody, { day, viewerZone: "America/Phoenix" }))).not.toContain("Who the time was for");
    const onlyClock = { ...day, segments: [], minutes: { active: 0, idle: 0, work: 0, nonWork: 0 }, topApps: [], workLog: [{ start: new Date(dayStart).toISOString(), end: new Date(dayStart + 3_600_000).toISOString(), client: "Acme Dental", project: null }] };
    expect(renderToStaticMarkup(createElement(DayBody, { day: onlyClock, viewerZone: "America/Phoenix" }))).toContain("Acme Dental");
  });

  it("leaves out apps that rounded down to 0 minutes", () => {
    const withTiny = { ...day, topApps: [{ app: "Chrome", minutes: 60 }, { app: "Blink", minutes: 0 }] };
    const html = renderToStaticMarkup(createElement(DayBody, { day: withTiny, viewerZone: "America/Phoenix" }));
    expect(html).toContain("Chrome");
    expect(html).not.toContain("Blink");
  });
});
