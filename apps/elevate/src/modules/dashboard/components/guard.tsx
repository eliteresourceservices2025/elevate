import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { PanelTimeout, withTimeout } from "../timeout";

/** How long one panel may take before the page stops waiting for it. */
export const PANEL_TIMEOUT_MS = 20_000;

function PanelProblem({ name, slow }: { name: string; slow: boolean }) {
  return (
    <section aria-label={`${name} (not loaded)`} className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{name} could not load.</p>
      <p>{slow ? "The database was slow to answer." : "Something went wrong."} The rest of the page is fine. Reload to try again.</p>
    </section>
  );
}

/**
 * Runs one panel. If its reads fail or take too long, the page shows a small notice in its place instead of hanging or breaking:
 * one slow or failing panel never takes the whole dashboard with it. Redirects and not-found still work (they must pass through),
 * and only the error's class name is logged, never a query, a parameter or a person's data.
 */
export async function guarded(name: string, render: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await withTimeout(render(), PANEL_TIMEOUT_MS);
  } catch (error) {
    unstable_rethrow(error);
    console.error("dashboard panel failed:", name, error instanceof Error ? error.name : "unknown error");
    return <PanelProblem name={name} slow={error instanceof PanelTimeout} />;
  }
}
