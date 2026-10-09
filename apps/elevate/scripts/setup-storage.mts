// Creates (or corrects) the private document buckets on whatever Supabase project .env.local points to.
// Run once per environment: pnpm storage:setup   (local, staging and production alike)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { ALLOWED_MIME_TYPES, FILE_TYPES, MAX_FILE_BYTES } from "@/modules/documents/files";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
// People's documents take every type the vault allows. Resumes and signed documents never need the newer types, so those buckets
// keep the original four (the app checks the type by its bytes as well; this is the second lock).
const CORE_TYPES = [FILE_TYPES.pdf.mime, FILE_TYPES.jpg.mime, FILE_TYPES.png.mime, FILE_TYPES.docx.mime];
const BUCKETS: { name: string; types: string[] }[] = [
  { name: "employee-docs", types: ALLOWED_MIME_TYPES },
  { name: "company-docs", types: ALLOWED_MIME_TYPES },
  { name: "recruiting-docs", types: CORE_TYPES },
  { name: "signed-docs", types: CORE_TYPES },
];

console.log(`Project: ${new URL(url).host}`);
for (const { name, types } of BUCKETS) {
  const options = { public: false, fileSizeLimit: MAX_FILE_BYTES, allowedMimeTypes: types };
  const { data: existing } = await admin.storage.getBucket(name);
  const { error } = existing ? await admin.storage.updateBucket(name, options) : await admin.storage.createBucket(name, options);
  if (error) throw new Error(`${name}: ${error.message}`);
  console.log(`${existing ? "updated" : "created"}: ${name} (private, 10 MB, ${types.length} file types)`);
}
