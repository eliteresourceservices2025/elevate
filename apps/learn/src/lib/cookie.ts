import { SESSION_ABSOLUTE_HOURS } from "./constants";

// The only cookie this app sets: a random session value (its hash is what the database holds). `__Host-` pins it to this exact host
// over HTTPS (browsers refuse it with a Domain or a non-root Path), which needs `Secure`, so it is used in production only.

export function cookieName(production: boolean): string {
  return production ? "__Host-learn_session" : "learn_session";
}

export function sessionCookie(value: string, production: boolean): string {
  const parts = [`${cookieName(production)}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_ABSOLUTE_HOURS * 3600}`];
  if (production) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(production: boolean): string {
  const parts = [`${cookieName(production)}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (production) parts.push("Secure");
  return parts.join("; ");
}

/** Reads this app's session value out of a Cookie header (nothing else is ever read). */
export function readSessionValue(cookieHeader: string | null, production: boolean): string | null {
  if (!cookieHeader) return null;
  const name = cookieName(production);
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1) || null;
  }
  return null;
}
