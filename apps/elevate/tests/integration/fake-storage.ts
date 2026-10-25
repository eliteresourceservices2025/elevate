import { randomUUID } from "node:crypto";
import type { Bucket, DocumentStorage } from "@/modules/documents/storage";

/** In-memory stand-in for Supabase Storage, so the database tests do not need the storage service. */
export class FakeStorage implements DocumentStorage {
  objects = new Map<string, Uint8Array>();
  private issued = new Set<string>();
  removed: string[] = [];

  key = (bucket: string, path: string) => `${bucket}/${path}`;

  async createSignedUpload(bucket: Bucket, path: string) {
    this.issued.add(this.key(bucket, path));
    return { token: `token-${randomUUID()}` };
  }

  /** What the browser does with the token: upload to exactly the path it was issued for. */
  put(bucket: string, path: string, bytes: Uint8Array) {
    if (!this.issued.has(this.key(bucket, path))) throw new Error("No upload token was issued for that path");
    this.objects.set(this.key(bucket, path), bytes);
  }

  async write(bucket: Bucket, path: string, bytes: Uint8Array, _contentType?: string) {
    void _contentType;
    this.objects.set(this.key(bucket, path), bytes);
  }

  async read(bucket: Bucket, path: string) {
    return this.objects.get(this.key(bucket, path)) ?? null;
  }

  /** Tests: make the next removals fail, like a storage outage. */
  failRemovals = 0;

  async remove(bucket: Bucket, paths: string[]) {
    if (this.failRemovals > 0) {
      this.failRemovals -= 1;
      throw new Error("Could not remove the file");
    }
    for (const p of paths) {
      this.objects.delete(this.key(bucket, p));
      this.removed.push(this.key(bucket, p));
    }
  }

  async createSignedDownload(bucket: Bucket, path: string, seconds: number, fileName: string) {
    return `fake://${bucket}/${path}?expires=${seconds}&name=${encodeURIComponent(fileName)}`;
  }

  async head(bucket: Bucket, path: string, length: number) {
    const bytes = this.objects.get(this.key(bucket, path));
    return bytes ? { bytes: bytes.subarray(0, length), size: bytes.length } : null;
  }

  async createSignedPlayback(bucket: Bucket, path: string, seconds: number) {
    return `fake://${bucket}/${path}?expires=${seconds}`;
  }
}

/** The first bytes of a small MP4 file, enough for the type check. */
export const MP4_BYTES = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

const enc = new TextEncoder();
export const PDF_BYTES = enc.encode("%PDF-1.4\n% fake test document\n1 0 obj\n<<>>\nendobj\n");
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff]);
