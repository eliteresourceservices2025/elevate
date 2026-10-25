import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "./modal";

describe("the dialog frame", () => {
  const html = renderToStaticMarkup(
    <Modal labelledBy="t" onClose={() => {}}>
      <div>
        <h2 id="t">Submit your exam?</h2>
        <button>Keep working</button>
      </div>
    </Modal>,
  );

  it("is a modal dialog named by its heading, and can take focus itself when nothing inside can", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Keep working");
  });
});
