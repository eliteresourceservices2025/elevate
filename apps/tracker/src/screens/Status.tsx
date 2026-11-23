import { useEffect, useMemo, useState } from "react";
import { clockIn, clockOut, clockText, endBreak, hoursMinutes, startBreak, switchClient, timeOf, workChoices, type Choice, type Notice, type StatusView } from "../api";
import { CoffeeIcon, PlayIcon, SearchIcon, StopIcon, SwitchIcon } from "../icons";

const BLOCKED: Record<string, string> = {
  jibble: "You clock in Jibble. ELEVATE reads your hours from there, so the clock here is off.",
  selfie: "Your team needs a selfie to clock in. Clock in on the ELEVATE page.",
};
const BREAKS: { label: string; minutes: number | undefined }[] = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "No limit", minutes: undefined },
];
/** With more choices than this, a search box appears above the list. */
const SEARCH_FROM = 6;

const keyOf = (c: { clientId: string; projectId?: string | null }) => `${c.clientId}:${c.projectId ?? ""}`;

/** A clock that ticks once a second while the window is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** What the clock says about the break: how long is left, or how long it has lasted. */
function breakText(s: StatusView, now: number): string {
  if (!s.onBreak) return "On a break";
  const elapsed = Math.max(0, now - Date.parse(s.onBreak.startedAt));
  if (s.onBreak.plannedMinutes === null) return `On a break · ${clockText(elapsed)}`;
  const left = s.onBreak.plannedMinutes * 60_000 - elapsed;
  return left >= 0 ? `On a break · ${clockText(left)} left` : `Break is up · ${clockText(-left)} over`;
}

/**
 * The clock: a big round button, today's total, who the time is for, and your clients and projects with the time worked on each today.
 * Every button is one click that sends one request; ELEVATE answers, and its own words are shown.
 */
export function Status({ status, notice, onNotice, onChanged }: { status: StatusView; notice: Notice | null; onNotice: (n: Notice | null) => void; onChanged: () => void }) {
  const now = useNow();
  const choices = useMemo(() => workChoices(status.clients), [status.clients]);
  const currentKey = status.current ? keyOf({ clientId: status.current.clientId ?? "", projectId: status.current.projectId }) : "";
  const [picked, setPicked] = useState<string>(choices[0] ? keyOf(choices[0]) : "");
  const [query, setQuery] = useState("");
  const [breakOpen, setBreakOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!choices.some((c) => keyOf(c) === picked)) setPicked(choices[0] ? keyOf(choices[0]) : "");
  }, [choices, picked]);

  const working = status.state === "working";
  const onBreak = status.state === "break";
  const out = !working && !onBreak;
  const blocked = status.clockBlockedReason ? (BLOCKED[status.clockBlockedReason] ?? "The clock is off for you right now. Use the ELEVATE page.") : null;
  const disabled = busy || Boolean(blocked) || !status.online;
  const chosen = choices.find((c) => keyOf(c) === picked);

  // Today: the total ELEVATE counted, plus the time since it arrived while working (this computer's own clock, so a wrong date cannot skew it).
  const since = status.todayReceivedMs === null ? 0 : Math.max(0, now - status.todayReceivedMs);
  const live = working ? since : 0;
  const total = (status.today?.totalMs ?? 0) + live;
  const lineMs = (c: { clientId: string; projectId?: string | null }) => {
    const base = status.today?.byWork.find((l) => l.clientId === c.clientId && (l.projectId ?? null) === (c.projectId ?? null))?.ms ?? 0;
    return base + (working && keyOf(c) === currentKey ? live : 0);
  };
  const clientMs = (clientId: string) => (status.today?.byWork.filter((l) => l.clientId === clientId).reduce((n, l) => n + l.ms, 0) ?? 0) + (working && status.current?.clientId === clientId ? live : 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? choices.filter((c) => c.label.toLowerCase().includes(q)) : choices;
  }, [choices, query]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setBreakOpen(false);
    onNotice(null);
    try {
      onNotice({ ok: true, message: await action() });
    } catch (err) {
      onNotice({ ok: false, message: typeof err === "string" ? err : "That did not work. Try again." });
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const pickLabel = (c: Choice | undefined) => (c ? (c.grouped ? `${c.clientName} · ${c.title}` : c.title) : "");

  // The big button: clock in (play), end the break (play) or clock out (stop).
  const bigAction = out ? () => run(() => clockIn(chosen?.clientId, chosen?.projectId)) : onBreak ? () => run(endBreak) : () => run(clockOut);
  const bigLabel = out ? (choices.length > 1 ? `Clock in for ${pickLabel(chosen)}` : "Clock in") : onBreak ? "End break" : "Clock out";

  return (
    <div className="stack">
      <section className="hero" aria-label="Your clock">
        <div className="hero-row">
          <button type="button" className={`big ${out || onBreak ? "play" : "stop"}`} disabled={disabled} onClick={bigAction} aria-label={bigLabel} title={bigLabel}>
            {out || onBreak ? <PlayIcon size={30} /> : <StopIcon size={28} />}
          </button>
          <div className={`timer ${working ? "live" : ""}`} role="timer" aria-label="Time worked today">
            <span className="digits">{clockText(total)}</span>
            <span className="caption">Worked today</span>
          </div>
          {working ? (
            <button type="button" className="side" disabled={disabled} aria-expanded={breakOpen} aria-label="Start a break" title="Start a break" onClick={() => setBreakOpen((v) => !v)}>
              <CoffeeIcon size={22} />
            </button>
          ) : onBreak ? (
            <button type="button" className="side stop" disabled={disabled} aria-label="Clock out" title="Clock out" onClick={() => run(clockOut)}>
              <StopIcon size={20} />
            </button>
          ) : (
            <span className="side-gap" aria-hidden />
          )}
        </div>

        {breakOpen ? (
          <div className="chips" role="group" aria-label="How long a break?">
            {BREAKS.map((b) => (
              <button key={b.label} type="button" className="chip" disabled={disabled} onClick={() => run(() => startBreak(b.minutes))}>
                {b.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="who">
          <p className={`state ${status.state ?? "out"}`}>
            {working ? <>Working since {timeOf(status.workingSince)}</> : onBreak ? breakText(status, now) : "Clocked out"}
          </p>
          {(working || onBreak) && status.current && (status.current.clientName || status.current.projectName) ? (
            <>
              <h2 className="client">{status.current.clientName}</h2>
              {status.current.projectName ? <p className="project">{status.current.projectName}</p> : <p className="project muted">No specific project</p>}
            </>
          ) : out && choices.length > 0 ? (
            <p className="muted">{choices.length > 1 ? "Pick what you are working on, then press play." : `Ready to clock in for ${pickLabel(chosen)}.`}</p>
          ) : null}
        </div>

        {!status.online ? <p className="notice warn">You are offline. What you do is saved here and sent when you are connected again.</p> : null}
        {blocked ? <p className="notice info">{blocked}</p> : null}
        {notice ? (
          <p role={notice.ok ? "status" : "alert"} className={`notice ${notice.ok ? "ok" : "error"}`}>
            {notice.message}
          </p>
        ) : null}
      </section>

      {choices.length > 1 ? (
        <section className="worklist" aria-label="Your clients and projects">
          <div className="worklist-head">
            <h3>{working ? "Switch to" : "Work on"}</h3>
            {choices.length > SEARCH_FROM ? (
              <label className="search">
                <SearchIcon />
                <span className="sr-only">Search projects</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" />
              </label>
            ) : null}
          </div>
          {shown.length === 0 ? <p className="muted pad">Nothing matches.</p> : null}
          <ul className="rows">
            {shown.map((c, i) => {
              const isCurrent = (working || onBreak) && keyOf(c) === currentKey;
              const isPicked = out && keyOf(c) === picked;
              const newGroup = c.grouped && shown[i - 1]?.clientId !== c.clientId;
              return (
                <li key={keyOf(c)}>
                  {newGroup ? (
                    <div className="band">
                      <span>{c.clientName}</span>
                      <span className="time">{hoursMinutes(clientMs(c.clientId))}</span>
                    </div>
                  ) : null}
                  <div className={`work-row ${c.grouped ? "indent" : "solo"} ${isCurrent ? "current" : ""} ${isPicked ? "picked" : ""}`}>
                    <button type="button" className="row-main" disabled={!out || busy} aria-pressed={isPicked} onClick={() => setPicked(keyOf(c))} title={c.label}>
                      {isCurrent ? <span className="live-dot" aria-hidden /> : null}
                      <span className="row-title">{c.title}</span>
                    </button>
                    <span className="time">{hoursMinutes(lineMs(c))}</span>
                    {isCurrent ? (
                      <span className="now" aria-label="Working on this now">Now</span>
                    ) : out ? (
                      <button type="button" className="row-go" disabled={disabled} aria-label={`Clock in for ${c.label}`} title={`Clock in for ${c.label}`} onClick={() => run(() => clockIn(c.clientId, c.projectId))}>
                        <PlayIcon size={16} />
                      </button>
                    ) : working ? (
                      <button type="button" className="row-go" disabled={disabled} aria-label={`Switch to ${c.label}`} title={`Switch to ${c.label}`} onClick={() => run(() => switchClient(c.clientId, c.projectId))}>
                        <SwitchIcon size={16} />
                      </button>
                    ) : (
                      <span className="row-go-gap" aria-hidden />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="note" aria-label="What it records">
        {status.policy ? (
          <p>
            While you are clocked in (and not on a break) it notes <strong>which program is in front</strong> and <strong>whether you are active or idle</strong>, and takes a <strong>blurred picture</strong> of your screens now and then.
          </p>
        ) : (
          <p>Recording is not switched on yet. Nothing is recorded until your company turns it on.</p>
        )}
        <p className="muted">Never recorded: window titles, web addresses, what you type, or anything you copy.</p>
      </section>
    </div>
  );
}
