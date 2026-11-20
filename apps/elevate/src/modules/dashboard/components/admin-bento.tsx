import type { TileDef, TileLayout } from "../bento-tiles";
import { AccessTile, AuditHighlightsTile } from "./admin-tiles";
import { BentoView } from "./bento-view";
import { CelebrationsTile } from "./celebrations-tile";
import { DecisionsTile } from "./decisions-tile";
import { ExecHealthTile } from "./executive-tiles";
import { HrWorkforceTile, RisksTile } from "./hr-tiles";
import { MeStrip } from "./me-strip";
import { WhosOutTile } from "./people-tiles";

/** The Super Admin's view: system health, risks, decisions, access and audit counts, workforce, who is out and celebrations. */
export const ADMIN_TILES: TileDef[] = [
  { id: "health", label: "System health", span: 2, render: () => <ExecHealthTile /> },
  { id: "risks", label: "Risks", span: 2, render: () => <RisksTile lens="admin" /> },
  { id: "decisions", label: "Needs your decision", span: 2, render: () => <DecisionsTile /> },
  { id: "access", label: "Access", span: 3, render: () => <AccessTile /> },
  { id: "audit", label: "Audit highlights", span: 3, render: () => <AuditHighlightsTile /> },
  { id: "workforce", label: "Workforce by team", span: 2, render: () => <HrWorkforceTile /> },
  { id: "out", label: "Who is out", span: 2, render: () => <WhosOutTile /> },
  { id: "celebrations", label: "Celebrations", span: 2, render: () => <CelebrationsTile /> },
];

export function AdminBento({ layout = null, meActions }: { layout?: TileLayout | null; meActions?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <MeStrip actions={meActions} />
      <BentoView tiles={ADMIN_TILES} layout={layout} />
    </div>
  );
}
