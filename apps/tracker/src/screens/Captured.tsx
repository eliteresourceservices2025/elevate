import { useEffect, useState } from "react";
import { capturedToday, disconnect, lastShot, type CapturedApp } from "../api";

function minutesText(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** The person can see exactly what has been noted: program names with minutes, and the last blurred picture. */
export function Captured({ refreshKey, onDisconnected }: { refreshKey: number; onDisconnected: () => void }) {
  const [apps, setApps] = useState<CapturedApp[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void capturedToday().then(setApps);
    void lastShot().then(setShot);
  }, [refreshKey]);

  return (
    <div className="stack">
      <section className="card stack" aria-label="What was captured today">
        <h2>What was captured today</h2>
        {apps.length === 0 ? <p className="muted">Nothing yet. It notes programs only while you are clocked in.</p> : null}
        <ul className="plain">
          {apps.map((a) => (
            <li key={a.app} className="between">
              <span>{a.app}</span>
              <span className="muted">{minutesText(a.minutes)}</span>
            </li>
          ))}
        </ul>
        <h3>Your last blurred picture</h3>
        {shot ? <img className="shot" src={shot} alt="The last blurred picture of your screens" /> : <p className="muted">No picture yet.</p>}
        <p className="muted">Pictures are blurred on this computer before they are sent. Never recorded: window titles, web addresses, what you type, or anything you copy.</p>
      </section>

      <section className="card stack" aria-label="Disconnect">
        <h3>Disconnect this computer</h3>
        <p className="muted">Stops recording here and removes anything waiting to be sent. Your hours in ELEVATE are not affected.</p>
        {confirming ? (
          <div className="row">
            <button className="danger" onClick={async () => { await disconnect(); onDisconnected(); }}>Yes, disconnect</button>
            <button onClick={() => setConfirming(false)}>Go back</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)}>Disconnect…</button>
        )}
      </section>
    </div>
  );
}
