import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "./modal";

describe("the dialog frame", () => {
  const html = renderToStaticMarkup(createElement(Modal, { labelledBy: "t", onClose: () => {}, children: createElement("div", null, createElement("h2", { id: "t" }, "Submit your exam?"), createElement("button", null, "Keep working")) }));

  it("is a modal dialog named by its heading, and can take focus itself when nothing inside can", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Keep working");
  });
});
