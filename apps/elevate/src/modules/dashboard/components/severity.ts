import type { Severity } from "../attention";

/** The badge colour of each severity, shared by the attention list and the early warnings. */
export const SEVERITY_VARIANT: Record<Severity, "destructive" | "warning" | "info"> = {
  urgent: "destructive",
  warn: "warning",
  info: "info",
};
