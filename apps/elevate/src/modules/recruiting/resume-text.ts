import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { docxToText, withTimeout } from "@/modules/documents/docx";

// Reads the plain text out of a resume (PDF or DOCX) on our own server, only to score it against a job's keywords. Nothing is sent
// anywhere and the text is not kept: the caller uses it once and drops it. A scanned PDF (pictures of pages) has no text, and a
// damaged or hostile file must not hang or crash the request, so every failure and every overrun returns null.
//
// The file is untrusted (anyone can apply), so it is refused BEFORE it is opened when it looks like a decompression bomb: a Word file
// whose parts declare an unreasonable unpacked size (see documents/docx.ts), or a PDF with an unreasonable number of pages. A time
// limit stops the wait, but it cannot stop a parser that is already running, which is why these checks come first.

export const MAX_TEXT_CHARS = 200_000;
export const MAX_PDF_PAGES = 40;

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
    if (kind === "docx") return clean(await docxToText(bytes));
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
