import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export type SessionState = {
  response: NextResponse;
  userId: string | null;
  aal: "aal1" | "aal2" | null;
};

/**
 * Refresh the Supabase session cookie and report who is signed in and at which
 * assurance level. Does not decide access; proxy.ts does.
 */
export async function refreshSession(request: NextRequest): Promise<SessionState> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getClaims validates the token signature, so a forged cookie cannot pass.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  return {
    response,
    userId: claims?.sub ?? null,
    aal: claims ? (claims.aal === "aal2" ? "aal2" : "aal1") : null,
  };
}
