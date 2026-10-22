import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

// Reads the plain text out of a resume (PDF or DOCX) on our own server, only to score it against a job's keywords. Nothing is sent
// anywhere and the text is not kept: the caller uses it once and drops it. A scanned PDF (pictures of pages) has no text, and a
// damaged or hostile file must not hang or crash the request, so every failure and every overrun returns null.
//
// The file is untrusted (anyone can apply), so it is refused BEFORE it is opened when it looks like a decompression bomb: a Word file
// whose parts declare an unreasonable unpacked size, or a PDF with an unreasonable number of pages. A time limit stops the wait, but
// it cannot stop a parser that is already running, which is why these checks come first.

export const MAX_TEXT_CHARS = 200_000;
export const EXTRACT_TIMEOUT_MS = 10_000;
export const MAX_PDF_PAGES = 40;
export const MAX_DOCX_UNPACKED_BYTES = 25 * 1024 * 1024;
export const MAX_DOCX_PARTS = 300;

/**
 * The total unpacked size and the number of parts a ZIP declares in its central directory, or null when the directory cannot be read.
 * Cheap (no unpacking). A hostile file can lie in these headers, so this is a first filter, not a proof.
 */
export function zipDeclaredSize(bytes: Uint8Array): { unpacked: number; parts: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const parts = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let unpacked = 0;
  for (let n = 0; n < parts; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    unpacked += view.getUint32(offset + 24, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return { unpacked, parts };
}

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
          try {
            if (pdf.numPages > MAX_PDF_PAGES) return null; // a resume is a few pages
            const { text } = await extractText(pdf, { mergePages: true });
            return text;
          } finally {
            // Free the parser's memory whatever happened. Which of these exist depends on the pdf.js build, and none may throw.
            const closable = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> };
            await Promise.resolve(closable.destroy?.() ?? closable.cleanup?.()).catch(() => undefined);
          }
        })(),
      );
      return clean(text);
    }
    if (kind === "docx") {
      const size = zipDeclaredSize(bytes);
      if (!size || size.unpacked > MAX_DOCX_UNPACKED_BYTES || size.parts > MAX_DOCX_PARTS) return null;
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
