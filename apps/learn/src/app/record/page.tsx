import { ArrowRight, Award, CalendarDays, Clock, Download, Eye, FileCheck2 } from "lucide-react";
import Link from "next/link";
import { homeStatus } from "@/components/course-card";
import { HomeArt } from "@/components/home-art";
import { PageHead } from "@/components/page-head";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getRecord } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My training record" };

export const dynamic = "force-dynamic";

const TRACK_LABEL: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };
const STATUS_LABEL: Record<string, string> = { assigned: "Not started", in_progress: "In progress", passed: "Passed", expired: "Expired", cancelled: "Cancelled" };

/** The person's own training record: every course they were assigned, what they finished, their certificates and time spent. */
export default async function RecordPage() {
  const session = await requireSession();
  const entries = await getRecord(getSql(), session.userId);
  const minutes = entries.reduce((sum, e) => sum + e.minutesSpent, 0);
  const certificates = entries.filter((e) => e.certificate && !e.certificate.revoked).length;

  return (
    <div className="page-wide">
      <PageHead
        icon={<FileCheck2 size={30} />}
        title="My training record"
        text="Your current training in ELEVATE Learn and your certificates. Only you, HR and the privacy team can see your scores; your lead sees only whether you have passed."
        extra={
          entries.length > 0 ? (
            <a className="button hero-btn" href="/api/record/pdf" download>
              <Download size={16} aria-hidden="true" /> Download my record (PDF)
            </a>
          ) : null
        }
      />
      {entries.length === 0 ? (
        <p>You have no training on record yet.</p>
      ) : (
        <>
          <ul className="stat-tiles" aria-label="Summary">
            <li>
              <strong>{entries.length}</strong>
              <span>{entries.length === 1 ? "course" : "courses"} on record</span>
            </li>
            <li>
              <strong>{certificates}</strong>
              <span>{certificates === 1 ? "certificate" : "certificates"}</span>
            </li>
            <li>
              <strong>{minutes}</strong>
              <span>{minutes === 1 ? "minute" : "minutes"} of training time</span>
            </li>
          </ul>
          <ul className="record-grid">
            {entries.map((e) => {
              const status = homeStatus(e.status);
              return (
                <li key={e.assignmentId} className={`record-card${status === "done" ? " done" : ""}`}>
                  <div className="record-art">
                    <HomeArt name={e.courseSlug} />
                  </div>
                  <div className="record-body">
                    <div className="record-title">
                      <h2>{e.courseTitle}</h2>
                      <span className={`mod-chip inline ${status === "expired" ? "locked" : status}`}>{STATUS_LABEL[e.status] ?? e.status}</span>
                    </div>
                    <p className="muted">{TRACK_LABEL[e.track] ?? e.track}</p>
                    <ul className="facts">
                      <li>
                        <CalendarDays size={15} aria-hidden="true" /> Assigned {e.assignedOn} · due {e.dueOn}
                        {e.passedOn ? ` · passed ${e.passedOn}` : ""}
                      </li>
                      <li>
                        <Clock size={15} aria-hidden="true" /> {e.minutesSpent > 0 ? `About ${e.minutesSpent} ${e.minutesSpent === 1 ? "minute" : "minutes"}` : "No time recorded yet"}
                        {e.attempts > 0 ? ` · ${e.attempts} exam ${e.attempts === 1 ? "try" : "tries"}` : ""}
                        {e.scorePercent !== null ? ` · score ${Math.round(e.scorePercent * 10) / 10}%` : ""}
                      </li>
                    </ul>
                    {e.certificate ? (
                      <div className="cert-box">
                        <Award size={20} aria-hidden="true" />
                        <div>
                          <strong>{e.certificate.reference}</strong>
                          <span className="muted small">
                            Issued {e.certificate.issuedOn} · valid until {e.certificate.endsOn}
                            {e.certificate.revoked ? " (revoked)" : ""}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    <p className="record-actions">
                      <Link className="button secondary" href={`/course/${e.assignmentId}`}>
                        <ArrowRight size={15} aria-hidden="true" /> Open
                      </Link>
                      {e.certificate && !e.certificate.revoked ? (
                        <>
                          <a className="button secondary" href={`/api/certificate/${e.certificate.assignmentId}?view=1`} target="_blank" rel="noopener">
                            <Eye size={15} aria-hidden="true" /> Preview certificate
                          </a>
                          <a className="button" href={`/api/certificate/${e.certificate.assignmentId}`} download>
                            <Download size={15} aria-hidden="true" /> Download certificate PDF
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
