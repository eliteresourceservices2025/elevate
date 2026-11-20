import { useState } from "react";
import { enroll } from "../api";

/** First start: the person types the one-time code they made in ELEVATE. */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await enroll(code);
      onDone();
    } catch (err) {
      setError(typeof err === "string" ? err : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Connect this computer</h2>
      <p>In ELEVATE, open <strong>Attendance</strong> and choose <strong>Add this computer</strong>. Type the code it shows here.</p>
      <label htmlFor="code">Code from ELEVATE</label>
      <input id="code" className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} autoComplete="off" spellCheck={false} autoFocus />
      {error ? <p role="alert" className="notice error">{error}</p> : null}
      <button type="submit" className="primary" disabled={busy || code.trim().length < 4}>
        {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}
