import { requestCode } from "@/modules/signing/external";
import { guard, json, respond } from "@/modules/signing/external-route";

// An outside signer asks for a 6-digit code, emailed to the address the link was sent to. Limited per link and per address.

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await guard(token, { needSession: false, limit: "signCode" });
  if (!g.ok) return g.response;
  const result = await requestCode(g.ctx);
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return respond(async () => ({ sent: true }));
}
