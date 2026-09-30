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
  }
  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
