import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormErrorSummary, errorItems } from "./form-error-summary";

describe("the error summary of a long form", () => {
  it("lists every field with a message, and skips fields that have none", () => {
    expect(errorItems({ legalFirstName: { message: "Enter a first name" }, workEmail: { message: "Enter a valid work email address" }, middle: { type: "x" }, other: undefined })).toEqual([
      { id: "legalFirstName", message: "Enter a first name" },
      { id: "workEmail", message: "Enter a valid work email address" },
    ]);
  });

  it("links each item to its field and says how many there are", () => {
    const html = renderToStaticMarkup(createElement(FormErrorSummary, { items: [{ id: "workEmail", message: "Enter a valid work email address" }, { id: "legalLastName", message: "Enter a last name" }] }));
    expect(html).toContain("2 things to fix before you can save");
    expect(html).toContain('href="#workEmail"');
    expect(html).toContain('href="#legalLastName"');
    expect(html).toContain('role="alert"');
  });

  it("says nothing when the form is fine", () => {
    expect(renderToStaticMarkup(createElement(FormErrorSummary, { items: [] }))).toBe("");
  });
});
