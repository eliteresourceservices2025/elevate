import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AcceptForm, PrintButton } from "@/components/forms";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CertificatePage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const session = await requireSession();
  const overview = await getOverview(getSql(), session.userId, assignmentId);
  if (!overview) notFound();
  const { certificate, assignment, attestation } = overview;

  if (certificate) {
    return (
      <>
        <p className="muted no-print">
          <Link href={`/course/${assignment.id}`}>Back to the course</Link>
        </p>
        <section className="certificate" aria-label="Certificate">
          <p className="muted">Elite Resource Services</p>
          <h1>Certificate of completion</h1>
          <p>This certifies that</p>
          <p className="holder">{certificate.holderName}</p>
          <p>
            completed <strong>{assignment.courseTitle}</strong> training for Elite Resource Services.
          </p>
          <p>
            Issued {certificate.issuedOn} · Valid until {certificate.endsOn}
          </p>
          <p className="muted">Reference {certificate.reference}</p>
          {certificate.revoked ? <p className="feedback bad">This certificate was revoked.</p> : null}
          <p className="muted small">This is ERS training completion, not an official HIPAA certification. Anyone can check it at the verify page with the reference and your full name.</p>
        </section>
        <p className="no-print">
          <PrintButton />
        </p>
      </>
    );
  }

  if (assignment.status !== "passed") redirect(`/course/${assignment.id}`);

  return (
    <>
      <p className="muted">
        <Link href={`/course/${assignment.id}`}>Back to the course</Link>
      </p>
      <h1>One last step</h1>
      <p>You passed. Read the statement and accept it to receive your certificate.</p>
      <AcceptForm assignmentId={assignment.id} statementVersion={attestation.version} statement={attestation.text} />
    </>
  );
}

