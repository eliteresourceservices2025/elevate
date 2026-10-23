import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CallResult } from "@/components/call-result";
import { CallRunner } from "@/components/call-runner";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getCallView } from "@/lib/queries";

export const metadata: Metadata = { title: "Mock call" };
export const dynamic = "force-dynamic";

// One mock-call attempt: the runner while it is open, the result once it is submitted. Reads only the person's own attempt (row-level
// security) and never the scoring key, which the app's database role cannot read.
export default async function CallPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const session = await requireSession();
  const view = await getCallView(getSql(), session.userId, attemptId);
  if (!view) notFound();

  if (view.status === "in_progress") {
    return (
      <>
        <p className="muted">
          <Link href={`/course/${view.assignmentId}`}>Back to the course</Link>
        </p>
        <h1>Mock call</h1>
        <p className="muted">Your picks are saved as you go. You can leave and come back to this call.</p>
        <CallRunner view={view} />
      </>
    );
  }

  return <CallResult view={view} />;
}
