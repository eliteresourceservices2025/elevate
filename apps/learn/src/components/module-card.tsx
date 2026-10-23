import { ArrowRight, Check, Clock, Lock } from "lucide-react";
import Link from "next/link";
import { ModuleArt } from "./module-art";

export type ModuleStatus = "done" | "progress" | "new" | "locked";

const CHIP: Record<ModuleStatus, string> = { done: "Done", progress: "In progress", new: "Not started", locked: "Locked" };
const ACTION: Record<ModuleStatus, string> = { done: "Review", progress: "Continue", new: "Start", locked: "" };

/**
 * One module as a picture card: its number and title, a drawn picture, a short description and how long it takes. The whole card opens
 * the module. A locked card is not a link: it says why, for screen readers too. A finished course shows the cards without a link.
 */
export function ModuleCard(props: { index: number; title: string; summary: string; minutes: number; status: ModuleStatus; href: string | null; course: string; moduleKey: string }) {
  const { index, title, summary, minutes, status, href, course, moduleKey } = props;
  const inner = (
    <>
      <header className="mod-head">
        <span className="mod-num">Module {index}</span>
        <h2 className="mod-title">{title}</h2>
      </header>
      <div className="mod-pic">
        <ModuleArt course={course} moduleKey={moduleKey} />
        <span className={`mod-chip ${status}`}>
          {status === "done" ? <Check size={14} aria-hidden="true" /> : status === "locked" ? <Lock size={13} aria-hidden="true" /> : null}
          {CHIP[status]}
        </span>
      </div>
      <p className="mod-desc">{summary}</p>
      <footer className="mod-foot">
        <span className="mod-time">
          <Clock size={15} aria-hidden="true" /> About {minutes} min
        </span>
        {href && ACTION[status] ? (
          <span className="mod-go">
            {ACTION[status]} <ArrowRight size={15} aria-hidden="true" />
          </span>
        ) : null}
      </footer>
    </>
  );
  if (status === "locked") {
    return (
      <li className="mod-card locked" aria-disabled="true">
        {inner}
        <p className="sr-only">Finish the earlier modules to open this one.</p>
      </li>
    );
  }
  return (
    <li className={`mod-card${status === "done" ? " done" : ""}`}>
      {href ? (
        <Link href={href} className="mod-link">
          {inner}
        </Link>
      ) : (
        <div className="mod-link static">{inner}</div>
      )}
    </li>
  );
}
