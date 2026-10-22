import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

// Reads the plain text out of a resume (PDF or DOCX) on our own server, only to score it against a job's keywords. Nothing is sent
// anywhere and the text is not kept: the caller uses it once and drops it. A scanned PDF (pictures of pages) has no text, and a
// damaged or hostile file must not hang or crash the request, so every failure and every overrun returns null.

export const MAX_TEXT_CHARS = 200_000;
export const EXTRACT_TIMEOUT_MS = 10_000;

function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function extractResumeText(bytes: Uint8Array, kind: "pdf" | "docx" | string | null): Promise<string | null> {
  try {
    if (kind === "pdf") {
      const text = await withTimeout(
        (async () => {
          const pdf = await getDocumentProxy(new Uint8Array(bytes)); // a copy: the library takes ownership of the buffer
          const { text } = await extractText(pdf, { mergePages: true });
          return text;
        })(),
      );
      return clean(text);
    }
    if (kind === "docx") {
      const result = await withTimeout(mammoth.extractRawText({ buffer: Buffer.from(bytes) }));
      return clean(result?.value ?? null);
    }
    return null;
  } catch {
    return null;
  }
}

function clean(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.slice(0, MAX_TEXT_CHARS).trim();
  return trimmed === "" ? null : trimmed;
}
