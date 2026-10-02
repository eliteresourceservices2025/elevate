import type { Sql } from "./db";
import { codeLookupHash, hashPassphrase, looksLikeCode, looksLikePassphrase, newCaseCode, newPassphrase, newSalt, normalizeCode, normalizePassphrase, verifyPassphrase } from "./codes";
import type { CleanFile } from "./attachments";

// What the Safe Voice app does with the database. Everything goes through the `safevoice_app` role. Nothing here sees a person: no
// user, address, device or cookie reaches this file, and nothing it stores has a time of day (only the UTC day, set by the database).

export type Deps = { sql: Sql; pepper: string };

export type CaseView = {
  status: string;
  outcome: string | null;
  createdDay: string;
  closedDay: string | null;
  /** How many files came with the first report (the app's database role cannot read the report text itself, only the thread). */
  reportAttachments: number;
  messages: { author: "reporter" | "handler"; body: string; day: string; attachments: number }[];
};

const isUnique = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";

type Tx = Sql;

async function insertFiles(tx: Tx, reportId: string, messageId: string | null, files: CleanFile[]) {
  let position = 1;
  for (const file of files) {
    await tx`insert into ops.safevoice_attachments (report_id, message_id, position, content_type, size_bytes, data)
      values (${reportId}, ${messageId}, ${position++}, ${file.contentType}, ${file.data.length}, ${file.data})`;
  }
}

/** Saves a report and returns the case code and passphrase, the only time they are ever shown. */
export async function createReport(deps: Deps, input: { category: string; description: string; files: CleanFile[] }): Promise<{ caseCode: string; passphrase: string }> {
  const passphrase = newPassphrase();
  const salt = newSalt();
  const passHash = await hashPassphrase(normalizePassphrase(passphrase), salt, deps.pepper);
  for (let attempt = 0; attempt < 5; attempt++) {
    const caseCode = newCaseCode();
    const codeHash = codeLookupHash(normalizeCode(caseCode), deps.pepper);
    try {
      await deps.sql.begin(async (tx) => {
        const [row] = await tx`insert into ops.safevoice_reports (code_hash, pass_salt, pass_hash, category, description)
          values (${codeHash}, ${salt}, ${passHash}, ${input.category}, ${input.description}) returning id`;
        await insertFiles(tx as unknown as Tx, row.id as string, null, input.files);
      });
      return { caseCode, passphrase };
    } catch (error) {
      if (!isUnique(error)) throw error;
      // a code collision (astronomically unlikely): try a fresh code
    }
  }
  throw new Error("could not allocate a case code");
}

export type Opened = { id: string; status: string; outcome: string | null; createdDay: string; closedDay: string | null };

/**
 * Finds the case for a code and passphrase. Returns null for BOTH "no such case" and "wrong passphrase" after the same amount of work,
 * so nothing tells a guesser which part was wrong or whether a code exists.
 */
export async function authenticate(deps: Deps, codeInput: string, passInput: string): Promise<Opened | null> {
  const code = normalizeCode(codeInput.slice(0, 64));
  const pass = normalizePassphrase(passInput.slice(0, 128));
  const [row] = await deps.sql`select id, pass_salt, pass_hash, status, outcome, created_day::text as created_day, closed_day::text as closed_day from ops.safevoice_reports where code_hash = ${codeLookupHash(code, deps.pepper)}`;
  const shapeOk = looksLikeCode(code) && looksLikePassphrase(pass);
  const matched = await verifyPassphrase(pass, row ? { salt: Buffer.from(row.pass_salt), hash: Buffer.from(row.pass_hash) } : null, deps.pepper);
  if (!row || !matched || !shapeOk) return null;
  return { id: row.id, status: row.status, outcome: row.outcome, createdDay: row.created_day, closedDay: row.closed_day };
}

async function view(deps: Deps, opened: Opened): Promise<CaseView> {
  const [report] = await deps.sql`select count(*)::int as files from ops.safevoice_attachments a where a.report_id = ${opened.id} and a.message_id is null`;
  const messages = await deps.sql`select m.id, m.author, m.body, m.sent_day::text as sent_day, (select count(*)::int from ops.safevoice_attachments a where a.message_id = m.id) as files
    from ops.safevoice_messages m where m.report_id = ${opened.id} order by m.seq`;
  return {
    status: opened.status,
    outcome: opened.outcome,
    createdDay: opened.createdDay,
    closedDay: opened.closedDay,
    reportAttachments: report?.files ?? 0,
    messages: messages.map((m) => ({ author: m.author, body: m.body, day: m.sent_day, attachments: m.files })),
  };
}

export async function openCase(deps: Deps, code: string, passphrase: string): Promise<CaseView | null> {
  const opened = await authenticate(deps, code, passphrase);
  return opened ? view(deps, opened) : null;
}

/** Adds the reporter's message to a case they have already opened (see authenticate) and returns the refreshed thread. */
export async function addReporterMessage(deps: Deps, opened: Opened, input: { body: string; files: CleanFile[] }): Promise<CaseView> {
  await deps.sql.begin(async (tx) => {
    const [message] = await tx`insert into ops.safevoice_messages (report_id, author, body) values (${opened.id}, 'reporter', ${input.body}) returning id`;
    await insertFiles(tx as unknown as Tx, opened.id, message.id as string, input.files);
  });
  return view(deps, opened);
}
