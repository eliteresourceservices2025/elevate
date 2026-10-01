"use client";

/* eslint-disable security/detect-object-injection -- keys are typed stage names */
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
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

// One arrow key press jumps one column (a column is 16rem wide plus a 0.75rem gap); up and down do nothing.
const COLUMN_STEP = 268;
const keyboardColumns: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  if (event.code === "ArrowRight") return { ...currentCoordinates, x: currentCoordinates.x + COLUMN_STEP };
  if (event.code === "ArrowLeft") return { ...currentCoordinates, x: currentCoordinates.x - COLUMN_STEP };
  return undefined;
};

type Move = (applicationId: string, from: Stage, to: Stage) => void;

function CardBody({ card, stage, canMoveCards, pending, move, handle }: { card: BoardCard; stage: Stage; canMoveCards: boolean; pending: boolean; move?: Move; handle?: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg border bg-card p-2.5 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <Link href={`/recruiting/applications/${card.applicationId}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {card.name}
        </Link>
        {handle}
      </div>
      <p className="text-xs text-muted-foreground">Applied {formatInZone(card.appliedAt, undefined, "MMM d")}</p>
      {card.nextInterview ? <p className="text-xs">Interview {formatInZone(card.nextInterview, undefined, "MMM d, h:mm a")}</p> : null}
      {card.scorecards > 0 ? <p className="text-xs text-muted-foreground">{card.scorecards} {card.scorecards === 1 ? "scorecard" : "scorecards"}</p> : null}
      {canMoveCards && move ? (
        <div>
          <label className="sr-only" htmlFor={`mv-${card.applicationId}`}>
            Move {card.name} to
          </label>
          <NativeSelect id={`mv-${card.applicationId}`} className="h-7 text-xs" disabled={pending} value="" onChange={(e) => e.target.value && move(card.applicationId, stage, e.target.value as Stage)}>
            <option value="">Move to...</option>
            {BOARD_STAGES.filter((s) => s !== stage).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
}

function DraggableCard({ card, stage, canMoveCards, pending, move }: { card: BoardCard; stage: Stage; canMoveCards: boolean; pending: boolean; move: Move }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.applicationId, data: { from: stage }, disabled: !canMoveCards || pending });
  const handle = canMoveCards ? (
    <button type="button" aria-label={`Drag ${card.name} to another stage. Press space, then the arrow keys, then space again.`} className="-mr-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing" {...attributes} {...listeners}>
      <GripVertical className="size-4" aria-hidden />
    </button>
  ) : null;
  return (
    <li ref={setNodeRef} className={isDragging ? "opacity-40" : undefined}>
      <CardBody card={card} stage={stage} canMoveCards={canMoveCards} pending={pending} move={move} handle={handle} />
    </li>
  );
}

function Column({ stage, cards, canMoveCards, pending, move }: { stage: Stage; cards: BoardCard[]; canMoveCards: boolean; pending: boolean; move: Move }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const [limit, setLimit] = useState(CARD_LIMIT);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STAGE_LABELS[stage]}, ${cards.length} ${cards.length === 1 ? "person" : "people"}`}
      data-stage={stage}
      className={`w-64 shrink-0 space-y-2 rounded-xl border bg-muted/30 p-2 ${isOver ? "ring-2 ring-primary" : ""}`}
    >
      <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
        {STAGE_LABELS[stage]}
        <Badge variant="secondary">{cards.length}</Badge>
      </h2>
      {cards.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">Nobody here.</p> : null}
      <ul className="space-y-2">
        {cards.slice(0, limit).map((c) => (
          <DraggableCard key={c.applicationId} card={c} stage={stage} canMoveCards={canMoveCards} pending={pending} move={move} />
        ))}
      </ul>
      {cards.length > limit ? (
        <button type="button" className="w-full rounded-md border px-2 py-1 text-xs hover:bg-secondary/50" onClick={() => setLimit(limit + CARD_LIMIT)}>
          Show {Math.min(CARD_LIMIT, cards.length - limit)} more ({cards.length - limit} left)
        </button>
      ) : null}
    </section>
  );
}

/**
 * The pipeline. Drag a card by its grip with a mouse, a finger or the keyboard (space, arrow keys, space), or use the "Move to"
 * menu on the card. Rejecting is done on the person's page because it needs a reason.
 */
export function PipelineBoard({ columns, canMoveCards, rejected }: { columns: Record<Stage, BoardCard[]>; canMoveCards: boolean; rejected: BoardCard[] }) {
  const { run, pending } = useRun();
  const [active, setActive] = useState<{ card: BoardCard; stage: Stage } | null>(null);
  // A small movement before a drag starts keeps clicks on links and menus working; touch needs a short press so scrolling still works.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardColumns }));

  const move: Move = (applicationId, from, to) => {
    const rule = canMove(from, to);
    if (!rule.ok) return run(async () => ({ ok: false, error: rule.reason }), "");
    run(() => moveApplication({ applicationId, to }), `Moved to ${STAGE_LABELS[to]}.`);
  };

  const onDragStart = (e: DragStartEvent) => {
    const from = e.active.data.current?.from as Stage | undefined;
    const card = from ? columns[from].find((c) => c.applicationId === e.active.id) : undefined;
    if (from && card) setActive({ card, stage: from });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const from = e.active.data.current?.from as Stage | undefined;
    const to = e.over?.id as Stage | undefined;
    setActive(null);
    if (from && to && from !== to && (BOARD_STAGES as readonly Stage[]).includes(to)) move(String(e.active.id), from, to);
  };

  return (
    <div className="space-y-6">
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="flex gap-3 overflow-x-auto pb-2" role="group" aria-label="Pipeline">
          {BOARD_STAGES.map((stage) => (
            <Column key={stage} stage={stage} cards={columns[stage]} canMoveCards={canMoveCards} pending={pending} move={move} />
          ))}
        </div>
        <DragOverlay>{active ? <CardBody card={active.card} stage={active.stage} canMoveCards={false} pending={false} /> : null}</DragOverlay>
      </DndContext>

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
