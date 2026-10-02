import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Safe Voice never wants to know who is calling. Before any route runs, everything that could identify a person or a session is removed
// from the request the app sees: the browser's cookies, its user agent and the page it came from. The address header stays only
// because the rate limiter needs something to key on (it is hashed in memory and never stored; see src/lib/rate-limit.ts).
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const name of ["cookie", "authorization", "user-agent", "referer"]) headers.delete(name);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
