import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@/lib/markdown";
import { DEFAULT_OFFER_TEMPLATE, OPTIONAL_BLANK, cleanValue, fieldsUsed, inlineText, missingFields, renderBlocks, renderText, templateProblem } from "./merge";
import { renderOfferPdf } from "./offer-pdf";
import { offerStatus } from "./service";
import { hireSchema, makeOfferSchema, offerTemplateSchema } from "./validators";

const values = { candidate_name: "Ana Reyes", offer_date: "October 1, 2026", expires_on: "October 8, 2026", role_title: "Virtual Assistant", start_date: "November 2, 2026", client_name: "", pay_note: "Hourly rate agreed per client." };

describe("template fields", () => {
  it("finds the fields a template uses and accepts the default template", () => {
    expect(fieldsUsed("Hi {{candidate_name}}, {{ role_title }} and {{candidate_name}} again")).toEqual(["candidate_name", "role_title"]);
    expect(templateProblem(DEFAULT_OFFER_TEMPLATE)).toBeNull();
  });
  it("refuses an unknown field, a stray brace, and too little or too much text", () => {
    expect(templateProblem("Dear {{candidate_name}}, your {{salary}} is great and we are happy.")).toContain("{{salary}}");
    expect(templateProblem("Dear {{candidate_name}}, we {{ are happy to have you with us.")).toContain("not closed");
    expect(templateProblem("short")).toContain("Write the letter");
    expect(templateProblem("x".repeat(10_001))).toContain("too long");
  });
});

describe("filling a letter", () => {
  it("fills every field; an optional one left blank reads To be confirmed; a required one blocks", () => {
    const text = renderText(DEFAULT_OFFER_TEMPLATE, values);
    expect(text).toContain("Dear Ana Reyes,");
    expect(text).toContain("- Pay: Hourly rate agreed per client.");
    expect(text).toContain(`- Client: ${OPTIONAL_BLANK}`);
    expect(text).not.toContain("{{");
    expect(missingFields(DEFAULT_OFFER_TEMPLATE, values)).toEqual([]);
    expect(missingFields(DEFAULT_OFFER_TEMPLATE, { ...values, role_title: " ", start_date: "" })).toEqual(["role_title", "start_date"]);
  });
  it("fills the fields after parsing, so a value can never become formatting or a link", () => {
    const sneaky = { ...values, pay_note: "**bold** [click](https://evil.example) # heading" };
    const blocks = renderBlocks("Pay: {{pay_note}}", sneaky);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    const inlines = (blocks[0] as { children: { type: string }[] }).children;
    expect(inlines.every((n) => n.type === "text")).toBe(true);
    expect(inlineText((blocks[0] as unknown as { children: never[] }).children)).toBe("Pay: **bold** [click](https://evil.example) # heading");
    expect(parseMarkdown("Pay: x")).toHaveLength(1);
  });
  it("cleans values: braces and control characters go, names lose formatting characters, length is bounded", () => {
    expect(cleanValue("a{{b}}\nc\u0007")).toBe("ab c");
    expect(cleanValue("Ana [Reyes](x) *_`", { name: true })).toBe("Ana Reyesx");
    expect(cleanValue("x".repeat(500))).toHaveLength(300);
  });
});

describe("the PDF", () => {
  it("draws the letter with headings, lists and bold text, and survives characters the font cannot draw", async () => {
    const bytes = await renderOfferPdf({ title: "Offer: VA", blocks: renderBlocks(`${DEFAULT_OFFER_TEMPLATE}\n\nGreetings 山田 \u{1F600}`, values), footer: "Elite Resource Services" });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
  it("runs to several pages for a long letter", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${"words ".repeat(40)}`).join("\n\n");
    const bytes = await renderOfferPdf({ title: "Long", blocks: renderBlocks(long, values), footer: "Elite Resource Services" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });
});

describe("offer status", () => {
  it("is the envelope's status", () => {
    expect(offerStatus(null)).toBe("draft");
    expect(offerStatus("draft")).toBe("draft");
    expect(offerStatus("out")).toBe("sent");
    expect(offerStatus("completed")).toBe("signed");
    expect(offerStatus("declined")).toBe("declined");
    expect(offerStatus("expired")).toBe("expired");
    expect(offerStatus("voided")).toBe("withdrawn");
  });
});

describe("validators", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  it("an offer needs a role and a start date and defaults to 7 days", () => {
    const ok = makeOfferSchema.safeParse({ applicationId: ID, templateId: ID, roleTitle: "Virtual Assistant", startDate: "2026-11-02" });
    expect(ok.success && ok.data.expiryDays).toBe(7);
    expect(makeOfferSchema.safeParse({ applicationId: ID, templateId: ID, roleTitle: "VA", startDate: "soon" }).success).toBe(false);
    expect(makeOfferSchema.safeParse({ applicationId: ID, templateId: ID, roleTitle: "Virtual Assistant", startDate: "2026-11-02", expiryDays: 99 }).success).toBe(false);
  });
  it("a template needs a name, and hiring needs a name, an email and a start date", () => {
    expect(offerTemplateSchema.safeParse({ name: "x", body: "y" }).success).toBe(false);
    expect(hireSchema.safeParse({ applicationId: ID, legalFirstName: "Ana", legalLastName: "Reyes", workEmail: "ANA@Example.com", startDate: "2026-11-02" }).success).toBe(true);
    expect(hireSchema.safeParse({ applicationId: ID, legalFirstName: "", legalLastName: "Reyes", workEmail: "a@b.co", startDate: "2026-11-02" }).success).toBe(false);
  });
});
