// Creates (or corrects) the private document buckets on whatever Supabase project .env.local points to.
// Run once per environment: pnpm storage:setup   (local, staging and production alike)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ALLOWED_MIME_TYPES, FILE_TYPES, MAX_FILE_BYTES, MAX_VIDEO_BYTES, VIDEO_MIME_TYPES } from "@/modules/documents/files";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
// People's documents take every type the vault allows. Resumes and signed documents never need the newer types, so those buckets
// keep the original four (the app checks the type by its bytes as well; this is the second lock).
const CORE_TYPES = [FILE_TYPES.pdf.mime, FILE_TYPES.jpg.mime, FILE_TYPES.png.mime, FILE_TYPES.docx.mime];
const BUCKETS: { name: string; types: string[]; maxBytes: number }[] = [
  { name: "employee-docs", types: ALLOWED_MIME_TYPES, maxBytes: MAX_FILE_BYTES },
  { name: "company-docs", types: ALLOWED_MIME_TYPES, maxBytes: MAX_FILE_BYTES },
  { name: "recruiting-docs", types: CORE_TYPES, maxBytes: MAX_FILE_BYTES },
  { name: "signed-docs", types: CORE_TYPES, maxBytes: MAX_FILE_BYTES },
  // Announcement videos: MP4 and WebM only, 100 MB. A hosted project also has a project-wide file size cap (Settings > Storage)
  // that must be at least this large, or uploads above it fail.
  { name: "announcement-videos", types: VIDEO_MIME_TYPES, maxBytes: MAX_VIDEO_BYTES },
  // Chat files, pictures and voice notes: the same documents as the vault plus voice notes (WebM, Ogg, MP4 audio), 10 MB.
  { name: "chat-files", types: [...ALLOWED_MIME_TYPES, "audio/webm", "audio/ogg", "audio/mp4"], maxBytes: MAX_FILE_BYTES },
  // Call recordings: WebM pieces of about 10 MB (24 MB at most), kept 30 days. Only the recorder's browser uploads, with a one-time token.
  { name: "call-recordings", types: ["video/webm"], maxBytes: 24 * 1024 * 1024 },
  // ELEVATE Tracker screenshots: already blurred on the person's computer, small JPEG or PNG files (300 KB checked by the server), kept 30 days.
  { name: "activity-shots", types: ["image/jpeg", "image/png"], maxBytes: 512 * 1024 },
  // ELEVATE Tracker App installers and update files (registered by pnpm tracker:build). Not reachable except through signed links.
  { name: "tracker-builds", types: ["application/octet-stream", "application/x-msi", "application/x-msdownload", "application/x-apple-diskimage", "application/gzip"], maxBytes: 100 * 1024 * 1024 },
];

console.log(`Project: ${new URL(url).host}`);
for (const { name, types, maxBytes } of BUCKETS) {
  const options = { public: false, fileSizeLimit: maxBytes, allowedMimeTypes: types };
  const { data: existing } = await admin.storage.getBucket(name);
  const { error } = existing ? await admin.storage.updateBucket(name, options) : await admin.storage.createBucket(name, options);
  if (error) throw new Error(`${name}: ${error.message}`);
  console.log(`${existing ? "updated" : "created"}: ${name} (private, ${Math.round(maxBytes / 1024 / 1024)} MB, ${types.length} file types)`);
}
