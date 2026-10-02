import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkCode } from "@/modules/signing/external";
import { guard, json } from "@/modules/signing/external-route";

// Checks the code. The right one starts a two-hour session: a random value in an httpOnly cookie (only its hash is stored).

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await guard(token, { needSession: false, limit: "signVerify" });
  if (!g.ok) return g.response;
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const result = await checkCode(g.ctx, typeof body?.code === "string" ? body.code.trim() : "", g.ip);
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  const response: NextResponse = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, result.session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 2 * 60 * 60 });
  return response;
}
