import { errorDetail } from "@/lib/error-detail";
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
import { assertSigneeValues, loadSigneeValues, renderComposedPdf, renderForSignee } from "@/modules/signing/compose";
import { fieldsUsed, mergeProblem, unfilledPlaceholders } from "@/modules/signing/merge";
import { composedBodySchema, countersignerSchema, createEnvelopeSchema } from "@/modules/signing/validators";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// HR creates (and usually sends) an envelope from an uploaded PDF or a saved template. A route handler rather than a server action
// because the PDF is large. requireUser() (MFA enforced) and authorize() come first, exactly as in an action.

const json = (body: { ok: boolean; error?: string; id?: string; count?: number }, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const actor = await requireUser();
  try {
    await authorize(actor, "signing.manage");
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ ok: false, error: "You do not have access to do that." }, 403);
    throw error;
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PDF_BYTES + 100_000) return json({ ok: false, error: "The PDF must be 8 MB or smaller." }, 413);
  // A "check" request only validates (no file stored, nothing created), so it does not count against the upload limit.
  const checkOnly = new URL(request.url).searchParams.get("check") === "1";
  if (!checkOnly && !(await allowRequest("upload", actor.id))) return json({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);

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
    return json({ ok: false, error: "Check the signees and try again." }, 400);
  }
  const parsed = createEnvelopeSchema.safeParse({ title: field("title"), templateId: field("templateId"), signers, order: field("order"), expiryDays: field("expiryDays"), send: field("send") !== "false" });
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, 400);
  const v = parsed.data;

  try {
    let pdf: Uint8Array | null = null;
    let fileName = "document.pdf";
    const content = field("content");
    const each = field("individual") === "true";
    // Details filled in from each person's record: {{contractor_name}} and the like (documents written in ELEVATE only).
    let pdfFor: ((userId: string) => Promise<Uint8Array>) | null = null;
    if (content !== undefined && content.trim() !== "") {
      // Written in the editor: rendered to a PDF here, then it is an ordinary envelope.
      const body = composedBodySchema.safeParse(content);
      if (!body.success) return json({ ok: false, error: body.error.issues[0]?.message ?? "Check the document and try again." }, 400);
      const problem = mergeProblem(body.data);
      if (problem) return json({ ok: false, error: problem }, 400);
      const unfilled = unfilledPlaceholders(body.data);
      if (unfilled.length) return json({ ok: false, error: `Fill in ${unfilled.map((u) => `[[${u}]]`).join(", ")} in the document before sending.` }, 400);
      if (fieldsUsed(body.data).length > 0) {
        if (!each && v.signers.length > 1) return json({ ok: false, error: "This document fills in one person's details, so it must go out as each person's own copy. Tick Each person signs their own copy." }, 400);
        const ids = v.signers.map((s) => s.userId);
        const people = await loadSigneeValues(ids);
        assertSigneeValues(body.data, people, ids);
        if (checkOnly) return json({ ok: true, count: ids.length });
        pdfFor = async (userId) => renderForSignee(v.title, body.data, people.get(userId) as { values: Record<string, string> });
      } else {
        if (checkOnly) return json({ ok: true, count: v.signers.length });
        pdf = await renderComposedPdf(v.title, body.data);
      }
      fileName = `${v.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || "document"}.pdf`;
    } else if (v.templateId) {
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
    if (checkOnly) return json({ ok: true, count: v.signers.length });
    // The Company's countersigner (optional, per-person copies only): signs after each person, on every copy.
    let counter: { userId: string; role: string | null } | null = null;
    const counterRaw = field("countersigner");
    if (counterRaw) {
      let counterJson: unknown;
      try {
        counterJson = JSON.parse(counterRaw);
      } catch {
        return json({ ok: false, error: "Check the countersigner and try again." }, 400);
      }
      const c = countersignerSchema.safeParse(counterJson);
      if (!c.success) return json({ ok: false, error: c.error.issues[0]?.message ?? "Check the countersigner and try again." }, 400);
      if (v.signers.some((s) => s.userId === c.data.userId)) return json({ ok: false, error: "The countersigner cannot also be one of the people signing their own copy." }, 400);
      counter = { userId: c.data.userId, role: c.data.role ?? null };
    }
    if (counter && !each) return json({ ok: false, error: "A countersigner is added when each person signs their own copy." }, 400);
    const ip = await clientIp();
    const base = { title: v.title, fileName, templateId: v.templateId ?? null, order: v.order, expiryDays: v.expiryDays, send: v.send, ip: ip === "unknown" ? null : ip, initialEachPage: field("initialEachPage") === "true" };
    if (each) {
      // Each person gets their own copy (their own envelope, signature and sealed file): used for "everyone", a team or a client.
      // The browser sends the people in batches of at most MAX_SIGNERS, so one request stays well inside the time limit.
      let first: string | undefined;
      let done = 0;
      try {
        for (const s of v.signers) {
          const { id } = await createEnvelope(actor, { ...base, pdf: pdfFor ? await pdfFor(s.userId) : (pdf as Uint8Array), signers: [{ userId: s.userId, role: s.role ?? null, position: 1 }, ...(counter ? [{ userId: counter.userId, role: counter.role, position: 2 }] : [])] });
          first ??= id;
          done += 1;
        }
      } finally {
        revalidatePath("/signing");
      }
      return json({ ok: true, id: first, count: done });
    }
    const { id } = await createEnvelope(actor, { ...base, pdf: pdfFor ? await pdfFor(v.signers[0].userId) : (pdf as Uint8Array), signers: v.signers });
    revalidatePath("/signing");
    return json({ ok: true, id, count: 1 });
  } catch (error) {
    if (error instanceof ActionFailure) return json({ ok: false, error: error.message }, 400);
    console.error("create envelope failed:", errorDetail(error));
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
