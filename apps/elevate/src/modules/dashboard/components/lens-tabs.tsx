"use client";

import { TabNav } from "@/components/tab-nav";
import { LENS_COOKIE, LENS_LABELS, type Lens } from "../lens";

/**
 * Switches which dashboard widgets come first. It only changes the page's emphasis: permissions are the same in every view.
 * The choice is remembered in a plain cookie so the server shows it next time.
 */
export function LensTabs({ lenses, current }: { lenses: Lens[]; current: Lens }) {
  if (lenses.length < 2) return null;
  return (
    <TabNav
      label="Dashboard view"
      current={current}
      items={lenses.map((lens) => ({
        key: lens,
        // eslint-disable-next-line security/detect-object-injection -- lens is a typed Lens
        label: LENS_LABELS[lens],
        href: `/dashboard?view=${lens}`,
        onClick: () => {
          try {
            document.cookie = `${LENS_COOKIE}=${lens}; path=/; max-age=31536000; samesite=lax`;
          } catch {
            // Not remembered; the address still carries the choice.
          }
        },
      }))}
    />
  );
}
