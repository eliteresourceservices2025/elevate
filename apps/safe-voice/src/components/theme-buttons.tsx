"use client";

import { useState } from "react";

type Choice = "auto" | "light" | "dark";
const LABELS: Record<Choice, string> = { auto: "Auto", light: "Light", dark: "Dark" };

/**
 * Light, dark, or follow the device. The choice lives only in this page's memory and sets an attribute on the page: nothing is saved
 * in the browser (this site never stores anything there), so a reload goes back to the device setting.
 */
export function ThemeButtons() {
  const [choice, setChoice] = useState<Choice>("auto");
  function pick(next: Choice) {
    setChoice(next);
    const root = document.documentElement;
    if (next === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  }
  return (
    <span className="theme" role="group" aria-label="Color theme">
      {(Object.keys(LABELS) as Choice[]).map((c) => (
        <button key={c} type="button" aria-pressed={choice === c} onClick={() => pick(c)}>
          {/* eslint-disable-next-line security/detect-object-injection -- c comes from the fixed LABELS keys */}
          {LABELS[c]}
        </button>
      ))}
    </span>
  );
}
