import { getSql } from "@/lib/db";
import { handleRecordDownload } from "@/lib/record-download";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRecordDownload(request, { sql: getSql(), production: process.env.NODE_ENV === "production" });
}
