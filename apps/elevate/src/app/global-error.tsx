"use client";

import { Inter, Source_Sans_3 } from "next/font/google";
import "./globals.css";

// The root layout is gone, so load the two brand fonts here: Inter for text, Source Sans 3 for headings.
const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const head = Source_Sans_3({ variable: "--font-head", subsets: ["latin"] });

/** Last resort: the root layout itself failed, so there is no theme or shell. Fixed wording and the digest only, never the message or stack. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={`${body.variable} ${head.variable} antialiased`}>
      <body className="font-sans flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <main role="alert" className="flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">We could not load ELEVATE. Try again, and if it keeps happening tell support.</p>
          {error.digest ? <p className="text-xs text-muted-foreground tabular-nums">Reference: {error.digest}</p> : null}
          <button type="button" onClick={reset} className="h-(--control-h) rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
