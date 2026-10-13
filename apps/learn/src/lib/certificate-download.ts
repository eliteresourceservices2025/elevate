import { renderCertificatePdf } from "./certificate-pdf";
import { resolveSession } from "./handlers";
import { getOverview } from "./queries";
import { withUser, type Sql } from "./db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/** The signed-in person's own certificate as a PDF. Only theirs: the overview is read through their own session. */
export async function handleCertificateDownload(
  request: Request,
  assignmentId: string,
  deps: { sql: Sql; production: boolean },
): Promise<Response> {
  if (!UUID.test(assignmentId)) return plain(404, "Not found");
  const session = await resolveSession(request.headers.get("cookie"), deps);
  if (!session) return plain(401, "Please sign in again.");
  const overview = await getOverview(deps.sql, session.userId, assignmentId);
  if (!overview?.certificate || overview.certificate.revoked) return plain(404, "Not found");
  const { certificate, assignment } = overview;
  // The transcript page: modules finished, the passing score and day, the address recorded at acceptance (read through the person's own rows).
  const transcript = await withUser(deps.sql, session.userId, async (tx) => {
    const [r] = await tx`select learn.certificate_transcript(${assignmentId}::uuid) as t`;
    return (r?.t ?? null) as { modules?: { title: string; completedOn: string | null }[]; scorePercent?: number | null; takenOn?: string | null; ipAddress?: string | null } | null;
  });
  const pdf = await renderCertificatePdf({
    holderName: certificate.holderName,
    courseTitle: assignment.courseTitle,
    issuedOn: certificate.issuedOn,
    endsOn: certificate.endsOn,
    reference: certificate.reference,
    verifyUrl: `${new URL(request.url).origin}/verify`,
    modules: transcript?.modules ?? [],
    scorePercent: transcript?.scorePercent ?? null,
    takenOn: transcript?.takenOn ?? null,
    ipAddress: transcript?.ipAddress ?? null,
  });
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="ers-certificate-${certificate.reference}.pdf"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
