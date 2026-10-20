import { MAX_SIGNATURE_PNG_BYTES, MAX_SIGNATURE_PNG_SIZE } from "./constants";

// Turning a photo of a handwritten signature (signed on paper, photographed with a phone) into the small PNG the signing flow takes.
// It runs in the browser; the server still checks the file again (type, size, dimensions) like any drawn signature.

/** Otsu's method: the grey level that best separates dark ink from light paper, from a 256-bin histogram. */
export function otsuThreshold(histogram: ArrayLike<number>): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += histogram[i] ?? 0;
    sum += i * (histogram[i] ?? 0);
  }
  let weightBack = 0;
  let sumBack = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightBack += histogram[t] ?? 0;
    if (weightBack === 0) continue;
    const weightFront = total - weightBack;
    if (weightFront === 0) break;
    sumBack += t * (histogram[t] ?? 0);
    const meanBack = sumBack / weightBack;
    const meanFront = (sum - sumBack) / weightFront;
    const variance = weightBack * weightFront * (meanBack - meanFront) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/** Ink (dark) pixels become near-black, everything else white; returns the box around the ink and how much of the picture was ink. */
export function inkBox(grey: Uint8Array, width: number, height: number, threshold: number): { box: { x: number; y: number; w: number; h: number } | null; inkShare: number; ink: Uint8Array } {
  const ink = new Uint8Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grey[y * width + x] <= threshold) {
        ink[y * width + x] = 1;
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { box: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, inkShare: count / (width * height), ink };
}

export class SignaturePhotoError extends Error {}

/**
 * Reads the photo, finds the ink, crops to it and saves it as a black-on-white PNG that fits the signing limits. Returns the PNG as
 * base64 without the "data:" prefix. Throws SignaturePhotoError with a plain message when the photo cannot be used.
 */
export async function photoToSignaturePng(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !file.type.startsWith("image/")) throw new SignaturePhotoError("Choose a picture (a photo or a screenshot).");
  if (file.size > 12_000_000) throw new SignaturePhotoError("That picture is too large. Use one under 12 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new SignaturePhotoError("That picture could not be opened. Try a JPG or PNG.");
  }

  // Work on a copy no wider than 1000 px: a phone photo is many millions of pixels.
  const work = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * work));
  const h = Math.max(1, Math.round(bitmap.height * work));
  const source = document.createElement("canvas");
  source.width = w;
  source.height = h;
  const sctx = source.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new SignaturePhotoError("This browser cannot read pictures. Draw your signature instead.");
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, w, h);
  sctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = sctx.getImageData(0, 0, w, h).data;

  const grey = new Uint8Array(w * h);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    grey[i] = g;
    histogram[g] += 1;
  }
  // A little darker than the "best" split keeps paper shadows out of the signature.
  const threshold = Math.max(40, otsuThreshold(histogram) - 12);
  const { box, inkShare, ink } = inkBox(grey, w, h, threshold);
  if (!box || inkShare < 0.0005) throw new SignaturePhotoError("No signature was found in that picture. Photograph dark ink on light paper, in good light.");
  if (inkShare > 0.45) throw new SignaturePhotoError("That picture is too dark. Photograph the signature on light paper, in good light.");

  // Crop to the ink with a small margin, then shrink until the file fits the limit.
  const pad = Math.round(Math.max(box.w, box.h) * 0.04) + 4;
  const cx = Math.max(0, box.x - pad);
  const cy = Math.max(0, box.y - pad);
  const cw = Math.min(w - cx, box.w + pad * 2);
  const ch = Math.min(h - cy, box.h + pad * 2);
  const maxW = MAX_SIGNATURE_PNG_SIZE.width;
  const maxH = MAX_SIGNATURE_PNG_SIZE.height;
  let scale = Math.min(1, maxW / cw, maxH / ch);
  for (let attempt = 0; attempt < 8; attempt++) {
    const ow = Math.max(40, Math.round(cw * scale));
    const oh = Math.max(20, Math.round(ch * scale));
    const full = document.createElement("canvas");
    full.width = cw;
    full.height = ch;
    const fctx = full.getContext("2d");
    if (!fctx) break;
    const out = fctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const o = (y * cw + x) * 4;
        const isInk = ink[(cy + y) * w + (cx + x)] === 1;
        out.data[o] = isInk ? 31 : 255;
        out.data[o + 1] = isInk ? 27 : 255;
        out.data[o + 2] = isInk ? 45 : 255;
        out.data[o + 3] = 255;
      }
    }
    fctx.putImageData(out, 0, 0);
    const final = document.createElement("canvas");
    final.width = ow;
    final.height = oh;
    const ctx = final.getContext("2d");
    if (!ctx) break;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, ow, oh);
    ctx.drawImage(full, 0, 0, ow, oh);
    const url = final.toDataURL("image/png");
    const b64 = url.slice("data:image/png;base64,".length);
    if (url.startsWith("data:image/png;base64,") && Math.floor((b64.length * 3) / 4) <= MAX_SIGNATURE_PNG_BYTES) return b64;
    scale *= 0.75;
  }
  throw new SignaturePhotoError("That picture is too detailed to use. Crop closer to the signature, or draw it instead.");
}
