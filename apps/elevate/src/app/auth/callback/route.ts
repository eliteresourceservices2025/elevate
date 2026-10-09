import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/route-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// OAuth (Google) return. Exchanges the code for a session, then the proxy sends the
// user to MFA. Failures return to the login page with a generic error.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
    console.error("oauth callback: code exchange failed", { name: error.name, status: error.status, code: error.code });
  } else {
    // Supabase sends the reason (for example a refused sign-up or a wrong Google secret) in the address; log only its short code.
    console.error("oauth callback: no code", { error: searchParams.get("error"), code: searchParams.get("error_code"), description: (searchParams.get("error_description") ?? "").slice(0, 120) });
  }
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
