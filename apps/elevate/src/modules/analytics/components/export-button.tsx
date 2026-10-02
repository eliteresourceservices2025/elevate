"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportAnalytics } from "../actions";

/** Downloads the aggregates shown on the page as a CSV (HR only; the server checks again and audits it). */
export function ExportButton({ range, scope }: { range: number; scope: string }) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      try {
        const result = await exportAnalytics({ range, scope });
        if (!result.ok) return void toast.error(result.error);
        const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.fileName;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded ${result.data.rows} rows.`);
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return (
    <Button type="button" variant="outline" onClick={run} disabled={pending}>
      {pending ? "Preparing..." : "Download CSV"}
    </Button>
  );
}
