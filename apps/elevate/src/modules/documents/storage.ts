import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// All file storage goes through this interface. The real implementation uses Supabase Storage with
// the service key; tests swap in an in-memory fake. Buckets are private: nothing here creates a public
// URL, and every link is signed and short-lived.

export const BUCKETS = { employee: "employee-docs", company: "company-docs", recruiting: "recruiting-docs", signed: "signed-docs" } as const;
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
