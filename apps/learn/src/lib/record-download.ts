import { withUser, type Sql } from "./db";
import { resolveSession } from "./handlers";
import { getRecord } from "./queries";
import { renderRecordPdf } from "./record-pdf";

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/** The signed-in person's own training record as one PDF. Read through their own session, so it can only ever be theirs. */
export async function handleRecordDownload(request: Request, deps: { sql: Sql; production: boolean }): Promise<Response> {
  const session = await resolveSession(request.headers.get("cookie"), deps);
  if (!session) return plain(401, "Please sign in again.");
  const entries = await getRecord(deps.sql, session.userId);
  const person = await withUser(deps.sql, session.userId, async (tx) => (await tx`select display_name from learn.v_learners`)[0] as { display_name: string } | undefined);
  const pdf = await renderRecordPdf({
    holderName: person?.display_name ?? "Learner",
    generatedOn: new Date().toISOString().slice(0, 10),
    entries,
  });
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="ers-training-record.pdf"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
