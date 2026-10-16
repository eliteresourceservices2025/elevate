import { describe, expect, it } from "vitest";
import { cleanValue, fieldsUsed, fillFields, mergeProblem, missingFields, previewFields } from "./merge";

describe("merge fields", () => {
  const body = "This Agreement is with {{contractor_name}}, of {{ contractor_address }}. Role: {{role_title}}. Again {{contractor_name}}.";
  it("lists the fields used once each, in order", () => {
    expect(fieldsUsed(body)).toEqual(["contractor_name", "contractor_address", "role_title"]);
  });
  it("refuses unknown fields and stray braces", () => {
    expect(mergeProblem(body)).toBeNull();
    expect(mergeProblem("Hello {{salary}}")).toMatch(/Unknown field/);
    expect(mergeProblem("Hello {{contractor_name")).toMatch(/not closed/);
    expect(mergeProblem("Hello }} there")).toMatch(/not closed/);
  });
  it("fills every field and reports what is missing", () => {
    const values = { contractor_name: "Ana Reyes", contractor_address: "12 Mabini St, Manila", role_title: "" };
    expect(missingFields(body, values)).toEqual(["role_title"]);
    const filled = fillFields(body, { ...values, role_title: "Virtual Assistant" });
    expect(filled).toBe("This Agreement is with Ana Reyes, of 12 Mabini St, Manila. Role: Virtual Assistant. Again Ana Reyes.");
  });
  it("cannot be used to inject formatting or more fields through a value", () => {
    expect(cleanValue("**Bold** {{role_title}} [x](http://evil) # h\nline")).toBe("Bold roletitle xhttp://evil h line");
    expect(fillFields("Name: {{contractor_name}}", { contractor_name: "{{role_title}}" })).toBe("Name: roletitle");
  });
  it("shows the labels in the preview", () => {
    expect(previewFields("Dear {{contractor_name}}")).toBe("Dear **[Full name]**");
  });
});
