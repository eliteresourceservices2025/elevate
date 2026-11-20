import type { TileDef, TileLayout } from "../bento-tiles";
import { BentoView } from "./bento-view";
import { CelebrationsTile } from "./celebrations-tile";
import { DecisionsTile } from "./decisions-tile";
import { HrAttentionTile, HrKpiTile, HrRisksTile, HrTrackerTile, HrWorkforceTile } from "./hr-tiles";
import { MeStrip } from "./me-strip";
import { WhosOutTile } from "./people-tiles";

const kpi = (id: string, label: string): TileDef => ({ id: `kpi-${id}`, label, span: 1, render: () => <HrKpiTile id={id} /> });

/** The HR view: six number tiles, then decisions and risks, the onboarding tracker and workforce, then attention, who is out and celebrations. */
export const HR_TILES: TileDef[] = [
  kpi("active", "Active"),
  kpi("onboarding", "Onboarding"),
  kpi("offboarding", "Offboarding"),
  kpi("change-requests", "Change requests"),
  kpi("docs-expiring", "Docs expiring"),
  kpi("training-overdue", "Training overdue"),
  { id: "decisions", label: "Needs your decision", span: 4, render: () => <DecisionsTile /> },
  { id: "risks", label: "Risks", span: 2, render: () => <HrRisksTile /> },
  { id: "tracker", label: "Onboarding and offboarding", span: 3, render: () => <HrTrackerTile /> },
  { id: "workforce", label: "Workforce by team", span: 3, render: () => <HrWorkforceTile /> },
  { id: "attention", label: "Needs attention", span: 2, render: () => <HrAttentionTile /> },
  { id: "out", label: "Who is out", span: 2, render: () => <WhosOutTile /> },
  { id: "celebrations", label: "Celebrations", span: 2, render: () => <CelebrationsTile /> },
];

export function HrBento({ layout = null, meActions }: { layout?: TileLayout | null; meActions?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <MeStrip actions={meActions} />
      <BentoView tiles={HR_TILES} layout={layout} />
    </div>
  );
}
