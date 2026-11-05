import type { Locator, Page } from "@playwright/test";

/** Hides what is not part of the product screen (the dev server's badge) and draws the gold frames around what the reader must click. */
export async function dress(page: Page, highlight: Locator[]) {
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-dev-tools-button], [data-nextjs-toast] { display: none !important; }" });
  for (const target of highlight) {
    await target.first().evaluate((el) => {
      const node = el as HTMLElement;
      node.style.outline = "4px solid #E2BE2B";
      node.style.outlineOffset = "3px";
      node.style.borderRadius = "8px";
      node.style.boxShadow = "0 0 0 8px rgba(226, 190, 43, 0.28)";
    });
  }
}
