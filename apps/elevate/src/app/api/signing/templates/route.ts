import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { randomUUID } from "node:crypto";
import { MAX_PDF_BYTES, isPdf } from "@/modules/signing/constants";
import { sha256Hex } from "@/modules/signing/chain";
import { esignTemplates } from "@/modules/signing/schema";
import { readPdfInfo } from "@/modules/signing/seal";
import { templateSchema } from "@/modules/signing/validators";

// HR saves a PDF as a reusable template (with the signer roles it needs). Same guards as creating an envelope.

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
  let roles: unknown;
  try {
    roles = JSON.parse(String(form.get("roles") ?? "[]"));
  } catch {
    return json({ ok: false, error: "Check the roles and try again." }, 400);
  }
  const parsed = templateSchema.safeParse({ name: form.get("name") ?? undefined, description: form.get("description") ?? undefined, roles });
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, 400);
  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) return json({ ok: false, error: "Attach the PDF." }, 400);
  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES || !isPdf(bytes)) return json({ ok: false, error: "That file is not a PDF of 8 MB or less." }, 400);
  let pages: number;
  try {
    pages = (await readPdfInfo(bytes)).pages;
  } catch {
    return json({ ok: false, error: "That PDF cannot be used. Password-protected or damaged files are refused." }, 400);
  }

  const path = `templates/${randomUUID()}.pdf`;
  const storage = getDocumentStorage();
  await storage.write(BUCKETS.signed, path, bytes, "application/pdf");
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(esignTemplates)
        .values({ name: parsed.data.name, description: parsed.data.description ?? null, filePath: path, sha256: sha256Hex(bytes), fileName: upload.name.slice(0, 200) || "template.pdf", pageCount: pages, roles: parsed.data.roles, createdBy: actor.id })
        .returning({ id: esignTemplates.id });
      await writeAudit({ actor, action: "signing.template_create", targetType: "esign_template", targetId: row.id, after: { pages, roles: parsed.data.roles.length } }, tx);
      return row.id;
    });
    revalidatePath("/signing");
    return json({ ok: true, id });
  } catch (error) {
    await storage.remove(BUCKETS.signed, [path]).catch(() => undefined);
    const duplicate = error instanceof Error && /esign_templates_name_idx|duplicate key/.test(`${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}`);
    if (duplicate) return json({ ok: false, error: "A template with that name already exists." }, 400);
    console.error("create template failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
