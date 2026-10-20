import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport }, createTransport }));

import { dailyEmailBudget } from "./email-queue";
import { emailProvider, getEmailSender } from "./email";

const KEYS = ["EMAIL_PROVIDER", "BREVO_SMTP_LOGIN", "BREVO_SMTP_KEY", "BREVO_SMTP_HOST", "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "EMAIL_DAILY_BUDGET"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  sendMail.mockReset();
  createTransport.mockClear();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("email provider choice", () => {
  it("defaults to Resend, switches to Brevo when its key is set, and EMAIL_PROVIDER wins", () => {
    expect(emailProvider()).toBe("resend");
    process.env.BREVO_SMTP_KEY = "k";
    expect(emailProvider()).toBe("brevo");
    process.env.EMAIL_PROVIDER = "resend";
    expect(emailProvider()).toBe("resend");
    process.env.EMAIL_PROVIDER = " Brevo ";
    expect(emailProvider()).toBe("brevo");
  });

  it("sends nothing (null sender) when Brevo is chosen but not fully configured", () => {
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_SMTP_KEY = "k";
    process.env.EMAIL_FROM = "ELEVATE <hello@example.com>";
    expect(getEmailSender()).toBeNull();
  });

  it("budget defaults to 90 on Resend and 250 on Brevo; EMAIL_DAILY_BUDGET overrides", () => {
    expect(dailyEmailBudget()).toBe(90);
    process.env.EMAIL_PROVIDER = "brevo";
    expect(dailyEmailBudget()).toBe(250);
    process.env.EMAIL_DAILY_BUDGET = "50";
    expect(dailyEmailBudget()).toBe(50);
  });
});

describe("Brevo SMTP sender", () => {
  function configure() {
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_SMTP_LOGIN = "login@smtp-brevo.com";
    process.env.BREVO_SMTP_KEY = "secret";
    process.env.EMAIL_FROM = "ELEVATE <hello@example.com>";
    process.env.EMAIL_REPLY_TO = "hr@example.com";
  }

  it("connects to Brevo on 587 with STARTTLS required and timeouts", () => {
    configure();
    expect(getEmailSender()).not.toBeNull();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp-relay.brevo.com", port: 587, secure: false, requireTLS: true, pool: true, maxConnections: 1, auth: { user: "login@smtp-brevo.com", pass: "secret" }, connectionTimeout: 10_000 }),
    );
  });

  it("maps the message, default reply-to, bcc and attachments", async () => {
    configure();
    sendMail.mockResolvedValue({});
    await getEmailSender()!.send({
      to: "a@example.com",
      subject: "Hi",
      text: "t",
      html: "<p>t</p>",
      bcc: "talent@example.com",
      attachments: [
        { fileName: "day.ics", mimeType: "text/calendar", content: "BEGIN:VCALENDAR" },
        { fileName: "c.pdf", mimeType: "application/pdf", content: "UERG", base64: true },
      ],
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "ELEVATE <hello@example.com>",
      to: "a@example.com",
      replyTo: "hr@example.com",
      bcc: "talent@example.com",
      subject: "Hi",
      text: "t",
      html: "<p>t</p>",
      attachments: [
        { filename: "day.ics", contentType: "text/calendar", content: "BEGIN:VCALENDAR" },
        { filename: "c.pdf", contentType: "application/pdf", content: "UERG", encoding: "base64" },
      ],
    });
  });

  it("a per-message reply-to wins over the default", async () => {
    configure();
    sendMail.mockResolvedValue({});
    await getEmailSender()!.send({ to: "a@example.com", subject: "s", text: "t", html: "h", replyTo: "asker@example.com" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "asker@example.com" }));
  });

  it("failures keep only the status code, never the recipient address", async () => {
    configure();
    sendMail.mockRejectedValue(Object.assign(new Error("550 rejected a@example.com"), { responseCode: 550 }));
    await expect(getEmailSender()!.send({ to: "a@example.com", subject: "s", text: "t", html: "h" })).rejects.toThrow("Email provider refused the message (SMTP 550)");
  });
});
