import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

// Placeholder. The real time clock (Phase 2.3) is server-driven, append-only and
// takes its timestamps from the server, never from the browser.
export function ClockWidget() {
  return (
    <Button variant="outline" size="sm" disabled title="The time clock arrives in Phase 2">
      <Clock aria-hidden />
      Clock in
    </Button>
  );
}
