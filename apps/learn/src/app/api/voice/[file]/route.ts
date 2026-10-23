import { getSql } from "@/lib/db";
import { handleRecapMedia, VOICE_DIR } from "@/lib/recap-media";

export const dynamic = "force-dynamic";

// The read-aloud clips of the mock call and the exam: private files, handed only to a signed-in person (see src/lib/voice.ts).
export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  return handleRecapMedia(request, file, { sql: getSql(), production: process.env.NODE_ENV === "production", dir: VOICE_DIR });
}
