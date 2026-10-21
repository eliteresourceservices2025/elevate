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
import type { OpeningStatus } from "@/modules/recruiting/constants";
import { getOpeningBoard } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Job pipeline" };

export default async function OpeningPage({ params }: PageProps<"/recruiting/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const board = await orNotFound(getOpeningBoard(id));
  const { opening } = board;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/recruiting" className="text-sm text-primary underline-offset-4 hover:underline">
            ← Recruiting
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{opening.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={opening.status === "open" ? "default" : "secondary"}>{opening.status === "open" ? "Open" : opening.status === "closed" ? "Closed" : "Draft"}</Badge>
            {opening.teamName ? <span>{opening.teamName}</span> : null}
            {board.hiringTeam.length ? <span>Hiring team: {board.hiringTeam.map((p) => p.name).join(", ")}</span> : null}
          </p>
        </div>
        {board.canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <OpeningStatusButtons id={opening.id} status={opening.status as OpeningStatus} />
            {opening.status === "open" ? (
              <a href={`/careers/${opening.slug ?? opening.id}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                View job ad <ExternalLink aria-hidden /> <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
            <Link href={`/recruiting/${opening.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Edit job
            </Link>
            {scopeFor(user, "recruiting.delete_opening") ? <DeleteOpeningButton id={opening.id} applications={Object.values(board.columns).reduce((n, c) => n + c.length, 0)} /> : null}
          </div>
        ) : null}
      </div>
      <PipelineBoard columns={board.columns} canMoveCards={board.canMove} rejected={board.columns.rejected} />
    </div>
  );
}
