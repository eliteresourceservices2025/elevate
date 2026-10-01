"use client";

/* eslint-disable security/detect-object-injection -- keys are typed stage names */

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { formatInZone } from "@/lib/time";
import { BOARD_STAGES, STAGE_LABELS, canMove, type Stage } from "../constants";
import { moveApplication } from "../actions";
import type { BoardCard } from "../queries";
import { useRun } from "./use-run";

const CARD_LIMIT = 25; // cards shown per column before "Show more" (a column can hold hundreds of applicants)

/**
 * The pipeline. People can drag a card to another column or use the "Move to" menu on the card (keyboard and screen reader
 * friendly). Rejecting is done on the person's page because it needs a reason.
 */
export function PipelineBoard({ columns, canMoveCards, rejected }: { columns: Record<Stage, BoardCard[]>; canMoveCards: boolean; rejected: BoardCard[] }) {
  const { run, pending } = useRun();
  const [dragging, setDragging] = useState<{ id: string; from: Stage } | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});

  const move = (applicationId: string, from: Stage, to: Stage) => {
    const rule = canMove(from, to);
    if (!rule.ok) return run(async () => ({ ok: false, error: rule.reason }), "");
    run(() => moveApplication({ applicationId, to }), `Moved to ${STAGE_LABELS[to]}.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3 overflow-x-auto pb-2" role="group" aria-label="Pipeline">
        {BOARD_STAGES.map((stage) => {
          const cards = columns[stage];
          const limit = shown[stage] ?? CARD_LIMIT;
          return (
            <section
              key={stage}
              aria-label={`${STAGE_LABELS[stage]}, ${cards.length} ${cards.length === 1 ? "person" : "people"}`}
              data-stage={stage}
              onDragOver={(e) => {
                if (canMoveCards && dragging) {
                  e.preventDefault();
                  setOver(stage);
                }
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragging && dragging.from !== stage) move(dragging.id, dragging.from, stage);
                setDragging(null);
              }}
              className={`w-64 shrink-0 space-y-2 rounded-xl border bg-muted/30 p-2 ${over === stage ? "ring-2 ring-primary" : ""}`}
            >
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                {STAGE_LABELS[stage]}
                <Badge variant="secondary">{cards.length}</Badge>
              </h2>
              {cards.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">Nobody here.</p> : null}
              <ul className="space-y-2">
                {cards.slice(0, limit).map((c) => (
                  <li
                    key={c.applicationId}
                    draggable={canMoveCards && !pending}
                    onDragStart={() => setDragging({ id: c.applicationId, from: stage })}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className="space-y-1 rounded-lg border bg-card p-2.5 text-sm shadow-sm"
                  >
                    <Link href={`/recruiting/applications/${c.applicationId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">Applied {formatInZone(c.appliedAt, undefined, "MMM d")}</p>
                    {c.nextInterview ? <p className="text-xs">Interview {formatInZone(c.nextInterview, undefined, "MMM d, h:mm a")}</p> : null}
                    {c.scorecards > 0 ? <p className="text-xs text-muted-foreground">{c.scorecards} {c.scorecards === 1 ? "scorecard" : "scorecards"}</p> : null}
                    {canMoveCards ? (
                      <div>
                        <label className="sr-only" htmlFor={`mv-${c.applicationId}`}>
                          Move {c.name} to
                        </label>
                        <NativeSelect id={`mv-${c.applicationId}`} className="h-7 text-xs" disabled={pending} value="" onChange={(e) => e.target.value && move(c.applicationId, stage, e.target.value as Stage)}>
                          <option value="">Move to...</option>
                          {BOARD_STAGES.filter((s) => s !== stage).map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABELS[s]}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {cards.length > limit ? (
                <button type="button" className="w-full rounded-md border px-2 py-1 text-xs hover:bg-secondary/50" onClick={() => setShown((s) => ({ ...s, [stage]: limit + CARD_LIMIT }))}>
                  Show {Math.min(CARD_LIMIT, cards.length - limit)} more ({cards.length - limit} left)
                </button>
              ) : null}
            </section>
          );
        })}
      </div>

      {rejected.length > 0 ? (
        <details className="rounded-xl border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">Rejected or withdrawn ({rejected.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {rejected.slice(0, 100).map((c) => (
              <li key={c.applicationId}>
                <Link href={`/recruiting/applications/${c.applicationId}`} className="text-primary underline-offset-4 hover:underline">
                  {c.name}
                </Link>{" "}
                <span className="text-xs text-muted-foreground">applied {formatInZone(c.appliedAt, undefined, "MMM d, yyyy")}</span>
              </li>
            ))}
          </ul>
          {rejected.length > 100 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first 100.</p> : null}
        </details>
      ) : null}
    </div>
  );
}
