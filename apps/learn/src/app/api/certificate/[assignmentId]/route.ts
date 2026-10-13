import { handleCertificateDownload } from "@/lib/certificate-download";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  return handleCertificateDownload(request, assignmentId, { sql: getSql(), production: process.env.NODE_ENV === "production" });
}
