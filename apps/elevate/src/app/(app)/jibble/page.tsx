import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { JibblePanel } from "@/modules/jibble/components/jibble-panel";
import { getJibbleOverview } from "@/modules/jibble/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Jibble" };

export default async function JibblePage({ searchParams }: { searchParams: Promise<{ preview?: string; callSearch?: string; callStatus?: string; callPage?: string; exceptionPage?: string }> }) {
  await requireUser();
  const params = await searchParams;
  const overview = await orNotFound(getJibbleOverview({ search: params.callSearch, status: params.callStatus, page: params.callPage, exceptionPage: params.exceptionPage }));
  const requestedPreview = params.preview;
  const preview = process.env.NODE_ENV === "development" && (requestedPreview === "shifts" || requestedPreview === "shifts50");
  const exampleShifts = [
    { id: "preview-1", name: "Sample Person A", clockIn: "2026-10-26T20:03:00.000Z", clockOut: "2026-10-27T00:04:00.000Z" },
    { id: "preview-2", name: "Sample Person B", clockIn: "2026-10-26T21:00:00.000Z", clockOut: "2026-10-27T01:01:00.000Z" },
    { id: "preview-3", name: "Sample Person C", clockIn: "2026-10-26T22:00:00.000Z", clockOut: null },
  ];
  const fiftyShifts = Array.from({ length: 50 }, (_, i) => {
    const clockIn = Date.parse("2026-10-26T16:00:00.000Z") - i * 5 * 60_000;
    return { id: `preview-50-${i}`, name: `Sample Person ${String(i + 1).padStart(2, "0")}`, clockIn: new Date(clockIn).toISOString(), clockOut: new Date(clockIn + 8 * 60 * 60_000).toISOString() };
  });
  const exampleCalls = [
    { id: "preview-call-1", name: "Sample Person A", action: "Out", status: "failed", attempts: 1, lastError: "http 400: request refused", createdAt: "2026-10-27T00:04:00.000Z", sentAt: null, source: "event", fallback: false },
    { id: "preview-call-2", name: "Sample Person B", action: "In", status: "sent", attempts: 1, lastError: null, createdAt: "2026-10-26T21:00:00.000Z", sentAt: "2026-10-26T21:00:08.000Z", source: "event", fallback: false },
    { id: "preview-call-3", name: "Sample Person C", action: "StartBreak", status: "sent", attempts: 1, lastError: "no Jibble break available: clocked out instead", createdAt: "2026-10-26T20:40:00.000Z", sentAt: "2026-10-26T20:40:05.000Z", source: "event", fallback: true },
    { id: "preview-call-4", name: "Sample Person D", action: "In", status: "queued", attempts: 1, lastError: "network: timeout", createdAt: "2026-10-26T20:15:00.000Z", sentAt: null, source: "event", fallback: false },
    { id: "preview-call-5", name: "Sample Person E", action: "Out", status: "failed", attempts: 1, lastError: "http 400: request refused", createdAt: "2026-10-26T20:00:00.000Z", sentAt: null, source: "repair", fallback: false },
  ];
  const sampleLog = exampleCalls.filter((call) => (overview.callHistory.status === "all" || call.status === overview.callHistory.status) && call.name.toLowerCase().includes(overview.callHistory.search.toLowerCase()));
  const display = preview ? { ...overview, shifts: requestedPreview === "shifts50" ? fiftyShifts : exampleShifts, log: sampleLog.map((call) => ({ ...call, reviewed: false })), counts: { queued: 1, sent24h: 2, failed: 2 }, callHistory: { ...overview.callHistory, page: 1, pages: 1, total: sampleLog.length, from: sampleLog.length ? 1 : 0, to: sampleLog.length } } : overview;
  return (
    <PageContainer>
      <PageHeader title="Jibble" description="Connection status, people matching and the latest calls." />
      {preview ? <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">Local preview: shifts, calls and call counts are fictional examples. No clock records or Jibble calls were created. Retry is disabled in preview. <a href="/jibble" className="font-medium underline">Exit preview</a></p> : null}
      <JibblePanel overview={display} previewMode={preview ? requestedPreview : undefined} />
    </PageContainer>
  );
}
