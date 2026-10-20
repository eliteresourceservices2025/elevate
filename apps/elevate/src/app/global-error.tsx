"use client";

import "./globals.css";

/** Last resort: the root layout itself failed, so there is no theme or shell. Fixed wording and the digest only, never the message or stack. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <main role="alert" className="flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">We could not load ELEVATE. Try again, and if it keeps happening tell support.</p>
          {error.digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
          <button type="button" onClick={reset} className="h-control rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
