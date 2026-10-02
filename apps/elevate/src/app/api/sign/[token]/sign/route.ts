import { externalSign, type ExternalSignInput } from "@/modules/signing/external";
import { guard, respond } from "@/modules/signing/external-route";

// An outside signer signs: consent, then a typed or drawn signature. Same rules as an ELEVATE user (recordSignature): it must be their
// turn and they must have opened the document first.

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await guard(token, { needSession: true });
  if (!g.ok) return g.response;
  const body = (await request.json().catch(() => null)) as Partial<ExternalSignInput> | null;
  return respond(async () => {
    await externalSign(g.ctx, { consent: body?.consent === true, kind: body?.kind === "drawn" ? "drawn" : "typed", typedText: typeof body?.typedText === "string" ? body.typedText.slice(0, 60) : undefined, pngBase64: typeof body?.pngBase64 === "string" ? body.pngBase64.slice(0, 90_000) : undefined }, g.ip);
  });
}
