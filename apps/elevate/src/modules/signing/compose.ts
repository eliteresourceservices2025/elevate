import "server-only";
import { parseMarkdown } from "@/lib/markdown";
import { ActionFailure } from "@/lib/run-action";
import { renderLetterheadPdf } from "./letterhead-pdf";
import { MAX_COMPOSED_CHARS, MIN_COMPOSED_CHARS, normalizeTypography } from "./constants";

/**
 * A document written inside ELEVATE (HR types or pastes it in the editor) becomes a PDF here. From then on it is an ordinary
 * envelope: the PDF is the original (never edited), it is fingerprinted, signed and sealed like an uploaded file.
 * Standard Helvetica draws Latin-1 only; other characters print as "?", which the editor says up front.
 */
export async function renderComposedPdf(title: string, markdown: string): Promise<Uint8Array> {
  const text = normalizeTypography(markdown).replace(/\r\n?/g, "\n").trim();
  if (text.length < MIN_COMPOSED_CHARS) throw new ActionFailure("Write the document (at least a few sentences).");
  if (text.length > MAX_COMPOSED_CHARS) throw new ActionFailure("The document is too long (60,000 characters at most).");
  const blocks = parseMarkdown(text, MAX_COMPOSED_CHARS);
  if (blocks.length === 0) throw new ActionFailure("Write the document (at least a few sentences).");
  return renderLetterheadPdf({ title, blocks });
}
