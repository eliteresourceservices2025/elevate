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

  async write(bucket: Bucket, path: string, bytes: Uint8Array) {
    this.objects.set(this.key(bucket, path), bytes);
  }

  async read(bucket: Bucket, path: string) {
    return this.objects.get(this.key(bucket, path)) ?? null;
  }

  async remove(bucket: Bucket, paths: string[]) {
    for (const p of paths) {
      this.objects.delete(this.key(bucket, p));
      this.removed.push(this.key(bucket, p));
    }
  }

  async createSignedDownload(bucket: Bucket, path: string, seconds: number, fileName: string) {
    return `fake://${bucket}/${path}?expires=${seconds}&name=${encodeURIComponent(fileName)}`;
  }
}

const enc = new TextEncoder();
export const PDF_BYTES = enc.encode("%PDF-1.4\n% fake test document\n1 0 obj\n<<>>\nendobj\n");
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff]);
