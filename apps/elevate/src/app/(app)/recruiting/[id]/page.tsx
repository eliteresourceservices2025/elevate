import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { OpeningStatusButtons } from "@/modules/recruiting/components/opening-forms";
import { PipelineBoard } from "@/modules/recruiting/components/pipeline-board";
import type { OpeningStatus } from "@/modules/recruiting/constants";
import { getOpeningBoard } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Job pipeline" };

export default async function OpeningPage({ params }: PageProps<"/recruiting/[id]">) {
  await requireUser();
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
            <Link href={`/recruiting/${opening.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Edit job
            </Link>
          </div>
        ) : null}
      </div>
      <PipelineBoard columns={board.columns} canMoveCards={board.canMove} rejected={board.columns.rejected} />
    </div>
  );
}
