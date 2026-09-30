// Creates (or corrects) the private document buckets on whatever Supabase project .env.local points to.
// Run once per environment: pnpm storage:setup   (local, staging and production alike)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from "@/modules/documents/files";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const BUCKETS = ["employee-docs", "company-docs"];
const options = { public: false, fileSizeLimit: MAX_FILE_BYTES, allowedMimeTypes: ALLOWED_MIME_TYPES };

console.log(`Project: ${new URL(url).host}`);
for (const name of BUCKETS) {
  const { data: existing } = await admin.storage.getBucket(name);
  const { error } = existing ? await admin.storage.updateBucket(name, options) : await admin.storage.createBucket(name, options);
  if (error) throw new Error(`${name}: ${error.message}`);
  console.log(`${existing ? "updated" : "created"}: ${name} (private, 10 MB, PDF/JPG/PNG/DOCX)`);
}
