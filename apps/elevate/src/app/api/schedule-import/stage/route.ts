import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { MAX_CSV_BYTES, parseCsvRecords } from "@/modules/imports/csv";
import { parseXlsxRecords } from "@/modules/imports/xlsx";
import { detectLayout, guessTableColumns, readDayBlocks, readTable, type ReadResult, type TableColumns } from "@/modules/schedule-import/reader";
import { stageSheet } from "@/modules/schedule-import/service";

// HR uploads the attendance sheet (CSV or Excel). A sheet in the day-block layout is read straight away; a plain table first returns its
// headers so HR can say which column is which. Either way the rows are only staged for a PREVIEW: nothing is changed in ELEVATE.

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const columnsSchema = z.object({
  name: z.number().int().min(0).max(200),
  client: z.number().int().min(0).max(200),
  schedule: z.number().int().min(0).max(200),
  date: z.number().int().min(0).max(200).nullable(),
  clockIn: z.number().int().min(0).max(200).nullable(),
});

export async function POST(request: Request) {
  const actor = await requireUser();
  try {
    await authorize(actor, "scheduleimport.manage");
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
  if (!isXlsx && !/\.csv$/i.test(upload.name)) return json({ ok: false, error: "Upload the sheet as a .csv or .xlsx file." }, 400);

  const bytes = new Uint8Array(await upload.arrayBuffer());
  const read = isXlsx ? await parseXlsxRecords(bytes) : parseCsvRecords(new TextDecoder().decode(bytes));
  if ("error" in read) return json({ ok: false, error: read.error }, 400);
  const records = read.records;
  if (records.length > 6000) return json({ ok: false, error: "The sheet has too many rows." }, 400);

  const layout = detectLayout(records);
  let result: ReadResult;
  let columns: TableColumns | null = null;

  if (layout === "day_blocks") {
    result = readDayBlocks(records);
  } else {
    const headers = (records[0] ?? []).map((h) => h.trim());
    const rawColumns = form.get("columns");
    if (rawColumns === null) {
      // Step one for a plain table: say which columns the sheet has and our guess for each
      return json({ ok: true, layout, headers, guess: guessTableColumns(headers), rows: Math.max(records.length - 1, 0) });
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(String(rawColumns));
    } catch {
      return json({ ok: false, error: "Check the column choices and try again." }, 400);
    }
    const picked = columnsSchema.safeParse(parsedJson);
    if (!picked.success || [picked.data.name, picked.data.client, picked.data.schedule].some((i) => i >= headers.length)) {
      return json({ ok: false, error: "Choose the name, client and schedule columns." }, 400);
    }
    columns = picked.data;
    result = readTable(records, columns);
  }

  if (result.observations.length === 0) {
    return json({ ok: false, error: result.problems[0] ?? "No days with a clock-in were found in that file." }, 400);
  }

  try {
    const staged = await stageSheet(actor, {
      fileName: upload.name.replace(/^.*[\\/]/, ""),
      layout,
      columns,
      observations: result.observations,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    revalidatePath("/settings/import-schedules");
    return json({ ok: true, batchId: staged.batchId, observations: staged.observations, pairs: staged.pairs, skipped: result.skipped, problems: result.problems.length });
  } catch (error) {
    if (error instanceof ActionFailure) return json({ ok: false, error: error.message }, 400);
    console.error("schedule import stage failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
