import { ActionFailure } from "@/lib/run-action";
import { externalDocument } from "@/modules/signing/external";
import { guard } from "@/modules/signing/external-route";

// The document for an outside signer who has entered the code: shown in the page (inline), or downloaded with ?download=1.
// The sealed copy once everyone has signed, the original before. Served by the app, never cached.

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await guard(token, { needSession: true });
  if (!g.ok) return g.response;
  try {
    const doc = await externalDocument(g.ctx, g.ip);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(Buffer.from(doc.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.fileName.replace(/[^\w .()-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("external document failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
