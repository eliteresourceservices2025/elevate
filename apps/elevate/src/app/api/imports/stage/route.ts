import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { parseCsv, MAX_CSV_BYTES, type ParsedCsv } from "@/modules/imports/csv";
import { parseXlsx } from "@/modules/imports/xlsx";
import { checkMapping, defaultMapping } from "@/modules/imports/mapping";
import { stageBatch } from "@/modules/imports/service";
import { stageFormSchema } from "@/modules/imports/validators";

// HR uploads a TalentHR export (CSV). With no mapping the file is only read and the default column choices are returned; with a mapping it
// is staged as a preview batch. Nothing is created until the batch is committed. Same guards as other uploads.

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const actor = await requireUser();
  try {
    await authorize(actor, "imports.manage");
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ ok: false, error: "You do not have access to do that." }, 403);
    throw error;
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CSV_BYTES + 100_000) return json({ ok: false, error: "The file is larger than 2 MB." }, 413);
  if (!(await allowRequest("upload", actor.id))) return json({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "We could not read the form. Please try again." }, 400);
  }
  const upload = form.get("file");
  if (!(upload instanceof File) || upload.size === 0) return json({ ok: false, error: "Attach the CSV or Excel file." }, 400);
  if (upload.size > MAX_CSV_BYTES) return json({ ok: false, error: "The file is larger than 2 MB." }, 413);
  const isXlsx = /\.xlsx$/i.test(upload.name);
  if (!isXlsx && !/\.csv$/i.test(upload.name)) return json({ ok: false, error: "Upload the export as a .csv or .xlsx file." }, 400);
  // An Excel file is read by its content (a zip), a CSV as text; the extension only chooses which reader to try
  const parsed: ParsedCsv = isXlsx ? await parseXlsx(new Uint8Array(await upload.arrayBuffer())) : parseCsv(await upload.text());
  if ("error" in parsed) return json({ ok: false, error: parsed.error }, 400);

  const rawMapping = form.get("mapping");
  if (rawMapping === null) {
    // First step: tell the screen which columns the file has and where each would go by default
    return json({ ok: true, headers: parsed.headers, mapping: defaultMapping(parsed.headers), rows: parsed.rows.length });
  }
  let mappingJson: unknown;
  try {
    mappingJson = JSON.parse(String(rawMapping));
  } catch {
    return json({ ok: false, error: "Check the column choices and try again." }, 400);
  }
  const options = stageFormSchema.safeParse({ dateFormat: form.get("dateFormat") ?? "mdy", mapping: mappingJson });
  if (!options.success) return json({ ok: false, error: options.error.issues[0]?.message ?? "Check the column choices." }, 400);
  const problems = checkMapping(options.data.mapping, parsed.headers);
  if (problems.length > 0) return json({ ok: false, error: problems[0] }, 400);

  try {
    const { batchId, summary } = await stageBatch(actor, { fileName: upload.name.replace(/^.*[\\/]/, ""), headers: parsed.headers, rows: parsed.rows, mapping: options.data.mapping, dateFormat: options.data.dateFormat });
    revalidatePath("/settings/import");
    return json({ ok: true, batchId, summary });
  } catch (error) {
    if (error instanceof ActionFailure) return json({ ok: false, error: error.message }, 400);
    console.error("import stage failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
