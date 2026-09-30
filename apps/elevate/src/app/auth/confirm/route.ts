import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/route-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TYPES: readonly EmailOtpType[] = ["signup", "recovery", "email", "invite", "magiclink", "email_change"];

// Email links (confirm sign-up, reset password) land here.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"), "/mfa")}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
