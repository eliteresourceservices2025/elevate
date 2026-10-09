import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, cleanProfilePhoto, isPhotoPathOf, photoPathFor, sourceSquare } from "./photo";

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];

/** A tiny structurally valid JPEG (the cleaner reads structure, it does not decode pixels). */
function jpeg(opts: { width?: number; height?: number; app?: boolean; sof?: number; noScan?: boolean; noEnd?: boolean } = {}) {
  const w = opts.width ?? 320;
  const h = opts.height ?? 320;
  const bytes = [
    0xff, 0xd8,
    ...(opts.app === false ? [] : [...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), ...seg(0xe1, [...Buffer.from("Exif\0\0GPS-secret-location")]), ...seg(0xed, [1, 2, 3]), ...seg(0xfe, [...Buffer.from("a comment")])]),
    ...seg(0xdb, [0, ...new Array<number>(64).fill(8)]),
    ...seg(opts.sof ?? 0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xc4, [0, 1, ...new Array<number>(15).fill(0), 0]),
    ...(opts.noScan ? [] : [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    ...(opts.noEnd ? [] : [0xff, 0xd9]),
  ];
  return new Uint8Array(bytes);
}

const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));

describe("cleanProfilePhoto", () => {
  it("keeps the picture and removes the camera, location and comment segments", () => {
    const original = jpeg();
    expect(has(original, "GPS-secret-location")).toBe(true);
    const result = cleanProfilePhoto(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(320);
    expect(result.height).toBe(320);
    expect(has(result.bytes, "GPS-secret-location")).toBe(false);
    expect(has(result.bytes, "a comment")).toBe(false);
    expect(has(result.bytes, "Exif")).toBe(false);
    expect(result.bytes.length).toBeLessThan(original.length);
    // still a JPEG that starts and ends properly, and still holds the scan data (with its stuffed byte and restart marker)
    expect([...result.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...result.bytes.slice(-2)]).toEqual([0xff, 0xd9]);
    expect(Buffer.from(result.bytes).includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]))).toBe(true);
  });

  it("is a no-op for a file with no metadata, and cleaning twice changes nothing", () => {
    const plain = jpeg({ app: false });
    const once = cleanProfilePhoto(plain);
    expect(once.ok && [...once.bytes]).toEqual([...plain]);
    const twice = cleanProfilePhoto(jpeg());
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(cleanProfilePhoto(twice.bytes)).toEqual(twice);
  });

  it("accepts a progressive JPEG", () => {
    expect(cleanProfilePhoto(jpeg({ sof: 0xc2 })).ok).toBe(true);
  });

  it("refuses anything that is not a plain JPEG", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const pdf = new TextEncoder().encode("%PDF-1.4 not a picture");
    for (const bad of [png, pdf, new Uint8Array([]), new Uint8Array([0xff, 0xd8]), new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]) {
      expect(cleanProfilePhoto(bad).ok).toBe(false);
    }
    expect(cleanProfilePhoto(jpeg({ noScan: true })).ok).toBe(false);
    expect(cleanProfilePhoto(jpeg({ noEnd: true })).ok).toBe(false);
    expect(cleanProfilePhoto(jpeg({ sof: 0xc3 })).ok).toBe(false); // lossless
    expect(cleanProfilePhoto(jpeg({ sof: 0xc9 })).ok).toBe(false); // arithmetic coding
  });

  it("refuses pictures that are too small, too big in pixels, or too big in bytes", () => {
    expect(cleanProfilePhoto(jpeg({ width: 32, height: 32 }))).toMatchObject({ ok: false });
    expect(cleanProfilePhoto(jpeg({ width: 4000, height: 3000 }))).toMatchObject({ ok: false });
    const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
    huge.set([0xff, 0xd8]);
    expect(cleanProfilePhoto(huge)).toMatchObject({ ok: false });
  });

  it("refuses a segment that claims to run past the end", () => {
    const broken = jpeg();
    const cut = broken.slice(0, 30);
    expect(cleanProfilePhoto(cut).ok).toBe(false);
  });
});

describe("sourceSquare", () => {
  it("centres the short side at zoom 1", () => {
    expect(sourceSquare(400, 200, 1, 0, 0)).toEqual({ side: 200, sx: 100, sy: 0 });
    expect(sourceSquare(200, 200, 1, 0, 0)).toEqual({ side: 200, sx: 0, sy: 0 });
  });
  it("zooms in and moves across the slack, never outside the picture", () => {
    const z = sourceSquare(400, 200, 2, -1, 1);
    expect(z.side).toBe(100);
    expect(z.sx).toBe(0);
    expect(z.sy).toBe(100);
    const far = sourceSquare(400, 200, 2, 9, -9);
    expect(far.sx).toBe(300);
    expect(far.sy).toBe(0);
    expect(sourceSquare(400, 200, 99, 0, 0).side).toBe(50); // zoom is capped at 4
  });
});

describe("photo paths", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("a path belongs only to its own account", () => {
    const p = photoPathFor(id, "22222222-2222-4222-8222-222222222222");
    expect(isPhotoPathOf(id, p)).toBe(true);
    expect(isPhotoPathOf("33333333-3333-4333-8333-333333333333", p)).toBe(false);
    expect(isPhotoPathOf(id, "selfies/x/y.jpg")).toBe(false);
    expect(isPhotoPathOf(id, `avatars/${id}/../other.jpg`)).toBe(false);
  });
});
