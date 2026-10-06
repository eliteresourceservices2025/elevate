import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { guarded } from "./components/guard";
import { PanelTimeout, withTimeout } from "./timeout";

afterEach(() => vi.restoreAllMocks());

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));

describe("withTimeout", () => {
  it("passes a result through when it is quick", async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
  it("rejects with PanelTimeout when the work is too slow", async () => {
    await expect(withTimeout(new Promise((resolve) => setTimeout(resolve, 200)), 20)).rejects.toBeInstanceOf(PanelTimeout);
  });
  it("passes the work's own error through", async () => {
    await expect(withTimeout(Promise.reject(new TypeError("nope")), 50)).rejects.toThrow("nope");
  });
});

describe("guarded panels", () => {
  it("shows the panel when it loads", async () => {
    expect(html(await guarded("Fine", async () => createElement("p", null, "hello")))).toBe("<p>hello</p>");
  });

  it("shows a small notice, and logs only the error's class name, when a panel fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = html(
      await guarded("Needs attention", async () => {
        throw new Error("select * from secrets where token = 'abc'");
      }),
    );
    expect(out).toContain("Needs attention could not load.");
    expect(out).toContain("The rest of the page is fine.");
    expect(out).not.toContain("secrets");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secrets");
    expect(log).toHaveBeenCalledWith("dashboard panel failed:", "Needs attention", "Error");
  });

  it("lets a redirect pass through so signing in still works", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    await expect(guarded("Anything", async () => Promise.reject(redirect))).rejects.toBe(redirect);
  });
});
