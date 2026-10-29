import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { addDays } from "@/modules/attendance/schedule";
import { FLAG_LABELS } from "@/modules/attendance/flag-labels";
import { ReviewPanel } from "@/modules/attendance/components/hours-panels";
import { getTeamReview, type ReviewDay, type TeamReview } from "@/modules/attendance/hours-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Hours review" };

const sampleDays = (flagsByDate: Record<string, string[]> = {}, approved = false): ReviewDay[] =>
  ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((date, index) => ({
    date,
    // eslint-disable-next-line security/detect-object-injection -- index comes from the fixed five-day preview list.
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri"][index],
    scheduledMinutes: 480,
    workedMinutes: index === 2 ? 485 : 480,
    breakMinutes: 30,
    extraMinutes: index === 2 ? 5 : 0,
    approvedExtraMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    // eslint-disable-next-line security/detect-object-injection -- date comes from the fixed five-day preview list.
    flags: flagsByDate[date] ?? [],
    firstIn: Date.parse(`${date}T09:00:00-07:00`),
    lastOut: Date.parse(`${date}T17:30:00-07:00`),
    state: approved ? "approved" : "none",
    finished: true,
  }));

/** Development-only examples for reviewing density, hierarchy and exception states without touching attendance data. */
const sampleReview = (): TeamReview => {
  const rows = [
    { employeeId: "00000000-0000-4000-8000-000000000001", name: "Maria Santos", team: "Client Success", zone: "America/Phoenix", days: sampleDays(), scheduledMinutes: 2400, workedMinutes: 2405, extraMinutes: 5, approvedExtraMinutes: 0, lateDays: 0, absentDays: 0, flags: [], state: "none", canApprove: true },
    { employeeId: "00000000-0000-4000-8000-000000000002", name: "John Raymond Barrogo", team: "ELITE Resource Services", zone: "America/Phoenix", days: sampleDays({ "2026-10-21": ["jibble_mismatch", "corrected"] }), scheduledMinutes: 2400, workedMinutes: 2405, extraMinutes: 5, approvedExtraMinutes: 0, lateDays: 0, absentDays: 0, flags: ["jibble_mismatch", "corrected"], state: "none", canApprove: true },
    { employeeId: "00000000-0000-4000-8000-000000000003", name: "Jessa Maïtem", team: "Client Success", zone: "America/Phoenix", days: sampleDays({ "2026-10-20": ["absent"], "2026-10-22": ["idle_unanswered"] }), scheduledMinutes: 2400, workedMinutes: 1925, extraMinutes: 5, approvedExtraMinutes: 0, lateDays: 0, absentDays: 1, flags: ["absent", "idle_unanswered"], state: "none", canApprove: true },
    { employeeId: "00000000-0000-4000-8000-000000000004", name: "Ana Reyes", team: "Client Success", zone: "America/Phoenix", days: sampleDays({ "2026-10-21": ["corrected"] }, true), scheduledMinutes: 2400, workedMinutes: 2405, extraMinutes: 5, approvedExtraMinutes: 0, lateDays: 0, absentDays: 0, flags: ["corrected"], state: "approved", canApprove: false },
  ] as TeamReview["rows"];
  return { weekStart: "2026-10-19", weekEnd: "2026-10-25", rows, scope: "all", pending: 3, canMarkTest: false, testDays: [] };
};

export default async function HoursReviewPage({ searchParams }: PageProps<"/hours-review">) {
  await requireUser();
  const params = await searchParams;
  const review = await orNotFound(getTeamReview(typeof params.rweek === "string" ? params.rweek : undefined));
  const preview = process.env.NODE_ENV === "development" && params.preview === "sample";
  const display = preview ? sampleReview() : review;
  return (
    <PageContainer>
      <PageHeader title="Hours review" description="Check each week and approve it. Approved hours are what HR exports for payroll." />
      {preview ? <p role="status" className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">Local preview: these people, hours and flags are fictional examples. Approval controls are disabled and no attendance records were created. <a href="/hours-review" className="font-medium underline">Exit preview</a></p> : null}
      <ReviewPanel review={display} previewMode={preview} prevHref={`/hours-review?rweek=${addDays(display.weekStart, -7)}`} nextHref={`/hours-review?rweek=${addDays(display.weekStart, 7)}`} flagLabels={Object.fromEntries(FLAG_LABELS)} />
    </PageContainer>
  );
}
