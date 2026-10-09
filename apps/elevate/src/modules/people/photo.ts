// Profile photo rules. Pure (no server-only imports): used by the upload route, the tests and the picker.
//
// The browser crops and shrinks the picture to a square JPEG before sending it, but the server never trusts that: it re-checks the
// bytes, throws away every metadata segment (camera, GPS, thumbnails, comments) and stores only the cleaned copy.

/** What the browser sends, at most. A 320 px square JPEG is far smaller; this only stops abuse. */
export const MAX_PHOTO_BYTES = 512 * 1024;
/** The picture the browser makes (a square, in pixels). */
export const PHOTO_SIZE = 320;
export const MIN_PHOTO_SIDE = 64;
export const MAX_PHOTO_SIDE = 1024;

export type CleanPhoto = { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; error: string };

const BAD = "Choose a JPG, PNG or WEBP picture.";

// Start-of-frame markers for the kinds of JPEG every browser can show (baseline, extended and progressive, Huffman coded).
const SOF_OK = new Set([0xc0, 0xc1, 0xc2]);
// Other start-of-frame markers (lossless, arithmetic coding, hierarchical): not something a profile picture needs.
const SOF_UNSUPPORTED = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Checks that the bytes are one ordinary JPEG of a sensible size, removes every application (APP0-APP15) and comment segment, and
 * returns the cleaned file. Anything else (a PNG, a damaged file, a huge picture) is refused with one friendly message.
 */
export function cleanProfilePhoto(input: Uint8Array): CleanPhoto {
  const n = input.length;
  if (n < 4 || n > MAX_PHOTO_BYTES) return { ok: false, error: n > MAX_PHOTO_BYTES ? "That picture is too large. Choose a smaller one." : BAD };
  if (input[0] !== 0xff || input[1] !== 0xd8) return { ok: false, error: BAD };

  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let sawScan = false;
  let finished = false;
  let i = 2;

  while (i < n && !finished) {
    if (input[i] !== 0xff) return { ok: false, error: BAD };
    // Fill bytes: any number of 0xFF before the marker code.
    while (i + 1 < n && input[i + 1] === 0xff) i++;
    const marker = input[i + 1];
    if (marker === undefined) return { ok: false, error: BAD };

    if (marker === 0xd9) {
      parts.push(new Uint8Array([0xff, 0xd9]));
      finished = true;
      break;
    }
    // Markers with no length (restart markers, TEM) never stand outside a scan, but they carry nothing either.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0x00 || marker === 0xd8) return { ok: false, error: BAD };

    if (i + 4 > n) return { ok: false, error: BAD };
    const length = ((input[i + 2] as number) << 8) | (input[i + 3] as number);
    if (length < 2 || i + 2 + length > n) return { ok: false, error: BAD };
    const segment = input.subarray(i, i + 2 + length);

    if (SOF_UNSUPPORTED.has(marker)) return { ok: false, error: BAD };
    if (SOF_OK.has(marker)) {
      if (length < 8) return { ok: false, error: BAD };
      height = ((input[i + 5] as number) << 8) | (input[i + 6] as number);
      width = ((input[i + 7] as number) << 8) | (input[i + 8] as number);
    }

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(segment);
    i += 2 + length;

    if (marker === 0xda) {
      // Start of scan: the compressed picture data runs until the next real marker (0xFF 0x00 is a stuffed byte, 0xFF 0xD0-D7 a restart).
      sawScan = true;
      const start = i;
      while (i < n) {
        if (input[i] === 0xff) {
          const next = input[i + 1];
          if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7) || next === 0xff) {
            i += next === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        i++;
      }
      parts.push(input.subarray(start, i));
    }
  }

  if (!finished || !sawScan || width === 0 || height === 0) return { ok: false, error: BAD };
  if (width < MIN_PHOTO_SIDE || height < MIN_PHOTO_SIDE) return { ok: false, error: "That picture is too small. Choose one at least 64 pixels wide." };
  if (width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE) return { ok: false, error: "That picture is too large. Choose a smaller one." };

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { ok: true, bytes, width, height };
}

/**
 * The square of the original picture shown in the round preview. `zoom` is 1 (the whole short side) or more; `px` and `py` are -1 to 1
 * and move the square across the slack the zoom leaves (0 is centred). Returns the source rectangle to draw from.
 */
export function sourceSquare(width: number, height: number, zoom: number, px: number, py: number): { sx: number; sy: number; side: number } {
  const z = Math.min(Math.max(zoom, 1), 4);
  const side = Math.min(width, height) / z;
  const clamp = (v: number) => Math.min(Math.max(v, -1), 1);
  return { side, sx: (width - side) * (0.5 + clamp(px) / 2), sy: (height - side) * (0.5 + clamp(py) / 2) };
}

/** Where a person's photo lives: a fresh random name each time, so a replaced picture is never served from a stale cache. */
export function photoPathFor(userId: string, token: string): string {
  return `avatars/${userId}/${token}.jpg`;
}

/** Only paths this module wrote are ever read back. */
export function isPhotoPathOf(userId: string, path: string): boolean {
  return new RegExp(`^avatars/${userId}/[0-9a-f-]{36}\\.jpg$`).test(path);
}
