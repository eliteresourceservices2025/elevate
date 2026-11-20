import Link from "next/link";
import { CalendarDays, Cake, Megaphone, PartyPopper, Pin, UserPlus, Users } from "lucide-react";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { listAnnouncements } from "@/modules/announcements/queries";
import { getWhosOut } from "../feed-queries";
import { getAnniversariesTile, getBirthdaysTile, getMyTeamTile, getNewJoinersTile } from "../people-strip-queries";
import { Initials, RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

/** This month's birthdays (month and day only). Today's celebrants sit in a gold band on top. */
export async function BirthdaysTile() {
  return guarded("Birthdays", async () => {
    const { celebrants } = await getBirthdaysTile();
    const month = formatInZone(new Date(), DEFAULT_TIMEZONE, "MMMM");
    const today = celebrants.filter((c) => c.today).slice(0, 3);
    const rest = celebrants.filter((c) => !c.today);
    return (
      <Tile label="Birthdays this month" title={`Birthdays in ${month}`} icon={<Cake className="size-4 text-primary" aria-hidden />} tone="gold" className="lg:absolute lg:inset-0">
        {celebrants.length === 0 ? (
          <TileNote>No birthdays to show this month.</TileNote>
        ) : (
          <div tabIndex={0} aria-label="All birthdays this month (scrolls)" className="min-h-0 flex-1 overflow-y-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {today.map((c, i) => (
              <div key={`${c.name}-${i}`} className="mb-1.5 flex items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-accent-foreground">
                <PartyPopper className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                <span className="text-xs">Today</span>
              </div>
            ))}
            <TileList>
              {rest.map((c, i) => (
                <TileRow key={`${c.name}-${c.monthDay}-${i}`}>
                  <Initials name={c.name} />
                  <span className="min-w-0 truncate">{c.name}</span>
                  <RowMeta>{c.label}</RowMeta>
                </TileRow>
              ))}
            </TileList>
          </div>
        )}
        <p className="pt-2 text-xs text-muted-foreground">Month and day only. Hide yours in My profile.</p>
      </Tile>
    );
  });
}

/** Work anniversaries of one year or more this month. */
export async function AnniversariesTile() {
  return guarded("Work anniversaries", async () => {
    const list = await getAnniversariesTile();
    const shown = list.slice(0, 3);
    return (
      <Tile label="Work anniversaries" title="Anniversaries" icon={<PartyPopper className="size-4 text-primary" aria-hidden />}>
        {list.length === 0 ? (
          <TileNote>None this month.</TileNote>
        ) : (
          <TileList>
            {shown.map((c, i) => (
              <TileRow key={`${c.name}-${c.monthDay}-${i}`}>
                <Initials name={c.name} />
                <span className="min-w-0 truncate">{c.name}</span>
                <RowMeta>{c.years === 1 ? "1 year" : `${c.years} years`}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
        {list.length > shown.length ? <p className="pt-1.5 text-xs text-muted-foreground">+ {list.length - shown.length} more</p> : null}
      </Tile>
    );
  });
}

/** People who started in the last 30 days. */
export async function NewJoinersTile() {
  return guarded("New joiners", async () => {
    const list = await getNewJoinersTile();
    const shown = list.slice(0, 3);
    return (
      <Tile label="New joiners" title="New joiners" icon={<UserPlus className="size-4 text-primary" aria-hidden />}>
        {list.length === 0 ? (
          <TileNote>Nobody new in the last 30 days.</TileNote>
        ) : (
          <TileList>
            {shown.map((j, i) => (
              <TileRow key={`${j.name}-${j.label}-${i}`}>
                <Initials name={j.name} />
                <span className="min-w-0 truncate">{j.name}</span>
                <RowMeta>Started {j.label}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
        {list.length > shown.length ? <p className="pt-1.5 text-xs text-muted-foreground">+ {list.length - shown.length} more</p> : null}
      </Tile>
    );
  });
}

/** The person's lead and the people who share that lead. */
export async function MyTeamTile() {
  return guarded("My team", async () => {
    const team = await getMyTeamTile();
    const shown = team.slice(0, 4);
    return (
      <Tile label="My team" title="My team" icon={<Users className="size-4 text-primary" aria-hidden />}>
        {team.length === 0 ? (
          <TileNote>Your team shows here once you have a lead.</TileNote>
        ) : (
          <TileList>
            {shown.map((m, i) => (
              <TileRow key={`${m.name}-${i}`}>
                <Initials name={m.name} />
                <span className="min-w-0 truncate">{m.name}</span>
                {m.lead ? <RowMeta>Lead</RowMeta> : null}
              </TileRow>
            ))}
          </TileList>
        )}
        {team.length > shown.length ? <p className="pt-1.5 text-xs text-muted-foreground">+ {team.length - shown.length} more</p> : null}
      </Tile>
    );
  });
}

/** The next week at a glance, as a short list: only days with someone off or a holiday. */
export async function WhosOutTile() {
  return guarded("Who is out", async () => {
    const data = await getWhosOut();
    if (!data) return null;
    const busy = data.days.filter((d) => d.count > 0 || d.holidays.length > 0).slice(0, 3);
    return (
      <Tile label="Who is out" title="Who is out" icon={<CalendarDays className="size-4 text-primary" aria-hidden />} href="/time-off?tab=calendar" hrefLabel="Calendar">
        {busy.length === 0 ? (
          <TileNote>Nobody is out and there are no holidays in the next 7 days.</TileNote>
        ) : (
          <TileList>
            {busy.map((d) => (
              <TileRow key={d.date} className="flex-wrap">
                <span className="w-16 shrink-0 text-xs font-medium">{d.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {[d.holidays.join(", "), data.mode === "counts" || d.names.length === 0 ? (d.count > 0 ? `${d.count} ${d.count === 1 ? "person" : "people"} off` : "") : `${d.names.join(", ")}${d.extra > 0 ? ` and ${d.extra} more` : ""}`].filter(Boolean).join(" · ")}
                </span>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}

/** The two latest announcements. */
export async function AnnouncementsTile() {
  return guarded("Latest announcements", async () => {
    const latest = await listAnnouncements({ limit: 2 });
    return (
      <Tile label="Latest announcements" title="Announcements" icon={<Megaphone className="size-4 text-primary" aria-hidden />} href="/announcements">
        {latest.length === 0 ? (
          <TileNote>No announcements yet.</TileNote>
        ) : (
          <TileList>
            {latest.map((a) => (
              <TileRow key={a.id}>
                {a.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" /> : null}
                <Link href={`/announcements/${a.id}`} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {a.title}
                </Link>
                <RowMeta>{formatInZone(a.publishedAt, DEFAULT_TIMEZONE, "MMM d")}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}
