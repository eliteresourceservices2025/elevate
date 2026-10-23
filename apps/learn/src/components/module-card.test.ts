import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COURSES } from "@/content";
import { ModuleCard, type ModuleStatus } from "./module-card";
import { hasScene, sceneKeys } from "./module-art";

const card = (status: ModuleStatus, href: string | null = "/course/a/excellence") =>
  renderToStaticMarkup(createElement(ModuleCard, { index: 3, title: "Active listening", summary: "How to listen so people feel heard.", minutes: 16, status, href, course: "customer-service", moduleKey: "listening" }));

describe("the module picture cards", () => {
  it("show the number, title, picture, description and time, and the whole card is one link", () => {
    const html = card("new");
    expect(html).toContain("Module 3");
    expect(html).toContain("Active listening");
    expect(html).toContain("How to listen so people feel heard.");
    expect(html).toContain("About 16 min");
    expect(html).toContain("Not started");
    expect(html).toContain("<svg");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/course/a/excellence"');
  });

  it("hide the picture from screen readers (the text says what the module is) and add no scripts or raw HTML", () => {
    const html = card("done");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/<script|dangerouslySetInnerHTML|<img/);
  });

  it("say Start, Continue or Review by status", () => {
    expect(card("new")).toContain("Start");
    expect(card("progress")).toContain("Continue");
    expect(card("progress")).toContain("In progress");
    expect(card("done")).toContain("Review");
    expect(card("done")).toContain("Done");
  });

  it("are not links when locked, and say why for screen readers", () => {
    const html = card("locked", null);
    expect(html).toContain("Locked");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Finish the earlier modules to open this one.");
    expect(html).not.toContain("<a ");
  });

  it("are not links when the course is finished (no href), without looking locked", () => {
    const html = card("done", null);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Review");
    expect(html).not.toContain('aria-disabled');
  });
});

describe("the module pictures", () => {
  it("exist for every module of every built-in course, and for nothing else", () => {
    const expected: string[] = [];
    for (const [slug, course] of Object.entries(COURSES)) for (const m of course.content.modules) expected.push(`${slug}/${m.key}`);
    for (const key of expected) expect(hasScene(...(key.split("/") as [string, string])), key).toBe(true);
    expect(sceneKeys().sort()).toEqual(expected.sort());
  });

  it("give a client add-on module a picture too, the same one every time", () => {
    const render = (key: string) => renderToStaticMarkup(createElement(ModuleCard, { index: 1, title: "t", summary: "s", minutes: 5, status: "new", href: "/x", course: "acme-requirements", moduleKey: key }));
    expect(render("working")).toContain("<svg");
    expect(render("working")).toBe(render("working"));
  });
});
