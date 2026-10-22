import { describe, expect, it } from "vitest";
import { BODY_MAX, BUILT_IN_TEMPLATES, SUBJECT_MAX, TEMPLATE_KINDS, notQualifiedMail, receivedMail, rejectionMail, renderTemplate, validateTemplate } from "./mail";

const who = { fullName: "Ana Maria Reyes", jobTitle: "Virtual Assistant" };

describe("built-in templates", () => {
  it("are valid, fill both fields, and keep to the rule of never carrying an assessment of the applicant", () => {
    for (const kind of TEMPLATE_KINDS) {
      expect(validateTemplate(BUILT_IN_TEMPLATES[kind])).toBeNull();
      const mail = renderTemplate(BUILT_IN_TEMPLATES[kind], who);
      expect(mail.text).toContain("Hi Ana,");
      expect(mail.text).toContain("Virtual Assistant");
      expect(mail.text).not.toContain("{{");
      expect(mail.text.toLowerCase()).not.toMatch(/score|rating|match %|keyword/);
    }
    expect(receivedMail(who).subject).toBe("We received your application");
    expect(rejectionMail(who).subject).toBe("About your application");
    expect(notQualifiedMail(who).text).toContain("requirements for this role");
  });
});

describe("renderTemplate", () => {
  it("uses the wording given, in paragraphs, and escapes what it fills in", () => {
    const mail = renderTemplate({ subject: "Hello {{first_name}}!", body: "Line one for {{ job_title }}.\n\nLine two." }, { fullName: "<b>Ana</b> Reyes", jobTitle: "A & B <i>role</i>" });
    expect(mail.subject).toBe("Hello <b>Ana</b>!"); // plain-text subject: no HTML involved
    expect(mail.text).toContain("A & B <i>role</i>");
    expect(mail.html).not.toContain("<i>role</i>");
    expect(mail.html).toContain("A &amp; B &lt;i&gt;role&lt;/i&gt;");
    expect(mail.html).toContain("Line two.");
  });
});

describe("validateTemplate", () => {
  const ok = { subject: "Hi", body: "Hello {{first_name}}" };
  it("accepts the two merge fields", () => {
    expect(validateTemplate({ subject: "About {{job_title}}", body: "{{first_name}}, {{ job_title }}" })).toBeNull();
  });
  it("refuses an unknown or unclosed field, an empty subject or message, and text that is too long", () => {
    expect(validateTemplate({ ...ok, body: "Hello {{salary}}" })).toContain("Unknown field {{salary}}");
    expect(validateTemplate({ ...ok, subject: "{{score}}" })).toContain("Unknown field");
    expect(validateTemplate({ ...ok, body: "Hello {{first_name" })).toContain("not closed");
    expect(validateTemplate({ ...ok, subject: "  " })).toBe("Write a subject.");
    expect(validateTemplate({ ...ok, body: "" })).toBe("Write the message.");
    expect(validateTemplate({ ...ok, subject: "x".repeat(SUBJECT_MAX + 1) })).toContain("subject");
    expect(validateTemplate({ ...ok, body: "x".repeat(BODY_MAX + 1) })).toContain("message");
  });
});
