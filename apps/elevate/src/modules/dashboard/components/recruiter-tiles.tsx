import { Briefcase, CalendarClock, FileSignature, Inbox, UserRoundSearch } from "lucide-react";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { getNewApplicantsByOpening, getOffersPending, getRecruitingSummary, getTalentPoolCount, getUpcomingInterviews, listOpenings } from "@/modules/recruiting/queries";
import { orFallback } from "../or-fallback";
import { RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

const STAGE_ORDER = [
  ["applied", "Applied"],
  ["screening", "Screening"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["hired", "Hired"],
] as const;

/** Applicants by stage across every opening, counts only. */
export async function PipelineTile() {
  return guarded("Pipeline by stage", async () => {
    const s = await orFallback(() => getRecruitingSummary(), null);
    if (!s) return null;
    const max = Math.max(1, ...STAGE_ORDER.map(([k]) => s.counts[k]));
    return (
      <Tile label="Pipeline by stage" title="Pipeline by stage" icon={<Briefcase className="size-4 text-primary" aria-hidden />} href="/recruiting" hrefLabel="Applicants">
        <TileList>
          {STAGE_ORDER.map(([key, label]) => (
            <TileRow key={key}>
              <span className="w-20 shrink-0 truncate">{label}</span>
              <span aria-hidden className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${(s.counts[key] / max) * 100}%` }} />
              </span>
              <RowMeta>{s.counts[key]}</RowMeta>
            </TileRow>
          ))}
        </TileList>
      </Tile>
    );
  });
}

/** Offers out, declined and about to expire: the recruiter's decisions. */
export async function OffersTile() {
  return guarded("Offers pending", async () => {
    const o = await orFallback(() => getOffersPending(), null);
    if (!o) return null;
    return (
      <Tile label="Offers pending" title="Offers pending" icon={<FileSignature className="size-4 text-primary" aria-hidden />} href="/recruiting" hrefLabel="Offers" tone="primary">
        <TileList>
          <TileRow>
            <span>Awaiting signature</span>
            <RowMeta>{o.awaitingSignature}</RowMeta>
          </TileRow>
          <TileRow>
            <span>Expiring in 3 days</span>
            <RowMeta className={o.expiringSoon > 0 ? "text-destructive" : undefined}>{o.expiringSoon}</RowMeta>
          </TileRow>
          <TileRow>
            <span>Declined, last 30 days</span>
            <RowMeta>{o.declined}</RowMeta>
          </TileRow>
        </TileList>
      </Tile>
    );
  });
}

/** Today's and the coming week's interviews, with a note when one has started and has no scorecard yet. */
export async function InterviewsTile() {
  return guarded("Interviews", async () => {
    const list = await orFallback(() => getUpcomingInterviews(3), null);
    if (!list) return null;
    return (
      <Tile label="Interviews" title="Interviews" icon={<CalendarClock className="size-4 text-primary" aria-hidden />} href="/recruiting" hrefLabel="Recruiting">
        {list.length === 0 ? (
          <TileNote>No interviews in the next 7 days.</TileNote>
        ) : (
          <TileList>
            {list.map((i, n) => (
              <TileRow key={`${i.title}-${n}`}>
                <span className="w-20 shrink-0 text-xs font-medium">{formatInZone(i.startsAt, DEFAULT_TIMEZONE, "EEE h:mm a")}</span>
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                {i.scorecardDue ? <RowMeta className="text-destructive">Scorecard due</RowMeta> : null}
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}

/** Openings that got new applicants this week. */
export async function NewApplicantsTile() {
  return guarded("New applicants waiting", async () => {
    const list = await orFallback(() => getNewApplicantsByOpening(), null);
    if (!list) return null;
    return (
      <Tile label="New applicants waiting" title="New applicants this week" icon={<Inbox className="size-4 text-primary" aria-hidden />} href="/recruiting" hrefLabel="Review">
        {list.length === 0 ? (
          <TileNote>No new applicants this week.</TileNote>
        ) : (
          <TileList>
            {list.map((o, n) => (
              <TileRow key={`${o.title}-${n}`}>
                <span className="min-w-0 truncate">{o.title}</span>
                <RowMeta>{o.count} new</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}

/** Open roles with their applicant totals. */
export async function OpenRolesTile() {
  return guarded("Open roles", async () => {
    const openings = await orFallback(async () => (await listOpenings()).rows.filter((r) => r.status === "open"), null);
    if (!openings) return null;
    return (
      <Tile label="Open roles" title="Open roles" icon={<Briefcase className="size-4 text-primary" aria-hidden />} href="/recruiting" hrefLabel="Roles">
        {openings.length === 0 ? (
          <TileNote>No open roles.</TileNote>
        ) : (
          <TileList>
            {openings.slice(0, 3).map((o, n) => (
              <TileRow key={`${o.id}-${n}`}>
                <span className="min-w-0 truncate">{o.title}</span>
                <RowMeta>{o.total}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
        {openings.length > 3 ? <p className="mt-auto pt-1.5 text-xs text-muted-foreground">+ {openings.length - 3} more</p> : null}
      </Tile>
    );
  });
}

/** People who ticked "keep my details" and have not run out. Count only. */
export async function TalentPoolTile() {
  return guarded("Talent pool", async () => {
    const n = await orFallback(() => getTalentPoolCount(), null);
    if (n === null) return null;
    return (
      <Tile label="Talent pool" title="Talent pool" icon={<UserRoundSearch className="size-4 text-primary" aria-hidden />}>
        <p className="text-2xl font-semibold tabular-nums">{n}</p>
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">kept their details for later roles</p>
      </Tile>
    );
  });
}
