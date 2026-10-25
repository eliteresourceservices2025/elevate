import { ArrowRight, Award, CalendarDays, Check, Play } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { readableDay } from "@/lib/dates";
import { HomeArt } from "./home-art";

export type HomeStatus = "new" | "progress" | "done" | "expired";

const CHIP: Record<HomeStatus, string> = { new: "Not started", progress: "In progress", done: "Passed", expired: "Expired" };
const ACTION: Record<HomeStatus, string> = { new: "Start", progress: "Continue", done: "Review course", expired: "View" };
/** Why the course was assigned, so two cards with the same title can be told apart. */
const REASON: Record<string, string> = { new_hire: "New-hire course", renewal: "Yearly renewal", update: "Short update", manual: "Assigned by HR" };
const TRACK: Record<string, string> = { full: "Full course", essentials: "Essentials", refresher: "Refresher" };

/** What each built-in course is about, in one line. A client add-on gets a plain line until it has its own. */
const BLURB: Record<string, string> = {
  hipaa: "How to protect patient information in everyday work.",
  cybersecurity: "Everyday habits that keep information and accounts safe.",
  "customer-service": "Calls with families: listening, empathy, clear next steps and a graded practice call.",
};

export { readableDay };

export const homeStatus = (status: string): HomeStatus => (status === "passed" ? "done" : status === "in_progress" ? "progress" : status === "assigned" ? "new" : "expired");

/**
 * One assigned course as a picture card: the course's drawn picture, its status, a line about it, the due date and a clear action. The
 * whole card opens the course. Same look as the module cards, so the app reads as one thing.
 */
export function CourseCard(props: { slug: string; title: string; track: string; status: string; dueOn: string; isUpdate: boolean; reason?: string; href: string }) {
  const status = homeStatus(props.status);
  const Icon = status === "new" ? Play : status === "done" ? Award : ArrowRight;
  const blurb = props.isUpdate ? (status === "done" ? "You are up to date. Your certificate stays valid." : "Some lessons changed. Read only what is new, then answer a few questions. Your certificate stays valid.") : (Object.hasOwn(BLURB, props.slug) ? BLURB[props.slug] : "Training from ELEVATE Learn.");
  return (
    <li className={`mod-card${status === "done" ? " done" : ""}`}>
      <Link href={props.href} className="mod-link">
        <header className="mod-head">
          <span className="mod-num">{props.isUpdate ? "Short update" : (props.reason && Object.hasOwn(REASON, props.reason) ? `${REASON[props.reason]} · ${TRACK[props.track] ?? "Course"}` : (TRACK[props.track] ?? "Course"))}</span>
          <h2 className="mod-title">{props.title}</h2>
        </header>
        <div className="mod-pic">
          <HomeArt name={props.slug} />
          <span className={`mod-chip ${status === "expired" ? "locked" : status}`}>
            {status === "done" ? <Check size={14} aria-hidden="true" /> : null}
            {CHIP[status]}
          </span>
        </div>
        <p className="mod-desc">{blurb}</p>
        <footer className="mod-foot">
          <span className="mod-time">
            <CalendarDays size={15} aria-hidden="true" /> {status === "done" ? "Passed" : `Due ${readableDay(props.dueOn)}`}
          </span>
          <span className="mod-go mod-btn">
            <Icon size={15} aria-hidden="true" /> {ACTION[status]}
          </span>
        </footer>
      </Link>
    </li>
  );
}

/** A shortcut on the home page (practice, record, quick-reference cards) drawn the same way. */
export function HomeTile(props: { art: string; title: string; text: string; action: string; href: string; icon?: ReactNode }) {
  return (
    <li className="mod-card">
      <Link href={props.href} className="mod-link">
        <header className="mod-head">
          <h2 className="mod-title">{props.title}</h2>
        </header>
        <div className="mod-pic">
          <HomeArt name={props.art} />
        </div>
        <p className="mod-desc">{props.text}</p>
        <footer className="mod-foot">
          <span />
          <span className="mod-go mod-btn">
            {props.icon ?? <ArrowRight size={15} aria-hidden="true" />} {props.action}
          </span>
        </footer>
      </Link>
    </li>
  );
}
