// File rules for the vault. Pure (no server-only imports): used by the server checks and the upload form.

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export const FILE_TYPES = {
  pdf: { mime: "application/pdf", extension: "pdf", label: "PDF" },
  jpg: { mime: "image/jpeg", extension: "jpg", label: "JPG" },
  png: { mime: "image/png", extension: "png", label: "PNG" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
    label: "DOCX",
  },
  webp: { mime: "image/webp", extension: "webp", label: "WEBP" },
  // The old Word format. Judged by its contents (see sniffFileKind): only a Word document with no macros is accepted.
  doc: { mime: "application/msword", extension: "doc", label: "DOC" },
} as const;

/** The types people see in messages and hints. */
export const ALLOWED_TYPES_TEXT = "PDF, JPG, PNG, WEBP, DOC or DOCX";

export type FileKind = keyof typeof FILE_TYPES;

export const ALLOWED_MIME_TYPES: string[] = Object.values(FILE_TYPES).map((t) => t.mime);

// Typed FileKind keys only.
export function extensionOf(kind: FileKind): string {
  // eslint-disable-next-line security/detect-object-injection
  return FILE_TYPES[kind].extension;
}

// Typed FileKind keys only.
export function mimeOf(kind: FileKind): string {
  // eslint-disable-next-line security/detect-object-injection
  return FILE_TYPES[kind].mime;
}

export function kindFromMime(mime: string): FileKind | null {
  const hit = (Object.entries(FILE_TYPES) as [FileKind, (typeof FILE_TYPES)[FileKind]][]).find(([, t]) => t.mime === mime.toLowerCase());
  return hit ? hit[0] : null;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((b, i) => bytes.at(i) === b);

/** Looks for plain text (`wide` = as UTF-16, how an old Word file names its parts, with a zero byte after each letter). */
const includesAscii = (bytes: Uint8Array, text: string, wide = false): boolean => {
  const needle = Array.from(text, (c) => c.charCodeAt(0)).flatMap((b) => (wide ? [b, 0] : [b]));
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      // eslint-disable-next-line security/detect-object-injection -- numeric loop indexes
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
};

/**
 * What the file really is, judged by its bytes, never by its name or declared type.
 * DOCX must be a ZIP that contains [Content_Types].xml and word/, which rules out plain ZIPs,
 * spreadsheets and presentations, and must carry no macro project (a .docm renamed to .docx is refused).
 * DOC must be an old-format container (the shared signature of Word, Excel, PowerPoint and Outlook files) that holds a
 * "WordDocument" part and no macro project, which rules out the other three and any Word file with macros.
 * WEBP is a RIFF container whose form type is WEBP.
 */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length < 8) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return includesAscii(bytes, "[Content_Types].xml") && includesAscii(bytes, "word/") && !includesAscii(bytes, "vbaProject") ? "docx" : null;
  }
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.at(8) === 0x57 && bytes.at(9) === 0x45 && bytes.at(10) === 0x42 && bytes.at(11) === 0x50) return "webp"; // RIFF....WEBP
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const isWord = includesAscii(bytes, "WordDocument", true);
    const hasMacros = includesAscii(bytes, "_VBA_PROJECT", true) || includesAscii(bytes, "Macros", true);
    return isWord && !hasMacros ? "doc" : null;
  }
  return null;
}

/** A safe name to show and to put in Content-Disposition: no path, no control characters, bounded. */
export function sanitizeFileName(name: string, kind: FileKind): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const stem = base
    .replace(/\.[^.]*$/, "") // the extension comes from the verified file type, not from the name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${stem || "document"}.${extensionOf(kind)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
