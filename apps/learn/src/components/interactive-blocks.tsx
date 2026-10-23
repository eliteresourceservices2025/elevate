"use client";

import { useEffect, useRef, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { motion } from "motion/react";
import type { Block } from "@/content/schema";
import { useBlockGate } from "./block-gate";
import { Inline } from "./inline";
import { celebrate } from "@/lib/celebrate";
import { Workstation } from "./workstation";

// The interactive lesson blocks. Everything here is practice: nothing is graded, nothing is sent to the server and nothing is kept
// in browser storage (a streak lasts until the page is closed). Motion is CSS only and switched off by "reduce motion".

type Of<T extends Block["type"]> = Extract<Block, { type: T }>;

/** A fixed shuffle (same on the server and in the browser) that never returns the original order. */
export function shuffledIndexes(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = (seed * 2654435761) >>> 0 || 1;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.every((v, i) => v === i)) order.push(order.shift() as number);
  return order;
}

const seedOf = (text: string) => Array.from(text).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function Meter({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const tone = v >= 66 ? "calm" : v >= 34 ? "uneasy" : "upset";
  return (
    <div className={`meter ${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <motion.div className="meter-fill" initial={false} animate={{ width: `${v}%` }} transition={{ type: "spring", stiffness: 140, damping: 20 }} />
      <span className="meter-text">
        {label}: {tone === "calm" ? "calm" : tone === "uneasy" ? "uneasy" : "upset"}
      </span>
    </div>
  );
}

// ---- Sort it -------------------------------------------------------------------------------------------------------------------

function SortRow({ id, label, pos, last, state, onMove }: { id: string; label: string; pos: number; last: boolean; state: "" | "good" | "bad"; onMove: (from: number, to: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`${isDragging ? "dragging" : ""}${state ? ` ${state}` : ""}`}>
      <span className="grip" data-dnd-handle {...attributes} {...listeners} aria-label={`Drag to reorder: ${label}`}>
        <GripVertical size={18} aria-hidden="true" />
      </span>
      <span className="sortlabel">{label}</span>
      <span className="sortbtns">
        <button type="button" className="secondary" aria-label={`Move up: ${label}`} disabled={pos === 0} onClick={() => onMove(pos, pos - 1)}>
          Up
        </button>
        <button type="button" className="secondary" aria-label={`Move down: ${label}`} disabled={last} onClick={() => onMove(pos, pos + 1)}>
          Down
        </button>
      </span>
    </li>
  );
}

export function SortBlock({ block }: { block: Of<"sort"> }) {
  const [order, setOrder] = useState(() => shuffledIndexes(block.items.length, seedOf(block.title)));
  const [checked, setChecked] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    setChecked(false);
    setOrder((o) => arrayMove(o, from, to));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(Number(e.active.id)), order.indexOf(Number(e.over.id)));
  };
  const right = order.every((v, i) => v === i);
  useBlockGate(checked);
  useEffect(() => {
    if (checked && right) void celebrate();
  }, [checked, right]);
  return (
    <section className="block sortblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.prompt} />
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map(String)} strategy={verticalListSortingStrategy}>
          <ol className="sortlist">
            {order.map((itemIndex, pos) => (
              <SortRow key={itemIndex} id={String(itemIndex)} label={block.items[itemIndex]} pos={pos} last={pos === order.length - 1} state={checked ? (itemIndex === pos ? "good" : "bad") : ""} onMove={move} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <button type="button" onClick={() => setChecked(true)}>
        Check the order
      </button>
      <div role="status" aria-live="polite">
        {checked ? (
          <p className={`feedback ${right ? "good" : "bad"}`}>
            <strong>{right ? "That is the right order. " : "Not quite: the shaded steps are in the right place. "}</strong>
            <Inline text={block.explanation} />
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---- Cards (sort each card into a group) --------------------------------------------------------------------------------------

export function CardsBlock({ block }: { block: Of<"cards"> }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const done = index >= block.cards.length;
  useBlockGate(done);
  useEffect(() => {
    if (done && score === block.cards.length) void celebrate();
  }, [done, score, block.cards.length]);
  const card = block.cards[Math.min(index, block.cards.length - 1)];
  const choose = (g: number) => {
    if (answer !== null) return;
    setAnswer(g);
    if (g === card.group) {
      setScore((s) => s + 1);
      setStreak((s) => {
        setBest((b) => Math.max(b, s + 1));
        return s + 1;
      });
    } else setStreak(0);
  };
  const reset = () => {
    setIndex(0);
    setAnswer(null);
    setScore(0);
    setStreak(0);
  };
  return (
    <section className="block cardsblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.prompt} />
      </p>
      {done ? (
        <div role="status" aria-live="polite" className="gameend">
          <p>
            <strong>
              Round complete: {score} of {block.cards.length} correct.
            </strong>{" "}
            Best streak this time: {best}.
          </p>
          <button type="button" onClick={reset}>
            Play again
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            Card {index + 1} of {block.cards.length} · streak {streak}
          </p>
          <div key={index} className="playcard">
            <Inline text={card.text} />
          </div>
          <div role="group" aria-label="Choose a group" className="groupbtns">
            {block.groups.map((g, i) => (
              <button key={i} type="button" className={`choice${answer === i ? (i === card.group ? " good" : " bad") : ""}`} aria-pressed={answer === i} onClick={() => choose(i)}>
                {g}
              </button>
            ))}
          </div>
          <div role="status" aria-live="polite">
            {answer !== null ? (
              <>
                <p className={`feedback ${answer === card.group ? "good" : "bad"}`}>
                  <strong>{answer === card.group ? "Yes. " : `Not quite: it belongs under "${block.groups[card.group]}". `}</strong>
                  <Inline text={card.feedback} />
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIndex((i) => i + 1);
                    setAnswer(null);
                  }}
                >
                  {index + 1 >= block.cards.length ? "See result" : "Next card"}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

// ---- Spot the mistake ---------------------------------------------------------------------------------------------------------

export function SpotBlock({ block }: { block: Of<"spot"> }) {
  const [picked, setPicked] = useState<number[]>([]);
  const wrongCount = block.lines.filter((l) => l.wrong).length;
  const found = picked.filter((i) => block.lines[i].wrong).length;
  const finished = found === wrongCount;
  useBlockGate(finished);
  return (
    <section className="block spotblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.prompt} />
      </p>
      <ul className="transcript">
        {block.lines.map((l, i) => {
          const isPicked = picked.includes(i);
          return (
            <li key={i}>
              <button
                type="button"
                className={`line${isPicked ? (l.wrong ? " good" : " bad") : ""}`}
                aria-pressed={isPicked}
                disabled={finished && !isPicked}
                onClick={() => setPicked((p) => (p.includes(i) ? p : [...p, i]))}
              >
                <strong>{l.speaker}: </strong>
                {l.text}
              </button>
            </li>
          );
        })}
      </ul>
      <div role="status" aria-live="polite">
        {picked.some((i) => !block.lines[i].wrong) && !finished ? <p className="feedback bad">That line is fine. Keep looking.</p> : null}
        {finished ? (
          <p className="feedback good">
            <strong>Found it. </strong>
            <Inline text={block.explanation} />
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---- Tap the problems ----------------------------------------------------------------------------------------------------------

export function HotspotBlock({ block }: { block: Of<"hotspot"> }) {
  const [marked, setMarked] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const problems = block.items.filter((i) => i.problem).length;
  const found = marked.filter((i) => block.items[i].problem).length;
  const falseAlarms = marked.length - found;
  const perfect = checked && found === problems && falseAlarms === 0;
  useBlockGate(checked);
  const toggle = (i: number) => setMarked((m) => (m.includes(i) ? m.filter((x) => x !== i) : [...m, i]));
  const check = () => {
    setChecked(true);
    if (found === problems && falseAlarms === 0) void celebrate();
  };
  const reset = () => {
    setMarked([]);
    setChecked(false);
  };
  return (
    <section className="block spotblock hotspotblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.prompt} />
      </p>
      <ul className="transcript">
        {block.items.map((it, i) => {
          const isMarked = marked.includes(i);
          const state = checked ? (it.problem ? (isMarked ? " good" : " missed") : isMarked ? " bad" : "") : isMarked ? " picked" : "";
          return (
            <li key={i}>
              <button type="button" className={`line${state}`} aria-pressed={isMarked} disabled={checked} onClick={() => toggle(i)}>
                <strong>{it.label}: </strong>
                {it.text}
                {checked ? <em className="small muted">{it.problem ? (isMarked ? " (a problem: you found it)" : " (a problem: you missed it)") : isMarked ? " (not a problem: marked by mistake)" : ""}</em> : null}
              </button>
              {checked && it.problem ? (
                <p className="small muted">
                  <Inline text={it.why ?? ""} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="small muted">
        Marked {marked.length}. {problems} problem{problems === 1 ? "" : "s"} to find.
      </p>
      <div role="status" aria-live="polite">
        {checked ? (
          <p className={`feedback ${perfect ? "good" : "bad"}`}>
            <strong>{perfect ? "All of them, and nothing extra. " : `You found ${found} of ${problems}${falseAlarms ? ` and marked ${falseAlarms} that ${falseAlarms === 1 ? "was" : "were"} fine` : ""}. `}</strong>
            <Inline text={block.explanation} />
          </p>
        ) : null}
      </div>
      {checked ? (
        <button type="button" className="secondary" onClick={reset}>
          Try again
        </button>
      ) : (
        <button type="button" onClick={check} disabled={marked.length === 0}>
          Check my marks
        </button>
      )}
    </section>
  );
}

// ---- Flip cards ---------------------------------------------------------------------------------------------------------------

export function FlipBlock({ block }: { block: Of<"flip"> }) {
  const [open, setOpen] = useState<number[]>([]);
  return (
    <section className="block flipblock" aria-label={block.title ?? "Flip cards"}>
      {block.title ? <h3>{block.title}</h3> : null}
      <div className="flipgrid">
        {block.cards.map((c, i) => {
          const isOpen = open.includes(i);
          return (
            <button key={i} type="button" className={`flipcard${isOpen ? " open" : ""}`} aria-pressed={isOpen} onClick={() => setOpen((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]))}>
              <strong>{c.front}</strong>
              {isOpen ? (
                <span className="flipback">
                  <Inline text={c.back} />
                </span>
              ) : (
                <span className="muted">Tap to turn over</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---- Build it (pick the right piece for each slot) ----------------------------------------------------------------------------

export function BuildBlock({ block }: { block: Of<"build"> }) {
  const [picks, setPicks] = useState<(number | null)[]>(() => block.slots.map(() => null));
  const complete = picks.every((p, i) => p !== null && block.slots[i].options[p].correct);
  useBlockGate(picks.every((p) => p !== null));
  return (
    <section className="block buildblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.prompt} />
      </p>
      <Workstation kind="note" title={block.title}>
      {block.slots.map((slot, s) => (
        <fieldset key={s} className="slot">
          <legend>{slot.label}</legend>
          <div className="choices">
            {slot.options.map((o, i) => (
              <button
                key={i}
                type="button"
                className={`choice${picks[s] === i ? (o.correct ? " good" : " bad") : ""}`}
                aria-pressed={picks[s] === i}
                onClick={() => setPicks((p) => p.map((v, j) => (j === s ? i : v)))}
              >
                {o.text}
              </button>
            ))}
          </div>
          <div role="status" aria-live="polite">
            {picks[s] !== null ? (
              <p className={`feedback ${slot.options[picks[s] as number].correct ? "good" : "bad"}`}>
                <Inline text={slot.options[picks[s] as number].feedback} />
              </p>
            ) : null}
          </div>
        </fieldset>
      ))}
      <div role="status" aria-live="polite">
        {complete ? (
          <div className="feedback good">
            <strong>Complete. </strong>
            {block.slots.map((slot, s) => slot.options[picks[s] as number].text).join(" · ")}
          </div>
        ) : null}
      </div>
      </Workstation>
    </section>
  );
}

// ---- Call with a mood meter ---------------------------------------------------------------------------------------------------

export function BranchBlock({ block }: { block: Of<"branch"> }) {
  const [turn, setTurn] = useState(0);
  const [mood, setMood] = useState(block.startMood ?? 40);
  const [picked, setPicked] = useState<number | null>(null);
  const done = turn >= block.turns.length;
  useBlockGate(done);
  useEffect(() => {
    if (done && mood >= 66) void celebrate();
  }, [done, mood]);
  const current = block.turns[Math.min(turn, block.turns.length - 1)];
  const choose = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    setMood((m) => Math.max(0, Math.min(100, m + current.choices[i].mood)));
  };
  const reset = () => {
    setTurn(0);
    setMood(block.startMood ?? 40);
    setPicked(null);
  };
  return (
    <section className="block branchblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.intro} />
      </p>
      <Workstation kind="phone" title={block.title} record={block.record}>
      <Meter label="Caller mood" value={mood} />
      {done ? (
        <div role="status" aria-live="polite" className="gameend">
          <p>
            <strong>{mood >= 66 ? "The call ended well. The caller feels heard." : mood >= 34 ? "The call ended, but the caller is still unsure." : "The caller is still upset. Try different words."}</strong>
          </p>
          <button type="button" onClick={reset}>
            Try the call again
          </button>
        </div>
      ) : (
        <>
          <blockquote key={turn} className="caller">
            <Inline text={current.caller} />
          </blockquote>
          <div role="group" aria-label="Your reply" className="choices">
            {current.choices.map((c, i) => (
              <button key={i} type="button" className={`choice${picked === i ? (c.mood > 0 ? " good" : " bad") : ""}`} aria-pressed={picked === i} onClick={() => choose(i)}>
                {c.text}
              </button>
            ))}
          </div>
          <div role="status" aria-live="polite">
            {picked !== null ? (
              <>
                <blockquote className="caller reply">
                  <Inline text={current.choices[picked].reply} />
                </blockquote>
                <button
                  type="button"
                  onClick={() => {
                    setTurn((t) => t + 1);
                    setPicked(null);
                  }}
                >
                  {turn + 1 >= block.turns.length ? "End the call" : "Continue"}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
      </Workstation>
    </section>
  );
}

// ---- Quiz game (rounds, streak, optional seconds) -----------------------------------------------------------------------------

export function GameBlock({ block }: { block: Of<"game"> }) {
  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<number | "time" | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [left, setLeft] = useState(block.seconds ?? 0);
  // a timed game waits for a Start press, so the clock does not run while the learner is still reading above it
  const [started, setStarted] = useState(!block.seconds);
  const answered = useRef(false);
  const done = round >= block.rounds.length;
  useBlockGate(done);
  useEffect(() => {
    if (done && score === block.rounds.length) void celebrate();
  }, [done, score, block.rounds.length]);
  const current = block.rounds[Math.min(round, block.rounds.length - 1)];

  const settle = (choice: number | "time") => {
    if (answered.current) return;
    answered.current = true;
    setPicked(choice);
    const ok = choice !== "time" && current.options[choice].correct;
    if (ok) {
      setScore((s) => s + 1);
      setStreak((s) => {
        setBest((b) => Math.max(b, s + 1));
        return s + 1;
      });
    } else setStreak(0);
  };

  useEffect(() => {
    if (!block.seconds || !started || done || picked !== null) return;
    const t = setTimeout(() => (left <= 0 ? settle("time") : setLeft((l) => l - 1)), left <= 0 ? 0 : 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, started, done, picked, block.seconds]);

  const next = () => {
    answered.current = false;
    setPicked(null);
    setRound((r) => r + 1);
    setLeft(block.seconds ?? 0);
  };
  const reset = () => {
    answered.current = false;
    setRound(0);
    setPicked(null);
    setScore(0);
    setStreak(0);
    setLeft(block.seconds ?? 0);
    setStarted(!block.seconds);
  };
  const okPick = typeof picked === "number" && current.options[picked].correct;
  return (
    <section className="block gameblock" aria-label={block.title}>
      <h3>{block.title}</h3>
      {done ? (
        <div role="status" aria-live="polite" className="gameend">
          <p>
            <strong>
              Finished: {score} of {block.rounds.length} right.
            </strong>{" "}
            Best streak: {best}.
          </p>
          <button type="button" onClick={reset}>
            Play again
          </button>
        </div>
      ) : !started ? (
        <div>
          <p>
            {block.rounds.length} rounds, {block.seconds} seconds each. The clock starts when you press Start.
          </p>
          <button type="button" onClick={() => setStarted(true)}>
            Start
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            Round {round + 1} of {block.rounds.length} · streak {streak}
            {block.seconds ? (
              <span className={`timer${left <= 5 ? " low" : ""}`}> · {left}s</span>
            ) : null}
          </p>
          <p key={round} className="playcard">
            <Inline text={current.question} />
          </p>
          <div role="group" aria-label="Choose one" className="choices">
            {current.options.map((o, i) => (
              <button key={i} type="button" className={`choice${picked === i ? (o.correct ? " good" : " bad") : ""}`} aria-pressed={picked === i} disabled={picked !== null} onClick={() => settle(i)}>
                {o.text}
              </button>
            ))}
          </div>
          <div role="status" aria-live="polite">
            {picked !== null ? (
              <>
                <p className={`feedback ${okPick ? "good" : "bad"}`}>
                  <strong>{picked === "time" ? "Time is up. " : okPick ? "Right. " : "Not quite. "}</strong>
                  <Inline text={picked === "time" ? (current.options.find((o) => o.correct)?.feedback ?? "") : current.options[picked].feedback} />
                </p>
                <button type="button" onClick={next}>
                  {round + 1 >= block.rounds.length ? "See result" : "Next round"}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

