import { z } from "zod";
import { cleanAttachment, type CleanFile } from "./attachments";
import { codeLookupHash, newCaseCode, newPassphrase, normalizeCode } from "./codes";
import { BAD_CREDENTIALS, CATEGORIES, GENERIC_ERROR, LIMITS, RATE_LIMITED } from "./constants";
import { allow, addressOf } from "./rate-limit";
import { addReporterMessage, authenticate, createReport, openCase, type Deps } from "./service";

// The three public endpoints, as plain functions of a Request. They never read or set a cookie, never read the user agent, and never
// store or log an address (it is hashed in memory for the rate limiter only). Every reply is `no-store`.

type Body = { ok: boolean; error?: string; field?: string; [key: string]: unknown };
const json = (body: Body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const submitSchema = z.object({
  category: z.enum(CATEGORIES, { error: "Choose what this is about." }),
  description: z.string().trim().min(LIMITS.descriptionMin, `Please write at least ${LIMITS.descriptionMin} characters.`).max(LIMITS.descriptionMax, `Please keep it under ${LIMITS.descriptionMax} characters.`),
});
const replySchema = z.object({ message: z.string().trim().min(1, "Write a message first.").max(LIMITS.messageMax, `Please keep it under ${LIMITS.messageMax} characters.`) });
const credentialsSchema = z.object({ caseCode: z.string().max(64), passphrase: z.string().max(128) });

/** Plain text: browsers send new lines as CRLF, which becomes one new line; control characters (other than new lines and tabs) are removed. */
const plain = (s: string) => s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

async function readFiles(form: FormData): Promise<{ ok: true; files: CleanFile[] } | { ok: false; error: string }> {
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (uploads.length > LIMITS.maxFiles) return { ok: false, error: `You can attach up to ${LIMITS.maxFiles} files.` };
  if (uploads.reduce((sum, f) => sum + f.size, 0) > LIMITS.maxTotalBytes) return { ok: false, error: "The files are too large. The limit is 4 MB in total." };
  const files: CleanFile[] = [];
  for (const upload of uploads) {
    const cleaned = await cleanAttachment(new Uint8Array(await upload.arrayBuffer()));
    if (!cleaned.ok) return { ok: false, error: "One of the files could not be used. Attach a JPG, PNG or PDF that opens normally and is not password protected." };
    files.push(cleaned.file);
  }
  return { ok: true, files };
}

const tooLarge = (request: Request) => Number(request.headers.get("content-length") ?? 0) > LIMITS.maxRequestBytes;

export async function handleSubmit(request: Request, deps: Deps): Promise<Response> {
  try {
    if (tooLarge(request)) return json({ ok: false, error: "The files are too large. The limit is 4 MB in total." }, 413);
    if (!(await allow("submit", "ip", addressOf(request), deps.pepper))) return json({ ok: false, error: RATE_LIMITED }, 429);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: "We could not read the form. Please try again." }, 400);
    }
    const text = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v : "";
    };
    // Honeypot: a filled hidden field is a bot. It gets a believable answer and nothing is stored.
    if (text("website") !== "") return json({ ok: true, caseCode: newCaseCode(), passphrase: newPassphrase() });
    const parsed = submitSchema.safeParse({ category: text("category"), description: plain(text("description")) });
    if (!parsed.success) return json({ ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again.", field: String(parsed.error.issues[0]?.path[0] ?? "") }, 400);
    const files = await readFiles(form);
    if (!files.ok) return json({ ok: false, error: files.error, field: "files" }, 400);
    const result = await createReport(deps, { category: parsed.data.category, description: parsed.data.description, files: files.files });
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("safe voice submit failed:", error instanceof Error ? error.name : "unknown error"); // never request data
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
}

/** Both follow-up calls: limits first (by address, and by code so one case cannot be guessed at from many places), then the credentials. */
async function limitedCredentials(request: Request, deps: Deps, caseCode: string): Promise<boolean> {
  if (!(await allow("open", "ip", addressOf(request), deps.pepper))) return false;
  return allow("perCode", "code", codeLookupHash(normalizeCode(caseCode.slice(0, 64)), deps.pepper).toString("hex"), deps.pepper);
}

export async function handleOpen(request: Request, deps: Deps): Promise<Response> {
  try {
    const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ ok: false, error: BAD_CREDENTIALS }, 401);
    if (!(await limitedCredentials(request, deps, parsed.data.caseCode))) return json({ ok: false, error: RATE_LIMITED }, 429);
    const opened = await openCase(deps, parsed.data.caseCode, parsed.data.passphrase);
    return opened ? json({ ok: true, case: opened }) : json({ ok: false, error: BAD_CREDENTIALS }, 401);
  } catch (error) {
    console.error("safe voice open failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
}

export async function handleReply(request: Request, deps: Deps): Promise<Response> {
  try {
    if (tooLarge(request)) return json({ ok: false, error: "The files are too large. The limit is 4 MB in total." }, 413);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: "We could not read the form. Please try again." }, 400);
    }
    const text = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v : "";
    };
    const creds = credentialsSchema.safeParse({ caseCode: text("caseCode"), passphrase: text("passphrase") });
    if (!creds.success) return json({ ok: false, error: BAD_CREDENTIALS }, 401);
    if (!(await limitedCredentials(request, deps, creds.data.caseCode))) return json({ ok: false, error: RATE_LIMITED }, 429);
    // Credentials are judged first, so an error about the message or the files can never confirm that a case exists,
    // and nobody without a valid code and passphrase makes the server do the expensive file work.
    const opened = await authenticate(deps, creds.data.caseCode, creds.data.passphrase);
    if (!opened) return json({ ok: false, error: BAD_CREDENTIALS }, 401);
    if (opened.status === "closed") return json({ ok: false, error: "This case is closed. If there is more to say, the handlers can reopen it." }, 409);
    const message = replySchema.safeParse({ message: plain(text("message")) });
    if (!message.success) return json({ ok: false, error: message.error.issues[0]?.message ?? "Write a message first.", field: "message" }, 400);
    const files = await readFiles(form);
    if (!files.ok) return json({ ok: false, error: files.error, field: "files" }, 400);
    return json({ ok: true, case: await addReporterMessage(deps, opened, { body: message.data.message, files: files.files }) });
  } catch (error) {
    console.error("safe voice reply failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
}
