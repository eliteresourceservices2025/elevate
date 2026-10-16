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
    expect(cleanValue("**Bold** {{role_title}} [x](http://evil) # h\nline")).toBe("\\*\\*Bold\\*\\* role\\_title \\[x\\](http://evil) # h line");
    expect(fillFields("Name: {{contractor_name}}", { contractor_name: "{{role_title}}" })).toBe("Name: role\\_title");
  });
  it("shows the labels in the preview", () => {
    expect(previewFields("Dear {{contractor_name}}")).toBe("Dear **[Full name]**");
  });
});

describe("fields typed in when sending", () => {
  it("cleans and checks what HR typed, only for the fields the text uses", async () => {
    const { cleanSendInputs } = await import("./merge");
    const body = "Pay PHP {{monthly_rate}} {{payment_frequency}}. Duties: {{duties}}";
    expect(cleanSendInputs(body, { monthly_rate: "35,000", payment_frequency: "monthly", duties: "Inbox\nand calendar", other: "ignored" })).toEqual({ values: { monthly_rate: "35,000", payment_frequency: "monthly", duties: "Inbox and calendar" } });
    expect(cleanSendInputs(body, { monthly_rate: "35,000" })).toEqual({ error: "Fill in: Payment frequency, Description of duties." });
    expect(cleanSendInputs(body, { monthly_rate: "1", payment_frequency: "yearly", duties: "x" })).toEqual({ error: "Choose a value for Payment frequency." });
    expect(cleanSendInputs("No fields here", {})).toEqual({ values: {} });
  });
});

describe("values are printed as typed", () => {
  it("keeps parentheses, #, quotes and other punctuation in names, addresses and duties", async () => {
    const { cleanValue } = await import("./merge");
    const { parseMarkdown } = await import("@/lib/markdown");
    for (const v of ["Maria (Mia) Santos", "Unit #5 (Block 2), 12 Mabini St.", "Medical billing (RCM) & claims #follow-ups", 'Ana "Annie" O\'Neil ~ Jr. | QA > Ops']) {
      const blocks = parseMarkdown(`Value: ${cleanValue(v)}`);
      expect(JSON.stringify(blocks)).toContain(JSON.stringify(v).slice(1, -1).replace(/\\"/g, '\\"'));
    }
  });
  it("prints formatting characters literally and never as formatting or links", async () => {
    const { cleanValue } = await import("./merge");
    const { parseMarkdown } = await import("@/lib/markdown");
    const [p] = parseMarkdown(`See ${cleanValue("**bold** _it_ [link](https://evil.example) `code` back\\slash")} done`) as { type: string; children: { type: string; text?: string }[] }[];
    expect(p.children.every((c) => c.type === "text")).toBe(true);
    expect(p.children.map((c) => c.text).join("")).toBe("See **bold** _it_ [link](https://evil.example) `code` back\\slash done");
  });
  it("does not shorten a long typed value to 300 characters", async () => {
    const { cleanSendInputs } = await import("./merge");
    const duties = "Inbox and calendar management. ".repeat(20).trim();
    const out = cleanSendInputs("Duties: {{duties}}", { duties });
    expect("values" in out && out.values.duties).toBe(duties);
  });
});
