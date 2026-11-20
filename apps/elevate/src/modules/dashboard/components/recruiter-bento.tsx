import type { TileDef, TileLayout } from "../bento-tiles";
import { BentoView } from "./bento-view";
import { CelebrationsTile } from "./celebrations-tile";
import { MeStrip } from "./me-strip";
import { InterviewsTile, NewApplicantsTile, OffersTile, OpenRolesTile, PipelineTile, TalentPoolTile } from "./recruiter-tiles";

/** The recruiter's view: the pipeline, offers waiting, interviews, new applicants, open roles and the talent pool. */
export const RECRUITER_TILES: TileDef[] = [
  { id: "pipeline", label: "Pipeline by stage", span: 4, render: () => <PipelineTile /> },
  { id: "offers", label: "Offers pending", span: 2, render: () => <OffersTile /> },
  { id: "interviews", label: "Interviews", span: 3, render: () => <InterviewsTile /> },
  { id: "new-applicants", label: "New applicants waiting", span: 3, render: () => <NewApplicantsTile /> },
  { id: "open-roles", label: "Open roles", span: 2, render: () => <OpenRolesTile /> },
  { id: "talent-pool", label: "Talent pool", span: 2, render: () => <TalentPoolTile /> },
  { id: "celebrations", label: "Celebrations", span: 2, render: () => <CelebrationsTile /> },
];

export function RecruiterBento({ layout = null, meActions }: { layout?: TileLayout | null; meActions?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <MeStrip actions={meActions} />
      <BentoView tiles={RECRUITER_TILES} layout={layout} />
    </div>
  );
}
