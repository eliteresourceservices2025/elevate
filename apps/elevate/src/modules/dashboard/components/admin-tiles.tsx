import { FileSearch, KeyRound } from "lucide-react";
import { getAccessCounts, getAuditHighlights } from "../manager-queries";
import { orFallback } from "../or-fallback";
import { RowMeta, Tile, TileList, TileRow } from "./bento";
import { guarded } from "./guard";

/** Pending invitations and the week's role and sign-in resets. Counts only, never who. */
export async function AccessTile() {
  return guarded("Access", async () => {
    const a = await orFallback(() => getAccessCounts(), null);
    if (!a) return null;
    return (
      <Tile label="Access" title="Access" icon={<KeyRound className="size-4 text-primary" aria-hidden />} href="/settings/roles" hrefLabel="Roles">
        <TileList>
          <TileRow>
            <span>Invitations pending</span>
            <RowMeta>{a.invitationsPending}</RowMeta>
          </TileRow>
          <TileRow>
            <span>Role changes this week</span>
            <RowMeta>{a.roleChangesWeek}</RowMeta>
          </TileRow>
          <TileRow>
            <span>Sign-in resets this week</span>
            <RowMeta>{a.mfaResetsWeek}</RowMeta>
          </TileRow>
        </TileList>
      </Tile>
    );
  });
}

/** How many exports, sensitive views and imports the audit log recorded this week. Counts only: never the content. */
export async function AuditHighlightsTile() {
  return guarded("Audit highlights", async () => {
    const h = await orFallback(() => getAuditHighlights(), null);
    if (!h) return null;
    return (
      <Tile label="Audit highlights" title="Audit highlights" icon={<FileSearch className="size-4 text-primary" aria-hidden />} href="/settings/audit-log" hrefLabel="Audit log">
        <TileList>
          <TileRow>
            <span>Exports this week</span>
            <RowMeta>{h.exportsWeek}</RowMeta>
          </TileRow>
          <TileRow>
            <span>Sensitive views</span>
            <RowMeta>{h.sensitiveViewsWeek}</RowMeta>
          </TileRow>
          <TileRow>
            <span>Imports</span>
            <RowMeta>{h.importsWeek}</RowMeta>
          </TileRow>
        </TileList>
      </Tile>
    );
  });
}
