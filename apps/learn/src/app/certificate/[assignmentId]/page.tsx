import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AcceptForm, PrintButton } from "@/components/forms";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getOverview } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Certificate" };

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
          <h1>Certificate of Completion</h1>
          <p>This certifies that</p>
          <p className="holder">{certificate.holderName}</p>
          <p>
            completed <strong>{assignment.courseTitle}</strong> training for Elite Resource Services.
          </p>
          {overview.modules.length > 0 ? (
            <>
              <p>
                <strong>This course covered:</strong>
              </p>
              <p className="muted small">{overview.modules.map((m) => m.title).join("  |  ")}</p>
            </>
          ) : null}
          <p>
            Issued {certificate.issuedOn} · Valid until {certificate.endsOn}
          </p>
          <p className="muted">Reference {certificate.reference}</p>
          {certificate.revoked ? <p className="feedback bad">This certificate was revoked.</p> : null}
          <p className="muted small">This is ERS training completion, not an official certification from an outside body. Anyone can check it at the verify page with the reference and your full name.</p>
        </section>
        <p className="no-print">
          {certificate.revoked ? null : (
            <a className="button" href={`/api/certificate/${assignment.id}`} download>
              Download PDF
            </a>
          )}{" "}
          <PrintButton />
        </p>
      </>
    );
  }

  const readyWithoutExam = !overview.requiresExam && overview.allModulesDone && ["assigned", "in_progress"].includes(assignment.status);
  if ((assignment.status !== "passed" && !readyWithoutExam) || (assignment.isUpdate && assignment.accepted)) redirect(`/course/${assignment.id}`);

  return (
    <>
      <p className="muted">
        <Link href={`/course/${assignment.id}`}>Back to the course</Link>
      </p>
      <h1>One last step</h1>
      <p>{assignment.isUpdate ? "You passed. Read the statement and accept it to finish the update. Your certificate stays as it is." : readyWithoutExam ? "You have read every module. Read the statement and accept it to receive your certificate." : "You passed. Read the statement and accept it to receive your certificate."}</p>
      <AcceptForm assignmentId={assignment.id} statementVersion={attestation.version} statement={attestation.text} />
    </>
  );
}

