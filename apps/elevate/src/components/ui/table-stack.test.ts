import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageContainer } from "../page-container";
import { Table, TableBody, TableCell, TableRow } from "./table";

describe("a stacked table", () => {
  const html = renderToStaticMarkup(
    createElement(Table, { stack: true }, createElement(TableBody, null, createElement(TableRow, null, createElement(TableCell, null, "Maria"), createElement(TableCell, { label: "Team" }, "Support")))),
  );

  it("marks the table and gives each cell its label for the phone card", () => {
    expect(html).toContain('data-stack=""');
    expect(html).toContain('data-label="Team"');
  });

  it("leaves an ordinary table alone", () => {
    const plain = renderToStaticMarkup(createElement(Table, null, createElement(TableBody, null, createElement(TableRow, null, createElement(TableCell, { label: "Team" }, "x")))));
    expect(plain).not.toContain("data-stack");
  });
});

describe("page widths", () => {
  const cls = (width?: "full" | "canvas") => renderToStaticMarkup(createElement(PageContainer, { width })).match(/class="([^"]*)"/)?.[1] ?? "";

  it("caps the full width on huge screens and lets a canvas page use all of it", () => {
    expect(cls()).toContain("max-w-[105rem]");
    expect(cls("canvas")).not.toContain("max-w");
  });
});
