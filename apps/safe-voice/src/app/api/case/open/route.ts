import { appDeps } from "@/lib/deps";
import { handleOpen } from "@/lib/handlers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let deps;
  try {
    deps = appDeps();
  } catch {
    return Response.json({ ok: false, error: "Safe Voice is not available right now. Please try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return handleOpen(request, deps);
}
