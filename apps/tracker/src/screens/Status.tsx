import { useEffect, useState } from "react";
import { breakLength, clockIn, clockOut, endBreak, startBreak, switchClient, timeOf, workChoices, type Notice, type StatusView } from "../api";

const BLOCKED: Record<string, string> = {
  jibble: "You clock in Jibble. ELEVATE reads your hours from there, so the clock here is off.",
  selfie: "Your team needs a selfie to clock in. Clock in on the ELEVATE page.",
};

function stateSentence(s: StatusView): string {
  if (s.state === "working") return `Working since ${timeOf(s.workingSince)}`;
  if (s.state === "break") return `On a break since ${timeOf(s.onBreak?.startedAt ?? null)}, ${breakLength(s.onBreak?.plannedMinutes ?? null)}`;
  return "Clocked out";
}

/** The clock and what the app is doing. Every button is one click that sends one request; ELEVATE answers, and its own words are shown. */
export function Status({ status, notice, onNotice, onChanged }: { status: StatusView; notice: Notice | null; onNotice: (n: Notice | null) => void; onChanged: () => void }) {
  const choices = workChoices(status.clients);
  const keyOf = (c: { clientId: string; projectId?: string }) => `${c.clientId}:${c.projectId ?? ""}`;
  const currentKey = status.current ? `${status.current.clientId ?? ""}:${status.current.projectId ?? ""}` : "";
  const [picked, setPicked] = useState<string>(choices[0] ? keyOf(choices[0]) : "");
  const [breakMinutes, setBreakMinutes] = useState("15");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!choices.some((c) => keyOf(c) === picked)) setPicked(choices[0] ? keyOf(choices[0]) : "");
  }, [choices, picked]);

  const blocked = status.clockBlockedReason ? (BLOCKED[status.clockBlockedReason] ?? "The clock is off for you right now. Use the ELEVATE page.") : null;
  const disabled = busy || Boolean(blocked) || !status.online;
  const chosen = choices.find((c) => keyOf(c) === picked);
  // While working, the list offers only the other choices; the first of them is selected until the person picks another.
  const others = choices.filter((c) => keyOf(c) !== currentKey);
  const switchTo = others.find((c) => keyOf(c) === picked) ?? others[0];

  async function run(action: () => Promise<string>) {
    setBusy(true);
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

  return (
    <div className="stack">
      <section className="card stack" aria-label="Your clock">
        <h2 className={`state ${status.state ?? "out"}`}>{stateSentence(status)}</h2>
        {status.state === "working" && status.current && (status.current.clientName || status.current.projectName) ? (
          <p className="muted">
            Working for <strong>{status.current.clientName}</strong>
            {status.current.projectName ? <> · {status.current.projectName}</> : null} since {timeOf(status.current.since)}
          </p>
        ) : null}
        {!status.online ? <p className="notice warn">You are offline. What you do is saved here and sent when you are connected again.</p> : null}
        {blocked ? <p className="notice info">{blocked}</p> : null}
        {notice ? <p role={notice.ok ? "status" : "alert"} className={`notice ${notice.ok ? "ok" : "error"}`}>{notice.message}</p> : null}

        {status.state === "out" || status.state === null ? (
          <div className="stack">
            {choices.length > 1 ? (
              <>
                <label htmlFor="work">Clock in for</label>
                <select id="work" value={picked} onChange={(e) => setPicked(e.target.value)} disabled={disabled}>
                  {choices.map((c) => (
                    <option key={keyOf(c)} value={keyOf(c)}>{c.label}</option>
                  ))}
                </select>
              </>
            ) : null}
            <button className="primary" disabled={disabled} onClick={() => run(() => clockIn(chosen?.clientId, chosen?.projectId))}>Clock in</button>
          </div>
        ) : null}

        {status.state === "working" ? (
          <div className="stack">
            {choices.length > 1 ? (
              <div className="row">
                <label htmlFor="switch" className="sr-only">Switch client or project</label>
                <select id="switch" value={switchTo ? keyOf(switchTo) : ""} onChange={(e) => setPicked(e.target.value)} disabled={disabled}>
                  {others.map((c) => (
                    <option key={keyOf(c)} value={keyOf(c)}>{c.label}</option>
                  ))}
                </select>
                <button disabled={disabled || !switchTo} onClick={() => run(() => switchClient(switchTo?.clientId, switchTo?.projectId))}>Switch to</button>
              </div>
            ) : null}
            <div className="row">
              <label htmlFor="break" className="sr-only">Break length</label>
              <select id="break" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} disabled={disabled}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="none">No time limit</option>
              </select>
              <button disabled={disabled} onClick={() => run(() => startBreak(breakMinutes === "none" ? undefined : Number(breakMinutes)))}>Start break</button>
            </div>
            <button className="danger" disabled={disabled} onClick={() => run(clockOut)}>Clock out</button>
          </div>
        ) : null}

        {status.state === "break" ? (
          <div className="stack">
            <button className="primary" disabled={disabled} onClick={() => run(endBreak)}>End break</button>
            <button className="danger" disabled={disabled} onClick={() => run(clockOut)}>Clock out</button>
          </div>
        ) : null}
      </section>

      <section className="card stack" aria-label="What it records">
        <h3>What it records</h3>
        {status.policy ? (
          <p>While you are clocked in (and not on a break) it notes <strong>which program is in front</strong> and <strong>whether you are active or idle</strong>, and takes a <strong>blurred picture of your screens</strong> about every 10 minutes.</p>
        ) : (
          <p>Recording is not switched on yet. Nothing is recorded until your company turns it on.</p>
        )}
        <p className="muted">Never recorded: window titles, web addresses, what you type, or anything you copy.</p>
        <p className="muted">{status.queueLen > 0 ? `${status.queueLen} items waiting to be sent.` : status.lastSentMs ? `Last sent at ${timeOf(new Date(status.lastSentMs).toISOString())}.` : "Nothing sent yet."}</p>
      </section>
    </div>
  );
}
