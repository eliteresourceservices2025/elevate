import "server-only";

// Google Calendar for interviews (Phase 3.1b). Plain fetch, no SDK. Only the narrow `calendar.events` permission is requested, plus
// `openid email` so the screen can say which Google account is connected. Tests install a fake with setGoogleClient(): the real
// Google is never called from tests.

export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"] as const;

export class GoogleError extends Error {
  constructor(
    public readonly code: "not_configured" | "reconnect" | "refused" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export type CalendarEventInput = {
  /** Our own id, so a retry cannot create the event twice. Google needs lowercase letters a-v and digits (base32hex), 5 to 1024 characters. */
  eventId: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  minutes: number;
  attendeeEmails: string[];
};

export type CreatedEvent = { eventId: string; meetLink: string | null };

export interface GoogleCalendarClient {
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  /** Trades the one-time code for a refresh token and the account's email. */
  exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string }>;
  createEvent(refreshToken: string, event: CalendarEventInput): Promise<CreatedEvent>;
  deleteEvent(refreshToken: string, eventId: string): Promise<void>;
  revoke(refreshToken: string): Promise<void>;
}

/** The request body for a Calendar event with a Meet link. Pure, so it is tested without Google. */
export function buildCalendarEvent(e: CalendarEventInput) {
  const end = new Date(e.startsAt.getTime() + e.minutes * 60_000);
  return {
    id: e.eventId,
    summary: e.summary,
    ...(e.description ? { description: e.description } : {}),
    ...(e.location ? { location: e.location } : {}),
    start: { dateTime: e.startsAt.toISOString(), timeZone: "UTC" },
    end: { dateTime: end.toISOString(), timeZone: "UTC" },
    attendees: [...new Set(e.attendeeEmails.map((a) => a.toLowerCase()))].map((email) => ({ email })),
    conferenceData: { createRequest: { requestId: e.eventId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
  };
}

/** A Google event id from our interview id: the uuid's hex digits are valid base32hex characters. */
export const googleEventIdFor = (interviewId: string) => `elv${interviewId.replace(/-/g, "")}`;

class HttpGoogleClient implements GoogleCalendarClient {
  private id = () => process.env.GOOGLE_CLIENT_ID ?? "";
  private secret = () => process.env.GOOGLE_CLIENT_SECRET ?? "";

  configured() {
    return Boolean(this.id() && this.secret());
  }

  authUrl(state: string, redirectUri: string) {
    const q = new URLSearchParams({
      client_id: this.id(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: CALENDAR_SCOPES.join(" "),
      access_type: "offline", // gives a refresh token
      prompt: "consent", // always shows consent so Google returns a refresh token even on a reconnect
      include_granted_scopes: "true",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  private async token(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; id_token?: string }> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.id(), client_secret: this.secret(), ...body }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new GoogleError("unavailable", "Google could not be reached.");
    });
    if (response.status === 400 || response.status === 401) {
      const err = (await response.json().catch(() => null)) as { error?: string } | null;
      // invalid_grant = the person revoked access, or a testing-mode token expired after 7 days
      throw new GoogleError(err?.error === "invalid_grant" ? "reconnect" : "refused", `Google refused the request (${err?.error ?? response.status}).`);
    }
    if (!response.ok) throw new GoogleError("unavailable", `Google answered HTTP ${response.status}.`);
    return (await response.json()) as { access_token: string; refresh_token?: string; id_token?: string };
  }

  async exchangeCode(code: string, redirectUri: string) {
    const t = await this.token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (!t.refresh_token) throw new GoogleError("refused", "Google did not return a long-lived permission. Try connecting again.");
    // The id token came straight from Google over TLS in this response, so reading its email claim needs no further check.
    let email = "";
    try {
      const payload = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
      email = payload.email ?? "";
    } catch {
      email = "";
    }
    return { refreshToken: t.refresh_token, email: email || "your Google account" };
  }

  private async access(refreshToken: string) {
    return (await this.token({ grant_type: "refresh_token", refresh_token: refreshToken })).access_token;
  }

  async createEvent(refreshToken: string, event: CalendarEventInput) {
    const access = await this.access(refreshToken);
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildCalendarEvent(event)),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new GoogleError("unavailable", "Google could not be reached.");
    });
    if (response.status === 409) return { eventId: event.eventId, meetLink: null }; // our id already exists: a retry after success
    if (response.status === 401 || response.status === 403) throw new GoogleError("reconnect", `Google refused calendar access (HTTP ${response.status}).`);
    if (!response.ok) throw new GoogleError(response.status >= 500 || response.status === 429 ? "unavailable" : "refused", `Google answered HTTP ${response.status}.`);
    const body = (await response.json()) as { id: string; hangoutLink?: string };
    return { eventId: body.id, meetLink: body.hangoutLink ?? null };
  }

  async deleteEvent(refreshToken: string, eventId: string) {
    const access = await this.access(refreshToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new GoogleError("unavailable", "Google could not be reached.");
    });
    if (response.status === 404 || response.status === 410) return; // already gone
    if (!response.ok) throw new GoogleError(response.status === 401 || response.status === 403 ? "reconnect" : "unavailable", `Google answered HTTP ${response.status}.`);
  }

  async revoke(refreshToken: string) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined); // best effort: the stored token is deleted either way
  }
}

let override: GoogleCalendarClient | null | undefined;
let real: GoogleCalendarClient | null = null;

/** Tests only: install a fake client, or null to behave as "not configured". Pass undefined to restore the real one. */
export function setGoogleClient(client: GoogleCalendarClient | null | undefined) {
  override = client;
}

export function getGoogleClient(): GoogleCalendarClient | null {
  if (override !== undefined) return override;
  real ??= new HttpGoogleClient();
  return real.configured() ? real : null;
}
