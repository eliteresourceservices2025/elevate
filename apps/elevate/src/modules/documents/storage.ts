import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// All file storage goes through this interface. The real implementation uses Supabase Storage with
// the service key; tests swap in an in-memory fake. Buckets are private: nothing here creates a public
// URL, and every link is signed and short-lived.

export const BUCKETS = { employee: "employee-docs", company: "company-docs", recruiting: "recruiting-docs", signed: "signed-docs", videos: "announcement-videos" } as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface DocumentStorage {
  /** A one-time token letting the browser upload to exactly this path. */
  createSignedUpload(bucket: Bucket, path: string): Promise<{ token: string }>;
  /** Stores a file the server itself received (an applicant's resume): there is no browser upload token for applicants. */
  write(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The whole file, or null if it is not there. Files are 10 MB at most. */
  read(bucket: Bucket, path: string): Promise<Uint8Array | null>;
  remove(bucket: Bucket, paths: string[]): Promise<void>;
  /** A link that works for `seconds` and saves the file as `fileName`. */
  createSignedDownload(bucket: Bucket, path: string, seconds: number, fileName: string): Promise<string>;
  /** The first `length` bytes and the whole file's size, without reading the rest (for large files). Null if it is not there. */
  head(bucket: Bucket, path: string, length: number): Promise<{ bytes: Uint8Array; size: number } | null>;
  /** A link that works for `seconds` and plays in the page (supports seeking). */
  createSignedPlayback(bucket: Bucket, path: string, seconds: number): Promise<string>;
}

class SupabaseDocumentStorage implements DocumentStorage {
  private client = createSupabaseAdminClient();

  async createSignedUpload(bucket: Bucket, path: string) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw new Error("Could not create an upload link");
    return { token: data.token };
  }

  async write(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error("Could not store the file");
  }

  async read(bucket: Bucket, path: string) {
    const { data, error } = await this.client.storage.from(bucket).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async remove(bucket: Bucket, paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(bucket).remove(paths);
    if (error) throw new Error("Could not remove the file");
  }

  async createSignedDownload(bucket: Bucket, path: string, seconds: number, fileName: string) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, seconds, { download: fileName });
    if (error || !data) throw new Error("Could not create a download link");
    return data.signedUrl;
  }

  async head(bucket: Bucket, path: string, length: number) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data) return null;
    const response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${length - 1}` } });
    if (!response.ok || !response.body) return null;
    // Read only the first `length` bytes even if storage ignored the Range header (a 200 would be the whole file).
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < length) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      got += value.length;
    }
    await reader.cancel().catch(() => {});
    const bytes = new Uint8Array(Math.min(got, length));
    let at = 0;
    for (const c of chunks) {
      const part = c.subarray(0, Math.max(0, bytes.length - at));
      bytes.set(part, at);
      at += part.length;
    }
    // 206 carries "bytes 0-63/12345"; a 200 carries the whole size in content-length.
    const total = Number(response.status === 206 ? response.headers.get("content-range")?.split("/")[1] : response.headers.get("content-length"));
    return { bytes, size: Number.isFinite(total) ? total : bytes.length };
  }

  async createSignedPlayback(bucket: Bucket, path: string, seconds: number) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, seconds);
    if (error || !data) throw new Error("Could not create a playback link");
    return data.signedUrl;
  }
}

let override: DocumentStorage | null = null;
let real: DocumentStorage | null = null;

/** Tests only: replace storage with a fake. Pass null to restore the real one. */
export function setDocumentStorage(storage: DocumentStorage | null) {
  override = storage;
}

export function getDocumentStorage(): DocumentStorage {
  if (override) return override;
  real ??= new SupabaseDocumentStorage();
  return real;
}
