import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CourseCard, HomeTile, homeStatus } from "./course-card";
import { hasHomeScene, homeSceneKeys } from "./home-art";

const card = (status: string, extra: Partial<{ slug: string; isUpdate: boolean; track: string; reason: string }> = {}) =>
  renderToStaticMarkup(createElement("ul", null, createElement(CourseCard, { slug: "hipaa", title: "HIPAA Privacy, Security and Awareness", track: "full", status, dueOn: "2026-11-13", isUpdate: false, href: "/course/abc", ...extra })));

describe("the course picture cards on the home page", () => {
  it("show the title, a picture, the status, the due date and one clear action, as one link", () => {
    const html = card("in_progress");
    expect(html).toContain("HIPAA Privacy, Security and Awareness");
    expect(html).toContain("<svg");
    expect(html).toContain("In progress");
    expect(html).toContain("Due Nov 13, 2026");
    expect(html).toContain("Continue");
    expect(html).toContain("Full course");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/course/abc"');
  });

  it("say Start, Continue or Review course by status (the certificate link is inside the course), and show a passed course as Passed", () => {
    expect(card("assigned")).toContain("Start");
    expect(card("assigned")).toContain("Not started");
    const passed = card("passed");
    expect(passed).toContain("Review course");
    expect(passed).toContain("Passed");
    expect(passed).not.toContain("Due Nov 13, 2026");
  });

  it("call an update an update, and say the certificate stays valid", () => {
    const html = card("assigned", { isUpdate: true });
    expect(html).toContain("Short update");
    expect(html).toContain("Your certificate stays valid.");
  });

  it("say why a course was assigned, so two cards with one title can be told apart", () => {
    expect(card("assigned", { reason: "new_hire" })).toContain("New-hire course · Full course");
    expect(card("assigned", { reason: "renewal", track: "refresher" })).toContain("Yearly renewal · Refresher");
    expect(card("assigned", { reason: "manual", track: "essentials" })).toContain("Assigned by HR · Essentials");
    expect(card("assigned", { reason: "update", isUpdate: true })).toContain("Short update");
    expect(card("assigned")).toContain("Full course"); // no reason given: the track alone, as before
  });

  it("hide the picture from screen readers and add no scripts or raw HTML", () => {
    const html = card("assigned");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<script|dangerouslySetInnerHTML|<img/);
  });

  it("give a client add-on a picture and a plain line, the same every time", () => {
    const a = card("assigned", { slug: "acme-requirements" });
    expect(a).toContain("<svg");
    expect(a).toContain("Training from ELEVATE Learn.");
    expect(a).toBe(card("assigned", { slug: "acme-requirements" }));
  });

  it("maps assignment status to a home status", () => {
    expect(["assigned", "in_progress", "passed", "expired", "cancelled"].map(homeStatus)).toEqual(["new", "progress", "done", "expired", "expired"]);
  });
});

describe("the home shortcuts", () => {
  it("are picture cards with one link", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(HomeTile, { art: "record", title: "My training record", text: "Your courses.", action: "Open my record", href: "/record" })));
    expect(html).toContain("My training record");
    expect(html).toContain("Open my record");
    expect(html).toContain("<svg");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("have a drawn picture for each built-in course and each shortcut", () => {
    for (const name of ["hipaa", "cybersecurity", "customer-service", "practice", "record", "cards"]) expect(hasHomeScene(name), name).toBe(true);
    expect(homeSceneKeys().sort()).toEqual(["cards", "customer-service", "cybersecurity", "hipaa", "practice", "record"]);
  });
});
