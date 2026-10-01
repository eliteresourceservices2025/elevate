import { NextResponse } from "next/server";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { MAX_PDF_BYTES } from "@/modules/signing/constants";
import { esignTemplates } from "@/modules/signing/schema";
import { createEnvelope } from "@/modules/signing/service";
import { createEnvelopeSchema } from "@/modules/signing/validators";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// HR creates (and usually sends) an envelope from an uploaded PDF or a saved template. A route handler rather than a server action
// because the PDF is large. requireUser() (MFA enforced) and authorize() come first, exactly as in an action.

const json = (body: { ok: boolean; error?: string; id?: string }, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const actor = await requireUser();
  try {
    await authorize(actor, "signing.manage");
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ ok: false, error: "You do not have access to do that." }, 403);
    throw error;
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PDF_BYTES + 100_000) return json({ ok: false, error: "The PDF must be 8 MB or smaller." }, 413);
  if (!(await allowRequest("upload", actor.id))) return json({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "We could not read the form. Please try again." }, 400);
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : undefined;
  };
  let signers: unknown;
  try {
    signers = JSON.parse(field("signers") ?? "[]");
  } catch {
    return json({ ok: false, error: "Check the signers and try again." }, 400);
  }
  const parsed = createEnvelopeSchema.safeParse({ title: field("title"), templateId: field("templateId"), signers, order: field("order"), expiryDays: field("expiryDays"), send: field("send") !== "false" });
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, 400);
  const v = parsed.data;

  try {
    let pdf: Uint8Array | null = null;
    let fileName = "document.pdf";
    if (v.templateId) {
      const [t] = await db.select().from(esignTemplates).where(eq(esignTemplates.id, v.templateId));
      if (!t || t.archivedAt) return json({ ok: false, error: "That template was not found." }, 400);
      pdf = await getDocumentStorage().read(BUCKETS.signed, t.filePath);
      fileName = t.fileName;
      if (!pdf) return json({ ok: false, error: "The template file is missing. Upload it again." }, 400);
    } else {
      const upload = form.get("file");
      if (!(upload instanceof File) || upload.size === 0) return json({ ok: false, error: "Attach the PDF to send." }, 400);
      pdf = new Uint8Array(await upload.arrayBuffer());
      fileName = upload.name || fileName;
    }
    const ip = await clientIp();
    const { id } = await createEnvelope(actor, { title: v.title, pdf, fileName, templateId: v.templateId ?? null, signers: v.signers, order: v.order, expiryDays: v.expiryDays, send: v.send, ip: ip === "unknown" ? null : ip });
    revalidatePath("/signing");
    return json({ ok: true, id });
  } catch (error) {
    if (error instanceof ActionFailure) return json({ ok: false, error: error.message }, 400);
    console.error("create envelope failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
