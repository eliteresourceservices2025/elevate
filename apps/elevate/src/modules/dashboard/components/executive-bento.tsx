import type { TileDef, TileLayout } from "../bento-tiles";
import { BentoView } from "./bento-view";
import { CelebrationsTile } from "./celebrations-tile";
import { ExecHeadcountTile, ExecHealthTile, ExecHiringTile, ExecTimeOffTile, ExecTrainingTile } from "./executive-tiles";
import { RisksTile } from "./hr-tiles";
import { MeStrip } from "./me-strip";

/** The executive view: a calm headline view of headcount, hiring, training, risks and health. Counts only, never a name or a score. */
export const EXECUTIVE_TILES: TileDef[] = [
  { id: "headcount", label: "Headcount and movement", span: 3, render: () => <ExecHeadcountTile /> },
  { id: "hiring", label: "Hiring pipeline", span: 3, render: () => <ExecHiringTile /> },
  { id: "training", label: "Training compliance", span: 2, render: () => <ExecTrainingTile /> },
  { id: "risks", label: "Risks", span: 2, render: () => <RisksTile lens="executive" /> },
  { id: "health", label: "System health", span: 2, render: () => <ExecHealthTile /> },
  { id: "time-off", label: "Time off this week", span: 4, render: () => <ExecTimeOffTile /> },
  { id: "celebrations", label: "Celebrations", span: 2, render: () => <CelebrationsTile /> },
];

export function ExecutiveBento({ layout = null, meActions }: { layout?: TileLayout | null; meActions?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <MeStrip actions={meActions} />
      <BentoView tiles={EXECUTIVE_TILES} layout={layout} />
    </div>
  );
}
