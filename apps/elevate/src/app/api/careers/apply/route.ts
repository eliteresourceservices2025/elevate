import { NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { RESUME_MAX_BYTES } from "@/modules/recruiting/constants";
import { submitApplication } from "@/modules/recruiting/service";

// The public apply form posts here. No sign-in: the rate limit (per address, fails closed in production), the honeypot, the
// consent tick and the file checks in submitApplication() are the guards. Nothing about an existing applicant is revealed.

const json = (body: { ok: boolean; error?: string; field?: string }, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > RESUME_MAX_BYTES + 200_000) return json({ ok: false, error: "Your resume is too large. The limit is 4 MB.", field: "resume" }, 413);

  if (!(await allowRequest("careers", await clientIp()))) return json({ ok: false, error: "Too many applications from this connection. Please try again later." }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "We could not read the form. Please try again." }, 400);
  }
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : undefined;
  };
  const upload = form.get("resume");
  const file = upload instanceof File && upload.size > 0 ? { bytes: new Uint8Array(await upload.arrayBuffer()), name: upload.name } : null;

  try {
    const result = await submitApplication(
      { openingId: text("openingId"), fullName: text("fullName"), email: text("email"), phone: text("phone"), country: text("country"), note: text("note"), consent: text("consent") === "on" || text("consent") === "true" ? true : false, website: text("website") ?? "" },
      file,
    );
    return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error, field: result.field }, 400);
  } catch (error) {
    console.error("apply failed:", error instanceof Error ? error.name : "unknown error"); // no request data
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
