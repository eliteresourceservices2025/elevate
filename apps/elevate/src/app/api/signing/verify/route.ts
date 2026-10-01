import { NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { verifyFingerprint } from "@/modules/signing/queries";
import { verifySchema } from "@/modules/signing/validators";

// Public: "is this PDF a sealed ELEVATE document?" The browser hashes the file and sends only the fingerprint, so the file itself
// never leaves the person's computer. The answer is a match or not, with the seal date and reference: nothing about who signed.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!(await allowRequest("verify", await clientIp()))) return json({ ok: false, error: "Too many checks. Please try again in a few minutes." }, 429);
  const body = await request.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "That is not a valid fingerprint." }, 400);
  const result = await verifyFingerprint(parsed.data.sha256);
  return json(result.match ? { ok: true, match: true, reference: result.reference, sealedAt: result.sealedAt.toISOString() } : { ok: true, match: false });
}
