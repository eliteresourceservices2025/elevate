import type { Metadata } from "next";
import Link from "next/link";
import { Pin } from "lucide-react";
import { PagerLinks } from "@/components/pager";
import { paginate, parsePaging } from "@/lib/pagination";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DueBadge } from "@/modules/announcements/components/ack-display";
import { FormDialog } from "@/components/form-dialog";
import { NewPolicyForm } from "@/modules/announcements/components/policy-editor";
import { hidesVersion } from "@/modules/announcements/constants";
import { PopupQueueAdmin } from "@/modules/announcements/components/popup-admin";
import { listPopupQueue } from "@/modules/announcements/popup-queries";
import { listAnnouncements, listPolicies } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Announcements" };

const TABS = [
  { key: "announcements", label: "Announcements" },
  { key: "policies", label: "Policies" },
  { key: "popups", label: "Pop-up queue" },
] as const;

const KIND_LABEL = { general: null, privacy_notice: "Privacy notice", monitoring: "Monitoring policy" } as const;

export default async function AnnouncementsPage({ searchParams }: PageProps<"/announcements">) {
  const user = await requireUser();
  const isHr = can(user, "announcements.manage");
  const sp = await searchParams;
  const requested = sp.tab;
  const paging = parsePaging({ page: sp.page, size: sp.size }, 10);
  const tab = TABS.find((t) => t.key === requested && (t.key !== "popups" || isHr))?.key ?? "announcements";
  const today = todayInZone();

  const items = tab === "announcements" ? await orNotFound(listAnnouncements()) : null;
  const policies = tab === "policies" ? await orNotFound(listPolicies()) : null;
  const popupRows = tab === "popups" ? await orNotFound(listPopupQueue()) : null;
  const itemPage = items ? paginate(items, paging.page, paging.pageSize) : null;
  const policyPage = policies ? paginate(policies, paging.page, paging.pageSize) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        description="Company news and the policies everyone follows."
        actions={
          <>
            {isHr && tab === "announcements" ? (
              <Link href="/announcements/new" className={buttonVariants()}>
                New announcement
              </Link>
            ) : null}
            {isHr && tab === "policies" ? (
              <FormDialog
                label="Add a policy"
                title="Add a policy"
                description="It is saved as a draft. Nobody sees it until you publish it."
                size="xl"
              >
                <NewPolicyForm today={today} />
              </FormDialog>
            ) : null}
          </>
        }
      />

      <nav aria-label="Announcements sections" className="flex gap-1 border-b">
        {TABS.filter((t) => t.key !== "popups" || isHr).map((t) => (
          <Link
            key={t.key}
            href={`/announcements?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm", t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {items ? (
        items.length === 0 ? (
          <p className="text-muted-foreground">No announcements yet.</p>
        ) : (
          <ul className="space-y-3">
            {itemPage?.rows.map((a) => (
              <li key={a.id}>
                <Link href={`/announcements/${a.id}`} className="block rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.pinned ? <Pin className="size-4 text-primary" aria-label="Pinned" /> : null}
                    <h2 className="font-semibold">{a.title}</h2>
                    {a.needsMyAck ? <DueBadge due={a.due} dueOn={a.dueOn} today={today} /> : null}
                    {a.requiresAck && a.acknowledged ? <Badge variant="outline">Acknowledged</Badge> : null}
                    {a.audience === "teams" ? <Badge variant="outline">Selected teams</Badge> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.excerpt}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatInZone(a.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}
                    {a.progress ? ` · ${a.progress.done} of ${a.progress.total} acknowledged` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {itemPage ? <PagerLinks info={itemPage.info} basePath="/announcements" query={{ tab: "announcements" }} defaultSize={10} label="announcements" /> : null}

      {popupRows ? <PopupQueueAdmin rows={popupRows} /> : null}

      {policies ? (
        <div className="space-y-6">
          {policies.length === 0 ? <p className="text-muted-foreground">No policies have been published yet.</p> : null}
          <ul className="space-y-3">
            {policyPage?.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/announcements/policies/${p.id}`} className="block rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{p.title}</h2>
                    {KIND_LABEL[p.kind] ? <Badge variant="outline">{KIND_LABEL[p.kind]}</Badge> : null}
                    {p.needsMyAck ? <DueBadge due={p.due} dueOn={p.dueOn} today={today} /> : null}
                    {p.requiresAck && p.acknowledged ? <Badge variant="outline">Acknowledged</Badge> : null}
                    {p.version === null ? <Badge variant="secondary">Draft, not published</Badge> : null}
                    {p.hasDraft && p.version !== null ? <Badge variant="secondary">Draft in progress</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.version !== null && p.publishedAt ? `${hidesVersion(p.kind) ? "Published" : `Version ${p.version}, published`} ${formatInZone(p.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}` : "Nobody can see this yet."}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {policyPage ? <PagerLinks info={policyPage.info} basePath="/announcements" query={{ tab: "policies" }} defaultSize={10} label="policies" /> : null}
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Choose which emails you get in <Link href="/settings/notifications" className="text-primary underline-offset-4 hover:underline">Settings, Email notifications</Link>.
      </p>
    </PageContainer>
  );
}
