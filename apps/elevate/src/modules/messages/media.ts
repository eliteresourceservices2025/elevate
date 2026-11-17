// Pure helpers for files, pictures and voice notes in chat (no server-only import, so they are unit-tested and shared with the browser).

export const MAX_ATTACHMENTS = 5;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_VOICE_SECONDS = 120; // 2 minutes
export const UPLOAD_WINDOW_MINUTES = 30; // a requested upload must be finalized within this time

export const AUDIO_TYPES = {
  webm: { mime: "audio/webm", extension: "webm" },
  ogg: { mime: "audio/ogg", extension: "ogg" },
  mp4: { mime: "audio/mp4", extension: "m4a" },
} as const;
export type AudioKind = keyof typeof AUDIO_TYPES;
export const AUDIO_MIME_TYPES: string[] = Object.values(AUDIO_TYPES).map((t) => t.mime);

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/** What a voice note really is, judged by its first bytes (WebM and Ogg from Chrome and Firefox, MP4 audio from Safari), never by its name. */
export function sniffAudioKind(head: Uint8Array): AudioKind | null {
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (startsWith(head, [0x4f, 0x67, 0x67, 0x53])) return "ogg"; // OggS
  if (head.length >= 12 && startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) return "mp4"; // ....ftyp
  return null;
}

/** The audio type a browser's recorder reports ("audio/webm;codecs=opus"), or null. */
export function audioKindFromMime(mime: string): AudioKind | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  const hit = (Object.entries(AUDIO_TYPES) as [AudioKind, (typeof AUDIO_TYPES)[AudioKind]][]).find(([, t]) => t.mime === base);
  return hit ? hit[0] : null;
}

export type ImageKind = "jpg" | "png" | "webp";

// ---- Removing hidden details (location, camera, time) from pictures ----

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];

/** The EXIF orientation (1 to 8) of a JPEG, so a picture taken sideways still shows upright after everything else is removed. */
function jpegOrientation(app1: Uint8Array): number | null {
  // app1 = the segment body after the length: "Exif\0\0" then a TIFF header.
  if (app1.length < 14 || String.fromCharCode(...app1.slice(0, 4)) !== "Exif") return null;
  const tiff = 6;
  const little = app1[tiff] === 0x49;
  const rd16 = (o: number) => (little ? app1[o] | (app1[o + 1] << 8) : (app1[o] << 8) | app1[o + 1]);
  const rd32 = (o: number) => (little ? (app1[o] | (app1[o + 1] << 8) | (app1[o + 2] << 16) | (app1[o + 3] << 24)) >>> 0 : ((app1[o] << 24) | (app1[o + 1] << 16) | (app1[o + 2] << 8) | app1[o + 3]) >>> 0);
  const ifd = tiff + rd32(tiff + 4);
  if (ifd + 2 > app1.length) return null;
  const count = rd16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > app1.length) return null;
    if (rd16(entry) === 0x0112) {
      const value = rd16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A tiny EXIF segment holding only the orientation (big-endian), written back after everything else is dropped. */
function orientationSegment(orientation: number): Uint8Array {
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const length = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return bytes;
  const out: number[] = [0xff, 0xd8];
  let orientation: number | null = null;
  let pos = 2;
  const kept: Uint8Array[] = [];
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return bytes; // not a segment boundary: leave a file we do not understand as it is
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0xda) {
      // Start of scan: the picture data runs to the end of the file.
      kept.push(bytes.slice(pos));
      pos = bytes.length;
      break;
    }
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(bytes.slice(pos, pos + 2));
      pos += 2;
      continue;
    }
    const length = u16(bytes, pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) return bytes;
    const segment = bytes.slice(pos, pos + 2 + length);
    if (marker === 0xe1) {
      orientation ??= jpegOrientation(segment.slice(4));
      // dropped: EXIF (location, camera, time) and XMP
    } else if (marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xe9) || marker === 0xec || marker === 0xef) {
      // dropped: Photoshop data, comments and other application data
    } else {
      kept.push(segment);
    }
    pos += 2 + length;
  }
  const parts = [Uint8Array.from(out), ...(orientation && orientation !== 1 ? [orientationSegment(orientation)] : []), ...kept];
  return concat(parts);
}

const concat = (parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    result.set(p, at);
    at += p.length;
  }
  return result;
};

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  let pos = 8;
  const drop = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
  while (pos + 12 <= bytes.length) {
    const length = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const end = pos + 12 + length;
    if (end > bytes.length) return bytes;
    if (!drop.has(type)) parts.push(bytes.slice(pos, end));
    pos = end;
  }
  return concat(parts);
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes;
  const parts: Uint8Array[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const size = (bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)) >>> 0;
    const end = pos + 8 + size + (size % 2);
    if (end > bytes.length + 1) return bytes;
    if (fourcc === "EXIF" || fourcc === "XMP ") {
      pos = end;
      continue;
    }
    const chunk = bytes.slice(pos, Math.min(end, bytes.length));
    if (fourcc === "VP8X" && chunk.length > 8) chunk[8] &= ~0x0c; // clear the "has EXIF" and "has XMP" flags
    parts.push(chunk);
    pos = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.slice(0, 12), 0);
  out.set(body, 12);
  const riffSize = out.length - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >> 24) & 0xff;
  return out;
}

/**
 * Removes the hidden details from a picture (EXIF: where and when it was taken and with what; text notes; XMP), keeping the picture
 * and, for a JPEG, only its orientation. A file it cannot parse is returned unchanged.
 */
export function stripImageMetadata(bytes: Uint8Array, kind: ImageKind): Uint8Array {
  if (kind === "jpg") return stripJpeg(bytes);
  if (kind === "png") return stripPng(bytes);
  return stripWebp(bytes);
}
