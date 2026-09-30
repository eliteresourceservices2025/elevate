import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/route-access";
import { refreshSession } from "@/lib/supabase/proxy";

// Session refresh + AAL2 gate. This is the first line of defence only:
// every server action and query still calls requireUser() and authorize().
export async function proxy(request: NextRequest) {
  const { response, aal } = await refreshSession(request);
  const decision = decideAccess(request.nextUrl.pathname, aal);

  if (decision.action === "allow") return response;

  const url = new URL(decision.to, request.url);
  const redirect = NextResponse.redirect(url);
  // Keep any refreshed session cookies on the redirect response.
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // API routes (Inngest, cron) do their own auth with signing keys / CRON_SECRET.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
