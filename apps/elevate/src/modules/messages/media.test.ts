import { describe, expect, it } from "vitest";
import { audioKindFromMime, sniffAudioKind, stripImageMetadata } from "./media";

const bytes = (...n: number[]) => Uint8Array.from(n);
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
const has = (data: Uint8Array, text: string) => Buffer.from(data).includes(Buffer.from(text, "latin1"));

/** A tiny JPEG: SOI, a JFIF segment, an EXIF segment holding GPS text (and optionally an orientation), a comment, then scan data. */
function jpeg(options: { orientation?: number } = {}): Uint8Array {
  const exifBody: number[] = [...ascii("Exif"), 0, 0];
  if (options.orientation) {
    // TIFF (big-endian) with one IFD entry: orientation.
    exifBody.push(0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, options.orientation, 0, 0, 0, 0, 0, 0);
  }
  exifBody.push(...ascii("GPSLatitude=14.5995"));
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return bytes(
    0xff, 0xd8,
    ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe1, exifBody),
    ...seg(0xfe, ascii("shot at the clinic desk")),
    0xff, 0xda, 0, 4, 1, 2, 0x11, 0x22, 0x33, 0xff, 0xd9,
  );
}

describe("stripImageMetadata: JPEG", () => {
  it("removes the EXIF location and the comment but keeps the picture", () => {
    const out = stripImageMetadata(jpeg(), "jpg");
    expect(has(out, "GPSLatitude")).toBe(false);
    expect(has(out, "clinic desk")).toBe(false);
    expect(has(out, "JFIF")).toBe(true);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out.slice(-2)).toEqual(bytes(0xff, 0xd9));
  });

  it("keeps only the orientation so a sideways photo still shows upright", () => {
    const out = stripImageMetadata(jpeg({ orientation: 6 }), "jpg");
    expect(has(out, "GPSLatitude")).toBe(false);
    expect(has(out, "Exif")).toBe(true);
    // The kept EXIF segment holds the orientation value 6 and nothing else.
    expect(Buffer.from(out).includes(Buffer.from([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6]))).toBe(true);
  });

  it("leaves a file it cannot parse unchanged", () => {
    const junk = bytes(0xff, 0xd8, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05);
    expect(stripImageMetadata(junk, "jpg")).toEqual(junk);
  });
});

describe("stripImageMetadata: PNG", () => {
  const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...ascii(type), ...data, 1, 2, 3, 4];
  const png = (extra: number[]) => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), ...extra, ...chunk("IDAT", [9, 9]), ...chunk("IEND", []));

  it("removes text notes and EXIF chunks but keeps the image chunks", () => {
    const out = stripImageMetadata(png([...chunk("tEXt", ascii("Comment\0GPS 14.59")), ...chunk("eXIf", ascii("Exif-camera"))]), "png");
    expect(has(out, "GPS 14.59")).toBe(false);
    expect(has(out, "Exif-camera")).toBe(false);
    expect(has(out, "IHDR")).toBe(true);
    expect(has(out, "IDAT")).toBe(true);
    expect(has(out, "IEND")).toBe(true);
  });
});

describe("stripImageMetadata: WEBP", () => {
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const chunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
  function webp(): Uint8Array {
    const body = [...ascii("WEBP"), ...chunk("VP8X", [0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...chunk("VP8 ", [1, 2, 3, 4]), ...chunk("EXIF", ascii("GPS-camera-data")), ...chunk("XMP ", ascii("xmp-notes"))];
    return bytes(...ascii("RIFF"), ...le32(body.length), ...body);
  }

  it("removes the EXIF and XMP chunks, clears their flags, and fixes the file size", () => {
    const out = stripImageMetadata(webp(), "webp");
    expect(has(out, "GPS-camera-data")).toBe(false);
    expect(has(out, "xmp-notes")).toBe(false);
    expect(has(out, "VP8 ")).toBe(true);
    const flagsAt = Buffer.from(out).indexOf(Buffer.from("VP8X", "latin1")) + 8;
    expect(out[flagsAt] & 0x0c).toBe(0);
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riffSize).toBe(out.length - 8);
  });
});

describe("voice note types", () => {
  it("knows WebM, Ogg and MP4 audio by their first bytes", () => {
    expect(sniffAudioKind(bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8))).toBe("webm");
    expect(sniffAudioKind(bytes(0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0))).toBe("ogg");
    expect(sniffAudioKind(bytes(0, 0, 0, 0x20, ...ascii("ftypM4A "), 0, 0))).toBe("mp4");
  });
  it("refuses anything else: text, a PDF, a script, an empty file", () => {
    expect(sniffAudioKind(bytes(...ascii("%PDF-1.7 hello world")))).toBeNull();
    expect(sniffAudioKind(bytes(...ascii("<script>alert(1)</script>")))).toBeNull();
    expect(sniffAudioKind(new Uint8Array(0))).toBeNull();
  });
  it("reads the type a browser recorder reports", () => {
    expect(audioKindFromMime("audio/webm;codecs=opus")).toBe("webm");
    expect(audioKindFromMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(audioKindFromMime("audio/mp4")).toBe("mp4");
    expect(audioKindFromMime("video/webm")).toBeNull();
    expect(audioKindFromMime("text/html")).toBeNull();
  });
});
