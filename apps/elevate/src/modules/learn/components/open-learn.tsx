"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startLearnLaunch } from "../actions";

/**
 * Opens ELEVATE Learn. Asks the server for a one-time token, then posts it straight to Learn with a form (never in a link, so it
 * cannot end up in history or a referrer). With `auto`, it starts by itself (people sent here from Learn after their session ended).
 */
export function OpenLearn({ auto = false }: { auto?: boolean }) {
  const [state, setState] = useState<"idle" | "opening" | "failed">(auto ? "opening" : "idle");
  const [message, setMessage] = useState("");
  const started = useRef(false);

  const open = useCallback(async () => {
    setState("opening");
    setMessage("");
    const result = await startLearnLaunch();
    if (!result.ok) {
      setState("failed");
      setMessage(result.error);
      return;
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = result.data.action;
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "token";
    field.value = result.data.token;
    form.append(field);
    document.body.append(form);
    form.submit();
  }, []);

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void open();
  }, [auto, open]);

  return (
    <div className="space-y-3">
      <Button onClick={() => void open()} disabled={state === "opening"}>
        {state === "opening" ? "Opening training..." : "Open ELEVATE Learn"} <ArrowRight aria-hidden />
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {state === "opening" ? "Taking you to ELEVATE Learn. This only takes a moment." : null}
        {state === "failed" ? message : null}
      </p>
    </div>
  );
}
