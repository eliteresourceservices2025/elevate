import type { TileDef, TileLayout } from "../bento-tiles";
import { BentoView } from "./bento-view";
import { CelebrationsTile } from "./celebrations-tile";
import { DecisionsTile } from "./decisions-tile";
import { MeStrip } from "./me-strip";
import { WhosOutTile } from "./people-tiles";
import { ClockedInTile, ReviewsGoalsTile, TeamFlagsTile, TeamHoursTile } from "./team-lead-tiles";

/** The team lead's view: decisions first, then the team's hours, who is clocked in, flags, celebrations, who is out, reviews and goals. */
export const TEAM_LEAD_TILES: TileDef[] = [
  { id: "decisions", label: "Needs your decision", span: 4, render: () => <DecisionsTile /> },
  { id: "team-hours", label: "Team hours", span: 2, render: () => <TeamHoursTile /> },
  { id: "clocked-in", label: "Clocked in now", span: 2, render: () => <ClockedInTile /> },
  { id: "team-flags", label: "Team flags", span: 2, render: () => <TeamFlagsTile /> },
  { id: "celebrations", label: "Celebrations", span: 2, rows: 2, render: () => <CelebrationsTile tall /> },
  { id: "out", label: "Who is out", span: 2, render: () => <WhosOutTile /> },
  { id: "reviews-goals", label: "Reviews and goals due", span: 2, render: () => <ReviewsGoalsTile /> },
];

export function TeamLeadBento({ layout = null, meActions }: { layout?: TileLayout | null; meActions?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <MeStrip actions={meActions} />
      <BentoView tiles={TEAM_LEAD_TILES} layout={layout} />
    </div>
  );
}
