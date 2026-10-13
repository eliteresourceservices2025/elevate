import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";
import { getEmailSender } from "@/modules/notifications/email";
import { renderEmail } from "@/modules/notifications/email-content";
import { hrUserIds } from "@/modules/notifications/service";

// Helpers for the incident actions. They take no acting user: the actions in actions.ts authorize first.

/** Everyone who handles reports: HR Admins, Super Admins and the designated Privacy Officers (active accounts, once each). */
export async function handlerUserIds(): Promise<string[]> {
  const hr = await hrUserIds();
  const officers = await db.select({ id: users.id }).from(users).where(and(eq(users.isPrivacyOfficer, true), isNull(users.archivedAt)));
  return [...new Set([...hr, ...officers.map((o) => o.id)])];
}

/**
 * One email to each person, saying only that a report arrived (no kind, no text, no names) and linking to the inbox. Sent straight
 * away, because the clock on a breach starts when it is discovered. A missing or failing email service never loses a report: the
 * report and the in-app notice are already saved. Returns how many were sent.
 */
export async function emailHandlers(userIds: string[], urgent: boolean): Promise<number> {
  const sender = getEmailSender();
  if (!sender || userIds.length === 0) return 0;
  const people = await db.select({ email: users.email }).from(users).where(and(inArray(users.id, userIds), isNull(users.archivedAt)));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const rendered = renderEmail({
    heading: urgent ? "A privacy incident report needs a look today" : "A privacy incident report was filed",
    lines: ["Sign in to ELEVATE to read it. Details are never sent by email."],
    link: "/incidents",
    appUrl,
  });
  let sent = 0;
  for (const person of people) {
    try {
      await sender.send({ to: person.email, subject: urgent ? "ELEVATE: privacy incident report (ongoing)" : "ELEVATE: privacy incident report", text: rendered.text, html: rendered.html });
      sent += 1;
    } catch {
      console.error("incident email failed");
    }
  }
  return sent;
}
