"use client";

import { Button } from "@/components/ui/button";

/** A failed optional queue read must not look like there were no announcements. */
export function PopupLoadNotice() {
  return <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b bg-warning-surface px-4 py-2 text-sm text-warning">
    <p>Your sign-in announcements could not be loaded. Refresh to try again.</p>
    <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>Refresh page</Button>
  </div>;
}
