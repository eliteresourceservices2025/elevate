// Pure access rules for proxy.ts (CLAUDE.md: no page works at AAL1 except MFA enrollment/challenge).

export type Aal = "aal1" | "aal2" | null;
export type AccessDecision = { action: "allow" } | { action: "redirect"; to: string };

const PUBLIC_PREFIXES = ["/careers", "/auth", "/verify", "/sign"];
const GUEST_PATHS = ["/login", "/signup", "/forgot-password"];

const matches = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function decideAccess(pathname: string, aal: Aal): AccessDecision {
  if (PUBLIC_PREFIXES.some((p) => matches(pathname, p))) return { action: "allow" };

  if (GUEST_PATHS.some((p) => matches(pathname, p))) {
    if (aal === "aal2") return { action: "redirect", to: "/dashboard" };
    if (aal === "aal1") return { action: "redirect", to: "/mfa" };
    return { action: "allow" };
  }

  if (matches(pathname, "/mfa")) {
    if (aal === null) return { action: "redirect", to: "/login" };
    if (aal === "aal2") return { action: "redirect", to: "/dashboard" };
    return { action: "allow" };
  }

  // Reached from the password-reset email link; needs a session but not MFA.
  if (matches(pathname, "/reset-password")) {
    return aal === null ? { action: "redirect", to: "/login" } : { action: "allow" };
  }

  if (aal === null) {
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return { action: "redirect", to: `/login${next}` };
  }
  if (aal === "aal1") return { action: "redirect", to: "/mfa" };
  return { action: "allow" };
}

/** Accept only same-site relative paths, to prevent open redirects via ?next=. */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
