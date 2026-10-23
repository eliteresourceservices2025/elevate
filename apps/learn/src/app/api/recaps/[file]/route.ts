import { getSql } from "@/lib/db";
import { handleRecapMedia } from "@/lib/recap-media";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  return handleRecapMedia(request, file, { sql: getSql(), production: process.env.NODE_ENV === "production" });
}
