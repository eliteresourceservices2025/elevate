"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "Device setting", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

const subscribe = () => () => {};

/** Three small buttons: light, the device's setting, dark. Rendered after hydration so the saved choice shows correctly. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme = "system", setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <div role="group" aria-label="Color theme" className={cn("flex items-center rounded-lg border p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={mounted && theme === value}
          title={label}
          onClick={() => setTheme(value)}
          className={cn("rounded-md p-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", mounted && theme === value && "bg-primary text-primary-foreground hover:text-primary-foreground")}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
