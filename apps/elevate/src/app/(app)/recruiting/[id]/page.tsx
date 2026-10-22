import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DeleteOpeningButton, OpeningStatusButtons } from "@/modules/recruiting/components/opening-forms";
import { PipelineBoard } from "@/modules/recruiting/components/pipeline-board";
import { RescoreButton } from "@/modules/recruiting/components/rescore-button";
import type { OpeningStatus } from "@/modules/recruiting/constants";
import { getOpeningBoard } from "@/modules/recruiting/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Job pipeline" };

export default async function OpeningPage({ params }: PageProps<"/recruiting/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const board = await orNotFound(getOpeningBoard(id));
  const { opening } = board;
  return (
    <PageContainer>
      <PageHeader
        title={opening.title}
        breadcrumbs={[{ label: "Recruiting", href: "/recruiting" }, { label: opening.title }]}
        description={
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant={opening.status === "open" ? "default" : "secondary"}>{opening.status === "open" ? "Open" : opening.status === "closed" ? "Closed" : "Draft"}</Badge>
            {opening.teamName ? <span>{opening.teamName}</span> : null}
            {board.hiringTeam.length ? <span>Hiring team: {board.hiringTeam.map((p) => p.name).join(", ")}</span> : null}
          </p>
        }
        actions={
          board.canManage ? (
            <>
              <OpeningStatusButtons id={opening.id} status={opening.status as OpeningStatus} />
              {opening.status === "open" ? (
                <a href={`/careers/${opening.slug ?? opening.id}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  View job ad <ExternalLink aria-hidden /> <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : null}
              {opening.keywordsRequired.length + opening.keywordsNice.length > 0 ? <RescoreButton openingId={opening.id} /> : null}
              <Link href={`/recruiting/${opening.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Edit job
              </Link>
              {scopeFor(user, "recruiting.delete_opening") ? <DeleteOpeningButton id={opening.id} applications={Object.values(board.columns).reduce((n, c) => n + c.length, 0)} /> : null}
            </>
          ) : null
        }
      />
      <PipelineBoard columns={board.columns} canMoveCards={board.canMove} rejected={board.columns.rejected} />
    </PageContainer>
  );
}
