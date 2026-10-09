import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { CaseFilters, CaseList, StatsCard } from "@/modules/safevoice/components/case-list";
import { SafevoiceNotConfigured } from "@/modules/safevoice/handler-db";
import { getStats, listCases } from "@/modules/safevoice/queries";
import { listFilterSchema } from "@/modules/safevoice/validators";

export const metadata: Metadata = { title: "Safe Voice cases" };

type Loaded = { stats: Awaited<ReturnType<typeof getStats>>; list: Awaited<ReturnType<typeof listCases>> | null } | null;

async function load(handler: boolean, filter: ReturnType<typeof listFilterSchema.parse>, paging: { page: number; pageSize: number }): Promise<Loaded> {
  try {
    const stats = await orNotFound(getStats());
    const list = handler ? await orNotFound(listCases({ filter, ...paging })) : null;
    return { stats, list };
  } catch (error) {
    if (error instanceof SafevoiceNotConfigured) return null;
    throw error;
  }
}

export default async function SafeVoiceCasesPage({ searchParams }: PageProps<"/safe-voice-cases">) {
  const user = await requireUser();
  const handler = can(user, "safevoice.handle");
  // No handler flag and no counts permission: the page does not exist for this person (a Super Admin is not a handler by default).
  if (!handler && !can(user, "safevoice.view_counts")) notFound();

  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const filter = listFilterSchema.parse(one(params.status));
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const loaded = await load(handler, filter, paging);

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Safe Voice cases</h1>
        <p className="mt-1 text-muted-foreground">
          {handler ? "Anonymous reports. Only designated handlers can read them. Never try to find out who a reporter is." : "Counts only. Individual reports are visible to designated handlers alone."}
        </p>
      </div>
      {loaded === null ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Safe Voice is not connected to this copy of ELEVATE yet (the handler database connection is not set). See the Safe Voice section of docs/SETUP.md.
        </div>
      ) : (
        <>
          {loaded.list ? (
            <>
              <p className="text-sm text-muted-foreground">
                {loaded.list.overview.open} open, {loaded.list.overview.needsReply} waiting for a handler. Cases are shown by the day they were received; no time of day is kept.
              </p>
              <CaseFilters current={filter} />
              <CaseList rows={loaded.list.rows} info={loaded.list.info} filter={filter} />
            </>
          ) : null}
          <StatsCard stats={loaded.stats} />
        </>
      )}
    </div>
  );
}
