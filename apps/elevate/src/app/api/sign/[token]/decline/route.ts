import { externalDecline } from "@/modules/signing/external";
import { guard, respond } from "@/modules/signing/external-route";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await guard(token, { needSession: true });
  if (!g.ok) return g.response;
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  return respond(async () => {
    await externalDecline(g.ctx, typeof body?.reason === "string" ? body.reason : "", g.ip);
  });
}
