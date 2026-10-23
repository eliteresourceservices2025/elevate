import { Headphones, NotebookPen } from "lucide-react";

/**
 * A pretend work window for practice: a softphone on one side and the customer record on the other, so a call or a call note feels
 * like the real job. Decoration and layout only; every person and fact in it is invented content from the lesson.
 */
export function Workstation({ kind, title, record, children }: { kind: "phone" | "note"; title: string; record?: { title: string; rows: { label: string; value: string }[] }; children: React.ReactNode }) {
  const Icon = kind === "phone" ? Headphones : NotebookPen;
  return (
    <div className="workstation">
      <div className="ws-bar" aria-hidden="true">
        <span className="ws-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="ws-name">
          <Icon size={14} /> {kind === "phone" ? "Softphone" : "Call notes"} · {title}
        </span>
      </div>
      <div className={`ws-body${record ? " with-record" : ""}`}>
        <div className="ws-main">{children}</div>
        {record ? (
          <aside className="ws-record" aria-label={record.title}>
            <strong>{record.title}</strong>
            <dl>
              {record.rows.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
