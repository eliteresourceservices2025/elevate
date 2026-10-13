"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

type Mode = "light" | "system" | "dark";

const OPTIONS: { value: Mode; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    value: "system",
    label: "Device setting",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  },
  { value: "dark", label: "Dark", icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /> },
];

const subscribe = () => () => {};

/** Three small buttons: light, the device's setting, dark (the same control as in ELEVATE). Shown after hydration so the saved choice is right. */
export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <div role="group" aria-label="Color theme" className="theme-toggle">
      {OPTIONS.map(({ value, label, icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={mounted && theme === value}
          title={label}
          onClick={() => setTheme(value)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
