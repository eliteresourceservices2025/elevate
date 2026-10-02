import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { GoogleError, getGoogleClient, type CalendarEventInput } from "./google";
import { calendarConnections } from "./schema";

// Connecting a recruiter's own Google Calendar, and putting interviews on it. A connection belongs to one person and is used only
// for interviews that person schedules. The refresh token is encrypted with the field-encryption key and bound to the user; access
// tokens are fetched when needed and never stored. Google being down or refusing never blocks scheduling: the caller falls back to
// the .ics emails and tells the recruiter why.

export const STATE_COOKIE = "elevate_gcal_state";
const context = (userId: string) => `google_calendar:${userId}`;

export const redirectUri = () => `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/api/google/callback`;

/** A one-time value kept in a cookie in the browser that starts the connection and checked when Google sends the person back (CSRF). */
export const newState = () => randomBytes(24).toString("base64url");
export function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export type CalendarStatus = { configured: boolean; connected: boolean; email: string | null; needsReconnect: boolean };

export async function calendarStatus(userId: string): Promise<CalendarStatus> {
  const configured = getGoogleClient()?.configured() ?? false;
  const [row] = await db.select({ email: calendarConnections.googleEmail, needsReconnect: calendarConnections.needsReconnect }).from(calendarConnections).where(eq(calendarConnections.userId, userId));
  return { configured, connected: Boolean(row), email: row?.email ?? null, needsReconnect: row?.needsReconnect ?? false };
}

/** Saves the connection after Google sends the person back with a code. Callers have checked the state cookie and the session. */
export async function completeConnection(actor: AuthUser, code: string): Promise<{ email: string }> {
  await authorize(actor, "recruiting.connect_calendar", { ownerUserId: actor.id });
  const client = getGoogleClient();
  if (!client) throw new ActionFailure("Google Calendar is not set up on this server.");
  const { refreshToken, email } = await client.exchangeCode(code, redirectUri());
  const enc = fieldCrypto().encrypt(refreshToken, context(actor.id));
  await db.transaction(async (tx) => {
    await tx
      .insert(calendarConnections)
      .values({ userId: actor.id, googleEmail: email, refreshTokenEnc: enc })
      .onConflictDoUpdate({ target: calendarConnections.userId, set: { googleEmail: email, refreshTokenEnc: enc, connectedAt: new Date(), needsReconnect: false } });
    await writeAudit({ actor, action: "recruiting.calendar_connect", targetType: "user", targetId: actor.id, after: { email } }, tx);
  });
  return { email };
}

export async function removeConnection(actor: AuthUser): Promise<void> {
  await authorize(actor, "recruiting.connect_calendar", { ownerUserId: actor.id });
  const [row] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, actor.id));
  if (!row) return;
  const client = getGoogleClient();
  if (client) await client.revoke(fieldCrypto().decrypt(row.refreshTokenEnc, context(actor.id))).catch(() => undefined);
  await db.transaction(async (tx) => {
    await tx.delete(calendarConnections).where(eq(calendarConnections.userId, actor.id));
    await writeAudit({ actor, action: "recruiting.calendar_disconnect", targetType: "user", targetId: actor.id }, tx);
  });
}

async function tokenFor(userId: string): Promise<string | null> {
  const [row] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  if (!row || row.needsReconnect) return null;
  return fieldCrypto().decrypt(row.refreshTokenEnc, context(userId));
}

async function flagReconnect(userId: string) {
  await db.update(calendarConnections).set({ needsReconnect: true }).where(eq(calendarConnections.userId, userId));
}

export type EventResult = { mode: "google"; eventId: string; meetLink: string | null } | { mode: "ics"; warning: string | null };

/**
 * Tries to put the interview on the scheduler's own Google Calendar. Returns how it went: "google" with the event and Meet link, or
 * "ics" (invites go out as email files instead) with a warning when the person IS connected but Google failed. Never throws.
 */
export async function createInterviewEvent(userId: string, event: CalendarEventInput): Promise<EventResult> {
  const client = getGoogleClient();
  if (!client) return { mode: "ics", warning: null };
  const token = await tokenFor(userId);
  if (!token) {
    const [row] = await db.select({ needs: calendarConnections.needsReconnect }).from(calendarConnections).where(eq(calendarConnections.userId, userId));
    return { mode: "ics", warning: row?.needs ? "Your Google Calendar connection needs to be renewed, so the invites went out by email. Reconnect it on the Recruiting page." : null };
  }
  try {
    const created = await client.createEvent(token, event);
    return { mode: "google", eventId: created.eventId, meetLink: created.meetLink };
  } catch (error) {
    if (error instanceof GoogleError && error.code === "reconnect") {
      await flagReconnect(userId);
      return { mode: "ics", warning: "Google no longer lets ELEVATE use your calendar (access was removed or expired), so the invites went out by email. Reconnect it on the Recruiting page." };
    }
    console.error("google event failed:", error instanceof GoogleError ? error.code : "unknown error");
    return { mode: "ics", warning: "Google Calendar could not be reached, so the invites went out by email instead." };
  }
}

/** Removes the event when an interview is cancelled (Google tells the guests). Returns a warning when it could not. Never throws. */
export async function deleteInterviewEvent(userId: string, eventId: string): Promise<string | null> {
  const client = getGoogleClient();
  const token = client ? await tokenFor(userId) : null;
  if (!client || !token) return "The Google Calendar event could not be removed (the calendar is not connected). Delete it in Google Calendar.";
  try {
    await client.deleteEvent(token, eventId);
    return null;
  } catch (error) {
    if (error instanceof GoogleError && error.code === "reconnect") await flagReconnect(userId);
    return "The Google Calendar event could not be removed. Delete it in Google Calendar.";
  }
}

/** Best effort: undo an event created for an interview that then failed to save. */
export async function discardInterviewEvent(userId: string, eventId: string): Promise<void> {
  await deleteInterviewEvent(userId, eventId).catch(() => undefined);
}
